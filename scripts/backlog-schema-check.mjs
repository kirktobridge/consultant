// Backlog schema check — the keystone of the whole system.
//
// The skills orient off the backlog by *grepping* only `### <ID>` headings and
// `**Status:**` lines — never by reading whole files, which would cost a fortune
// in tokens and still go stale. That grep is only as trustworthy as the format is
// uniform. This script asserts the format, so retrieval is mechanically reliable:
// the benefit of a structured dataset without leaving markdown.
//
// It only *reads* the docs. The single-writer contract (BACKLOG.md ← /ship) is
// untouched; drift it surfaces is fixed by that file's owner.
//
// The three things worth understanding before you edit anything:
//
//   ENTRY conditions (open entries carry their fields) are easy to remember and
//   get enforced socially anyway. EXIT conditions (a terminal entry discharged
//   its obligations) are easy to skip, because by then the work feels done. Both
//   are checked here, and the exit half is the one that has actually caught bugs.
//
//   Checks are COLLECTED, not fail-fast, wherever several independent loose ends
//   can exist. Failing on the first hit hides the rest — and in the original
//   project the very case a check was built for got masked by an unrelated hit.
//
//   A check that stopped looking passes exactly like a check that found nothing
//   (LESSONS L3). The entry count in the success line is a positive control
//   printed on every run; if you change a parser, feed it known-bad input and
//   confirm it still fails before trusting a green run.
//
// Modes:
//   node scripts/backlog-schema-check.mjs           check everything (CI / manual)
//   node scripts/backlog-schema-check.mjs --all     same, explicit
//   (PostToolUse hook)                              reads hook JSON on stdin; exits
//                                                   0 fast unless the edited file is
//                                                   watched, else checks and exits 2

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutOf } from '../.claude/edit-guard.mjs';

let ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DASH = '—'; // em-dash — the canonical heading + SHIPPED separator

// ── Configuration ────────────────────────────────────────────────────────────
// PORTING: adjust ID namespaces and file paths; keep the shapes.

const BACKLOGS = [
  {
    file: 'docs/product/BACKLOG.md',
    idPattern: /^P\d+$/,
    kind: 'product',
    open: new Set(['proposed', 'in-progress', 'partial']),
    terminal: new Set(['shipped', 'deferred', 'abandoned']),
    // Fields every entry carries, and fields only *open* entries carry.
    // NB: product `Scope` means "what's in, what's out" — the unit /implement
    // builds against. Don't confuse it with a measurement's context.
    always: [['Value', /\*\*Value:\*\*/]],
    // NB the `Accept` probe is anchored to a field line (`- **Accept:**`) where the
    // others are not. It has to be: an entry *about* the field mentions `**Accept:**`
    // in its own Scope prose, and an unanchored probe reads that as the field being
    // present — the entry then passes while carrying no criteria at all. Anchoring
    // also keeps `labelled` from locking onto the prose line and counting the wrong
    // block's bullets.
    whileOpen: [['Scope', /\*\*Scope\b/], ['Accept', /^\s*-\s+\*\*Accept\b/]],
    // `Accept:` is the product owner's definition of done, written before the build.
    // Counted rather than merely present, because the failure mode this field has is
    // not absence — it's degrading into ceremony, a restatement of Value as one
    // unfalsifiable sentence. A bound forces the author to enumerate *separable*
    // checks; a lower bound of 1 would accept "it works" and a high ceiling would
    // accept a spec dump nobody drives.
    criteria: { label: 'Accept', re: /^\s*-\s+\*\*Accept\b/, min: 2, max: 4 },
  },
];

// Open Decisions: load-bearing assumptions. Not a backlog (no `## Next up`, no
// payoff order) but the same shape rules apply, and backlog entries may
// `Depends on:` them — which is the point.
const DECISIONS = {
  file: 'docs/OPEN_DECISIONS.md',
  idPattern: /^OD-\d+$/,
  kind: 'decisions',
  open: new Set(['open']),
  terminal: new Set(['verified', 'refuted', 'moot']),
  always: [['Assumption', /\*\*Assumption:\*\*/]],
  whileOpen: [
    ['Why it matters', /\*\*Why it matters:\*\*/],
    ['How to verify', /\*\*How to verify:\*\*/],
  ],
};

