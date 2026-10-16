// Backlog schema check — the keystone of the whole system.
//
// The skills orient off the registers by reading entry *headers* — `status:`,
// `depends_on:` — never by reading whole files, which would cost a fortune in tokens
// and still go stale. That read is only as trustworthy as the format is uniform. This
// script asserts the format, so retrieval is mechanically reliable: the benefit of a
// structured dataset without leaving markdown.
//
// The format itself is read by scripts/entries.mjs: one file per entry, a strict
// `key: value` header the tools read, a markdown body only people read. This script
// decides what an entry must carry and how entries may relate.
//
// It only *reads* the docs. The single-writer contract (docs/backlog/ ← /ship) is
// untouched; drift it surfaces is fixed by that register's owner.
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
//   node scripts/backlog-schema-check.mjs --fields  print every required section and
//                                                   header key as JSON (tests walk them)
//   (PostToolUse hook)                              reads hook JSON on stdin; exits
//                                                   0 fast unless the edited file is in
//                                                   a register, else checks and exits 2

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutOf } from '../.claude/edit-guard.mjs';
import { BACKLOG, ASSUMPTIONS, loadRegister, parseQueue, idsOf } from './entries.mjs';

let ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── Configuration ────────────────────────────────────────────────────────────
// PORTING: adjust the register paths in entries.mjs; keep the shapes here.

const REGISTERS = [
  {
    ...BACKLOG,
    kind: 'product',
    open: new Set(['proposed', 'in-progress', 'partial']),
    terminal: new Set(['shipped', 'deferred', 'abandoned']),
    // Body sections every entry carries, and those only *open* entries carry.
    // NB: product `Scope` means "what's in, what's out" — the unit /implement
    // builds against. Don't confuse it with a measurement's context.
    always: ['Value'],
    whileOpen: ['Scope', 'Accept'],
    // `Accept` is the product owner's definition of done, written before the build.
    // Counted rather than merely present, because the failure mode this field has is
    // not absence — it's degrading into ceremony, a restatement of Value as one
    // unfalsifiable sentence. A bound forces the author to enumerate *separable*
    // checks; a lower bound of 1 would accept "it works" and a high ceiling would
    // accept a spec dump nobody drives.
    criteria: { section: 'Accept', min: 2, max: 4 },
    // Header keys: when the entry's claims were established, and when it closed.
    dated: 'drafted',
    closed: 'shipped',
  },
  // Assumptions: load-bearing assumptions. Not a backlog (no queue, no payoff
  // order) but the same shape rules apply, and backlog entries may depend on them —
  // which is the point.
  {
    ...ASSUMPTIONS,
    kind: 'assumptions',
    open: new Set(['open']),
    terminal: new Set(['verified', 'refuted', 'moot']),
    always: ['Assumption'],
    whileOpen: ['Why it matters', 'How to verify'],
    dated: 'raised',
    closed: 'resolved',
  },
];

// ── Mode ─────────────────────────────────────────────────────────────────────
//
// Decided *before* any file is read. A hook fires on every Edit/Write in the
// session, the vast majority of which touch nothing we track — those must cost
// nothing and must never fail, even if a register is mid-rename or absent.

const argv = process.argv.slice(2);

// `--fields`: every required section and header key per register, as JSON. Exists so
// tests can walk them from this config instead of restating the list — a field added
// here is covered without anyone remembering to add its test.
if (argv.includes('--fields')) {
  console.log(JSON.stringify(Object.fromEntries(REGISTERS.map((r) => [
    r.dir,
    { required: [...r.always, ...r.whileOpen], keys: Object.keys(r.keys) },
  ]))));
  process.exit(0);
}
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
    const norm = `/${file.replaceAll('\\', '/')}`;
    run = REGISTERS.some((r) => norm.includes(`/${r.dir}/`));
    // Check the checkout the edit landed in. In a worktree session the hook still
    // runs from the launch checkout (A-7), which would validate main's copy.
    if (run) ROOT = checkoutOf(file, ROOT);
  }
}

if (!run) process.exit(0);

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * Status vocabulary is read *from the register's README* — the backtick-quoted
 * words in its "Status vocab:" line — not hardcoded here. A doc that documents
 * its own vocabulary and a checker that reads it cannot drift apart.
 */