const HEADING = new RegExp(`^###\\s+\\S+\\s+${DASH}\\s+\\S`);

/** Files whose edit should trigger the in-session (hook) run. */
const WATCHED = [BACKLOGS[0].file, DECISIONS.file];

// ── Mode ─────────────────────────────────────────────────────────────────────
//
// Decided *before* any file is read. A hook fires on every Edit/Write in the
// session, the vast majority of which touch nothing we track — those must cost
// nothing and must never fail, even if a tracked doc is mid-rename or absent.

const argv = process.argv.slice(2);
const explicit = argv.includes('--all');
let hookMode = false;
let run = explicit || process.stdin.isTTY === true;

if (!run) {
  let stdin = '';
  try { stdin = readFileSync(0, 'utf8'); } catch { /* nothing piped */ }
  if (stdin.trim() === '') {
    run = true; // no payload, not a TTY (e.g. `… | cat`) — behave like a normal run
  } else {
    hookMode = true;
    let file = '';
    try {
      const payload = JSON.parse(stdin);
      file = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath ?? '';
    } catch {
      /* unparseable → treat as a no-op, never block an unrelated edit */
    }
    run = WATCHED.some((w) => file.replaceAll('\\', '/').endsWith(w));
    // Check the checkout the edit landed in. In a worktree session the hook still
    // runs from the launch checkout (OD-7), which would validate main's copy.
    if (run) ROOT = checkoutOf(file, ROOT);
  }
}

if (!run) process.exit(0);

// ── Parsing ──────────────────────────────────────────────────────────────────

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const has = (lines, re) => lines.some((l) => re.test(l));

/**
 * Status vocabulary is read *from the document itself* — the backtick-quoted
 * words in its "Status vocab:" line — not hardcoded here. A doc that documents
 * its own vocabulary and a checker that reads it cannot drift apart.
 */