function sectionVocab(text) {
  const out = new Set();
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

const readIf = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

const loaded = REGISTERS.map((r) => loadRegister(ROOT, r)).filter((l) => l.present);
const byId = new Map(loaded.flatMap((l) => l.entries.filter((e) => e.id).map((e) => [e.id, e])));
const regOf = (e) => loaded.find((l) => l.entries.includes(e))?.reg;
const isTerminal = (e) => !!e && !!regOf(e)?.terminal.has(e.status ?? '');

// Top-level bullets only: an indented sub-bullet is detail under a criterion, not
// another criterion, and a paragraph is not a criterion at all.
const bullets = (lines) => (lines ?? []).filter((l) => /^[-*]\s+\S/.test(l));

// ── Checks ───────────────────────────────────────────────────────────────────

const problems = [];
const fail = (msg) => problems.push(msg);

// Every ID in the queue. The queue is documented as the *dependency-ready* head,
// which is what gives assumption blocking its severity tiers below.
let queued = new Set();
const queueReg = loaded.find((l) => l.reg.queue)?.reg;
let queueIds = [];
if (queueReg) {
  const text = readIf(queueReg.queue);
  if (text === null) {
    fail(`${queueReg.queue}: missing — the queue lives in its own file`);
  } else {
    const q = parseQueue(text);
    for (const e of q.errors) fail(`${queueReg.queue}:${e.line}: ${e.msg}`);
    queueIds = [...new Set(q.ids)];
    queued = new Set(queueIds);
  }
}

const today = new Date().toISOString().slice(0, 10);

for (const { reg: b, entries } of loaded) {
  if (entries.length === 0) fail(`${b.dir}: no entry files parsed`);
  const readme = readIf(b.readme);
  const vocab = readme === null ? new Set() : sectionVocab(readme);
  if (vocab.size === 0) fail(`${b.readme}: no documented status vocabulary resolved`);

  // — the header: strict, and every error names the file and line —
  for (const e of entries) {
    for (const x of e.errors) fail(`${e.file}:${x.line}: ${x.msg}`);
  }

  // — identity: required keys, namespace, the file is named for its entry —
  for (const e of entries) {
    for (const key of ['id', 'title', 'status']) {
      if (!e.header[key]) fail(`${e.file}: no \`${key}:\` in the header`);
    }
    if (!e.id) continue;
    if (!b.idPattern.test(e.id)) fail(`${e.file}: ID out of namespace: ${e.id}`);
    if (e.id !== e.name) fail(`${e.file}: header id ${e.id} does not match the file name`);
    // SHIPPED is a status, never part of a title: a status baked into a title is
    // invisible to a status read and survives the flip that should have removed it.
    // Matched on the uppercase marker only — the word in ordinary prose is not a claim.
    if (/SHIPPED/.test(e.header.title ?? '')) fail(`${e.file}: SHIPPED in title — status lives in \`status:\``);
  }

  // — status drawn from the vocabulary the register documents —
  for (const e of entries) {
    if (e.status && vocab.size && !vocab.has(e.status)) {
      fail(`${e.file}: status "${e.status}" for ${e.id} not in vocab {${[...vocab].join(', ')}}`);
    }
  }

  // — required sections: always-sections on every entry, open-sections while open —
  // Terminal entries legitimately compress to a status + a one-line outcome.
  for (const e of entries) {
    for (const s of b.always) {
      if (!e.sections.has(s)) fail(`${e.file}: ${e.id} missing **${s}**`);
    }
    if (!b.open.has(e.status ?? '')) continue;
    for (const s of b.whileOpen) {
      if (!e.sections.has(s)) fail(`${e.file}: open ${e.id} missing **${s}**`);
    }
  }

  // — an enumerable section is actually enumerated —
  // Presence is checked above; this checks the section says something a person could
  // *drive*. Runs only where the section is present, so a missing one raises exactly
  // one violation rather than two saying the same thing.
  if (b.criteria) {
    const { section, min, max } = b.criteria;
    for (const e of entries) {
      if (!b.open.has(e.status ?? '') || !e.sections.has(section)) continue;
      const n = bullets(e.sections.get(section)).length;
      if (n < min || n > max) {
        fail(
          `${e.file}: open ${e.id} has ${n} **${section}** criteri${n === 1 ? 'on' : 'a'}, ` +
            `expected ${min}–${max} — each its own top-level bullet, each one someone could ` +
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
  for (const e of entries) {
    if (!b.open.has(e.status ?? '')) continue;
    const d = e.header[b.dated];
    if (!d) { fail(`${e.file}: open ${e.id} has no \`${b.dated}: YYYY-MM-DD\``); continue; }
    if (d > today) fail(`${e.file}: ${e.id} is ${b.dated} in the future (${d})`);
  }

  // — an open entry older than a dependency that has since landed —
  // Presumptively stale: the dependency usually moved the very code the entry
  // describes. This does not mean the entry is wrong — it means nobody may build
  // it without re-checking against the code and re-dating it. Conservative by
  // construction: fires only when *both* dates parse, so a missing date never
  // invents an alarm.
  for (const e of entries) {
    if (!b.open.has(e.status ?? '')) continue;
    const drafted = e.header[b.dated];
    if (!drafted) continue; // the check above owns that failure
    for (const depId of idsOf(e, 'depends_on')) {
      const dep = byId.get(depId);
      if (!dep || !isTerminal(dep)) continue;
      const landed = dep.header[regOf(dep).closed];
      if (!landed || landed <= drafted) continue;
      fail(
        `${e.file}: ${e.id} (${b.dated} ${drafted}) depends on ${depId}, which landed ${landed} — ` +
          `presumptively stale. Re-verify its claims against the code and bump \`${b.dated}:\`, ` +
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
  // entry resting on an open assumption — including one parked deep in the pool, which is
  // exactly the "blocked-not-rejected" draft /triage is instructed to write. A
  // correctly-drafted entry could never be committed green, and a check that's
  // permanently red teaches people to ignore it.
  //
  //   proposed, not queued  → pass. Correctly parked; the block costs nothing yet.
  //   in Next up            → fail. The queue is documented as the *dependency-
  //                           ready* head; an entry resting on an open assumption
  //                           is not dependency-ready, so the queue is lying.
  //   in-progress/partial   → fail. Someone is building on sand right now.
  //
  // /implement's DEPENDS GATE stays unconditional — it acts on work being picked
  // up, which is already in a failing tier by the time it runs.
  for (const e of entries) {
    for (const depId of idsOf(e, 'depends_on')) {
      if (!/^A-/.test(depId)) continue;
      const assumption = byId.get(depId);
      // A dangling reference is wrong at any status: a terminal entry citing a
      // nonexistent assumption is a broken audit trail, not a harmless leftover.
      if (!assumption) { fail(`${e.file}: ${e.id} depends on ${depId}, which has no entry`); continue; }
      if (assumption.status !== 'open') continue;
      const claimed = e.status === 'in-progress' || e.status === 'partial';
      if (!claimed && !queued.has(e.id)) continue; // parked in the pool — fine
      fail(
        `${e.file}: ${e.id} is ${claimed ? `\`${e.status}\`` : 'in Next up'} but ` +
          `depends on ${depId}, still \`open\`. ${claimed
            ? 'Work in flight is resting on an unverified assumption'
            : 'The queue is the dependency-ready head, and this entry is not ready'}` +
          ` — verify ${depId}, promote it to a spike, or ${claimed ? 'rescope' : 'demote'} ${e.id}.`,
      );
    }
  }

  // — a spike and the assumption it answers move together —
  //
  // The one cross-register obligation in the suite, and the reason it's a structured
  // field rather than a sentence (LESSONS L2): an obligation recorded on one side
  // of a boundary with nothing accountable on the other never fails loudly, it
  // just quietly doesn't happen. `resolves: A-n` is readable and pairable;
  // "we should settle this eventually" is neither.
  for (const e of entries) {
    for (const aId of idsOf(e, 'resolves').filter((id) => /^A-/.test(id))) {
      const assumption = byId.get(aId);
      if (!assumption) { fail(`${e.file}: ${e.id} resolves ${aId}, which has no entry`); continue; }
      // Live spike pointing at an already-settled assumption: either the spike is
      // obsolete, or something resolved the assumption out from under it.
      if (b.open.has(e.status ?? '') && assumption.status !== 'open') {
        fail(
          `${e.file}: open ${e.id} resolves ${aId}, but ${aId} is already ` +
            `\`${assumption.status}\` — the spike is obsolete (close it) or it answers a ` +
            `different question (repoint \`resolves:\`).`,
        );
      }
      // Spike shipped, assumption still open: the answer never made it back.
      if (e.status === 'shipped' && assumption.status === 'open') {
        fail(
          `${e.file}: ${e.id} shipped and resolves ${aId}, but ${aId} is still \`open\` — ` +
            `write what the spike found into its **Resolution**, then sweep the entries ` +
            `that were blocked on it. A finding nobody wrote down is inventory.`,
        );
      }
    }
  }
}

// — Next up never dangles or goes stale —
if (queueReg && readIf(queueReg.queue) !== null) {
  if (queueIds.length === 0) fail(`${queueReg.queue} has no queued IDs`);
  for (const id of queueIds) {
    const e = byId.get(id);
    if (!e) { fail(`${queueReg.queue}: Next-up ID ${id} has no entry`); continue; }
    if (isTerminal(e)) fail(`${queueReg.queue}: Next-up ${id} is terminal ("${e.status}") — refresh the queue`);
  }
}

// — IDs are globally unique across the registers —
const all = loaded.flatMap((l) => l.entries.map((e) => e.id).filter(Boolean));
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
if (!hookMode) console.log(`backlog-schema: OK (${all.length} entries across ${loaded.length} register(s))`);