function sectionVocab(text) {
  const out = new Set();
  // Two shapes in the wild, both legitimate:
  //   inline — `Status vocab: `a` / `b` / `c`.`  (runs to the blank line)
  //   heading — `## Status vocab` with the list a line or two below
  // Take the first backtick-bearing run after the marker either way.
  const m = text.match(/Status vocab\b[\s\S]{0,600}/i);
  if (!m) return out;
  // A vocab list may wrap across lines, so consume consecutive token-bearing
  // lines; stop at the first gap after tokens have started, so an explanatory
  // table further down doesn't drag in unrelated backticked words.
  let started = false;
  for (const line of m[0].split('\n')) {
    const toks = [...line.matchAll(/`([^`]+)`/g)];
    if (toks.length === 0) {
      if (started) break;
      continue;
    }
    started = true;
    for (const t of toks) out.add(t[1].toLowerCase());
  }
  return out;
}

function parse(b) {
  const text = read(b.file);
  const lines = text.split('\n');
  const entries = [];
  let cur = null;
  // Docs carry their own entry template inside a fenced block, and a template is
  // not an entry — parsing one as real produces a phantom duplicate ID and a
  // cascade of downstream failures. Skip fences everywhere.
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { if (cur) cur.body.push(line); continue; }
    const h = line.match(/^###\s+(\S+)\s+/);
    if (h) {
      if (cur) entries.push(cur);
      cur = { id: h[1], heading: line, title: line.replace(/^###\s+\S+\s*/, ''), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) entries.push(cur);

  for (const e of entries) {
    const s = e.body.find((l) => /\*\*Status:\*\*/.test(l));
    const tok = s?.match(/\*\*Status:\*\*\s*`?([a-z-]+)`?/i);
    e.statusToken = tok ? tok[1].toLowerCase() : null;
  }
  return { file: b.file, entries, vocab: sectionVocab(text), nextUp: parseNextUp(lines) };
}

function parseNextUp(lines) {
  const out = [];
  let inBlock = false;
  for (const l of lines) {
    if (/^##\s+Next up/i.test(l)) { inBlock = true; continue; }
    if (inBlock && /^##\s/.test(l)) break;
    if (inBlock) for (const m of l.matchAll(/\*\*(P\d+)\*\*/g)) out.push(m[1]);
  }
  return [...new Set(out)];
}

const labelled = (body, re) => {
  const i = body.findIndex((l) => re.test(l));
  if (i < 0) return [];
  const out = [body[i]];
  for (let j = i + 1; j < body.length && /^\s+\S/.test(body[j]); j++) out.push(body[j]);
  return out;
};

// Sub-bullets of a labelled block, which is how an enumerable field (`Accept:`) is
// distinguished from a prose one. Only the label's own continuation lines are
// considered, so the next field's bullets can never be counted as this field's.
const subBullets = (body, re) => labelled(body, re).slice(1).filter((l) => /^\s+[-*]\s+\S/.test(l));

// Backlog entries are **Drafted:**; open decisions are **Raised:**. Same idea —
// when this entry's claims were last established — so one accessor reads both.
const draftedOn = (body) =>
  body.find((l) => /\*\*(Drafted|Raised):\*\*/.test(l))?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

const terminalDateOf = (body) =>
  body.find((l) => /\*\*(Shipped|Closed|Landed):\*\*/.test(l))?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ??
  body.find((l) => /\*\*Resolution:\*\*/.test(l))?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ??
  null;

// Deduped: a labelled block runs over its continuation lines, so prose that names
// the same ID more than once ("depends on OD-1 … until OD-1 resolves") would
// otherwise raise one violation per mention. Inflating the count is not harmless —
// the count is the positive control that a parser still works (LESSONS L3), so it
// has to mean what it says.
const idsIn = (body, re) => [
  ...new Set(
    [...labelled(body, re).join(' ').matchAll(/\b(OD-\d+|P\d+)\b/g)].map((m) => m[1]),
  ),
];

const dependsOn = (body) => idsIn(body, /\*\*Depends on:\*\*/);
const resolvesOf = (body) => idsIn(body, /\*\*Resolves:\*\*/).filter((id) => /^OD-/.test(id));

// ── Checks ───────────────────────────────────────────────────────────────────

const problems = [];
const fail = (msg) => problems.push(msg);

const present = [...BACKLOGS, DECISIONS].filter((b) => existsSync(join(ROOT, b.file)));
const parsed = present.map(parse);
const byId = new Map(parsed.flatMap((p) => p.entries.map((e) => [e.id, e])));
const cfgOf = (file) => present.find((b) => b.file === file);
const cfgOfEntry = (e) => cfgOf(parsed.find((q) => q.entries.includes(e))?.file);
const isTerminal = (e) => !!e && !!cfgOfEntry(e)?.terminal.has(e.statusToken ?? '');

// Every ID named anywhere in a `## Next up` queue. The queue is documented as the
// *dependency-ready* head, which is what gives OD blocking its severity tiers below.
const queued = new Set(parsed.flatMap((p) => p.nextUp));

for (const p of parsed) {
  const b = cfgOf(p.file);

  if (p.entries.length === 0) fail(`${p.file}: no \`### \` entries parsed`);
  if (p.vocab.size === 0) fail(`${p.file}: no documented status vocabulary resolved`);

  // — heading shape, ID namespace, uniqueness —
  for (const e of p.entries) {
    if (!HEADING.test(e.heading)) fail(`${p.file}: malformed heading: ${e.heading}`);
    if (!b.idPattern.test(e.id)) fail(`${p.file}: ID out of namespace: ${e.heading}`);
    // SHIPPED is a canonical ` — SHIPPED` suffix, never baked into the title: a
    // status baked into a title is invisible to a status grep and survives the
    // flip that should have removed it. Matched on the uppercase marker only —
    // the word "shipped" in ordinary title prose is not a status claim.
    if (/SHIPPED/.test(e.title.replace(new RegExp(`\\s*${DASH}\\s*SHIPPED\\s*$`), ''))) {
      fail(`${p.file}: SHIPPED in title, not suffix: ${e.heading}`);
    }
  }
  const ids = p.entries.map((e) => e.id);
  if (new Set(ids).size !== ids.length) fail(`${p.file}: duplicate ID within file`);

  // — status drawn from the vocabulary the doc itself documents —
  for (const e of p.entries) {
    if (!e.statusToken) { fail(`${p.file}: no **Status:** line for ${e.id}`); continue; }
    if (p.vocab.size && !p.vocab.has(e.statusToken)) {
      fail(`${p.file}: status "${e.statusToken}" for ${e.id} not in vocab {${[...p.vocab].join(', ')}}`);
    }
  }

  // — required fields: always-fields on every entry, open-fields while open —
  // Terminal entries legitimately compress to a status + a one-line outcome.
  for (const e of p.entries) {
    for (const [label, re] of b.always) {
      if (!has(e.body, re)) fail(`${p.file}: ${e.id} missing **${label}**`);
    }
    if (!b.open.has(e.statusToken ?? '')) continue;
    for (const [label, re] of b.whileOpen) {
      if (!has(e.body, re)) fail(`${p.file}: open ${e.id} missing **${label}**`);
    }
  }

  // — an enumerable field is actually enumerated —
  // Presence is checked above; this checks the field says something a person could
  // *drive*. Runs only where the field is present, so a missing one raises exactly
  // one violation rather than two saying the same thing.
  if (b.criteria) {
    const { label, re, min, max } = b.criteria;
    for (const e of p.entries) {
      if (!b.open.has(e.statusToken ?? '')) continue;
      if (!has(e.body, re)) continue; // the required-fields check owns that failure
      const n = subBullets(e.body, re).length;
      if (n < min || n > max) {
        fail(
          `${p.file}: open ${e.id} has ${n} **${label}** criteri${n === 1 ? 'on' : 'a'}, ` +
            `expected ${min}–${max} — each on its own sub-bullet, each one someone could ` +
            `observe passing or failing.`,
        );
      }
    }
  }

  // — every open entry is dated —
  // An entry is a snapshot of what was true when someone wrote it. Without a
  // date, a claim drafted before the code it describes is indistinguishable from
  // one written this morning — which is how an entry gets built against a premise
  // two other entries had already voided. The date is what makes the premise gate
  // *affordable*: re-verify the old ones rather than all of them.
  const today = new Date().toISOString().slice(0, 10);
  for (const e of p.entries) {
    if (!b.open.has(e.statusToken ?? '')) continue;
    const d = draftedOn(e.body);
    if (!d) { fail(`${p.file}: open ${e.id} has no **Drafted:** YYYY-MM-DD`); continue; }
    if (d > today) fail(`${p.file}: ${e.id} is drafted in the future (${d})`);
  }

  // — an open entry older than a dependency that has since landed —
  // Presumptively stale: the dependency usually moved the very code the entry
  // describes. This does not mean the entry is wrong — it means nobody may build
  // it without re-checking against the code and re-dating it. Conservative by
  // construction: fires only when *both* dates parse, so a missing date never
  // invents an alarm.
  for (const e of p.entries) {
    if (!b.open.has(e.statusToken ?? '')) continue;
    const drafted = draftedOn(e.body);
    if (!drafted) continue; // the check above owns that failure
    for (const depId of dependsOn(e.body)) {
      const dep = byId.get(depId);
      if (!dep || !isTerminal(dep)) continue;
      const landed = terminalDateOf(dep.body);
      if (!landed || landed <= drafted) continue;
      fail(
        `${p.file}: ${e.id} (drafted ${drafted}) depends on ${depId}, which landed ${landed} — ` +
          `presumptively stale. Re-verify its claims against the code and bump **Drafted:**, ` +
          `or rescope it, before building.`,
      );
    }
  }

  // — nothing near the front of the queue may rest on an unverified assumption —
  //
  // "Never build on an unverified figure." Work built on a false assumption isn't
  // just wasted, it *ships and looks correct* until the assumption is finally
  // tested, taking everything downstream with it.
  //
  // But severity tracks how close the dependent is to actually being built, and
  // the earlier all-or-nothing version got this wrong: it failed any `proposed`
  // entry resting on an open OD — including one parked deep in the pool, which is
  // exactly the "blocked-not-rejected" draft /triage is instructed to write. A
  // correctly-drafted entry could never be committed green, and a check that's
  // permanently red teaches people to ignore it.
  //
  //   proposed, not queued  → pass. Correctly parked; the block costs nothing yet.
  //   in `## Next up`       → fail. The queue is documented as the *dependency-
  //                           ready* head; an entry resting on an open assumption
  //                           is not dependency-ready, so the queue is lying.
  //   in-progress/partial   → fail. Someone is building on sand right now.
  //
  // /implement's DEPENDS GATE stays unconditional — it acts on work being picked
  // up, which is already in a failing tier by the time it runs.
  for (const e of p.entries) {
    for (const depId of dependsOn(e.body)) {
      if (!/^OD-/.test(depId)) continue;
      const od = byId.get(depId);
      // A dangling reference is wrong at any status: a terminal entry citing a
      // nonexistent OD is a broken audit trail, not a harmless leftover.
      if (!od) { fail(`${p.file}: ${e.id} depends on ${depId}, which has no entry`); continue; }
      if (od.statusToken !== 'open') continue;
      const claimed = e.statusToken === 'in-progress' || e.statusToken === 'partial';
      if (!claimed && !queued.has(e.id)) continue; // parked in the pool — fine
      fail(
        `${p.file}: ${e.id} is ${claimed ? `\`${e.statusToken}\`` : 'in `## Next up`'} but ` +
          `depends on ${depId}, still \`open\`. ${claimed
            ? 'Work in flight is resting on an unverified assumption'
            : 'The queue is the dependency-ready head, and this entry is not ready'}` +
          ` — verify ${depId}, promote it to a spike, or ${claimed ? 'rescope' : 'demote'} ${e.id}.`,
      );
    }
  }

  // — a spike and the assumption it answers move together —
  //
  // The one cross-file obligation in the suite, and the reason it's a structured
  // field rather than a sentence (LESSONS L2): an obligation recorded on one side
  // of a boundary with nothing accountable on the other never fails loudly, it
  // just quietly doesn't happen. `Resolves: OD-n` is greppable and pairable;
  // "we should settle this eventually" is neither.
  for (const e of p.entries) {
    for (const odId of resolvesOf(e.body)) {
      const od = byId.get(odId);
      if (!od) { fail(`${p.file}: ${e.id} resolves ${odId}, which has no entry`); continue; }
      // Live spike pointing at an already-settled assumption: either the spike is
      // obsolete, or something resolved the OD out from under it.
      if (b.open.has(e.statusToken ?? '') && od.statusToken !== 'open') {
        fail(
          `${p.file}: open ${e.id} resolves ${odId}, but ${odId} is already ` +
            `\`${od.statusToken}\` — the spike is obsolete (close it) or it answers a ` +
            `different question (repoint **Resolves:**).`,
        );
      }
      // Spike shipped, assumption still open: the answer never made it back.
      if (isTerminal(e) && e.statusToken === 'shipped' && od.statusToken === 'open') {
        fail(
          `${p.file}: ${e.id} shipped and resolves ${odId}, but ${odId} is still \`open\` — ` +
            `write what the spike found into its **Resolution:**, then sweep the entries ` +
            `that were blocked on it. A finding nobody wrote down is inventory.`,
        );
      }
    }
  }

  // The decisions register is not a queue: no payoff order, no `## Next up`.
  if (b.kind === 'decisions') continue;

  // — `## Next up` never dangles or goes stale —
  if (p.nextUp.length === 0) fail(`${p.file} has no \`## Next up\` IDs`);
  for (const id of p.nextUp) {
    const e = p.entries.find((x) => x.id === id);
    if (!e) { fail(`${p.file}: Next-up ID ${id} has no entry`); continue; }
    if (b.terminal.has(e.statusToken ?? '')) {
      fail(`${p.file}: Next-up ${id} is terminal ("${e.statusToken}") — refresh the queue`);
    }
  }
}

// — IDs are globally unique across the tracked docs —
const all = parsed.flatMap((p) => p.entries.map((e) => e.id));
const dupes = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))];
if (dupes.length) fail(`duplicate IDs across files: ${dupes.join(', ')}`);

// ── Report ───────────────────────────────────────────────────────────────────
//
// Exit 2 in hook mode — that's what feeds the message back into the session while
// the context needed to fix it is still live. Exit 1 elsewhere, for CI.

if (problems.length) {
  console.error(`backlog-schema: ${problems.length} violation(s):\n- ${problems.join('\n- ')}`);
  process.exit(hookMode ? 2 : 1);
}
// The count is a positive control, printed every run: a checker that quietly stops
// parsing reports success exactly like a clean tree (LESSONS L3). A number that
// drops without files being deleted means the parser broke, not that drift left.
if (!hookMode) console.log(`backlog-schema: OK (${all.length} entries across ${parsed.length} file(s))`);
