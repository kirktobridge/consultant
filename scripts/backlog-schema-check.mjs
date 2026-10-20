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
//   node scripts/backlog-schema-check.mjs --graph   what blocks what: open entries with no
//                                                   open blocker (most-unblocking first),
//                                                   the chain behind each blocked one, and
//                                                   prose blockers; add --json for the
//                                                   contract documented in .claude/GUIDE.md
//   (PostToolUse hook)                              reads hook JSON on stdin; exits
//                                                   0 fast unless the edited file is in
//                                                   a register, else checks and exits 2

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutOf } from '../.claude/edit-guard.mjs';
import { BACKLOG, BUGS, ASSUMPTIONS, DECISIONS, loadRegister, parseQueue, idsOf, dependencyGraph } from './entries.mjs';

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
    // The only statuses that may carry the `closed` date. A `shipped:` date on any other
    // status is the claim "the user accepted this" contradicting the status line.
    closedBy: new Set(['shipped']),
  },
  // Bugs: what's broken. Carries a repro and a severity instead of a `Value` — the point
  // of the register is that nobody has to invent a payoff line for "this is broken".
  {
    ...BUGS,
    kind: 'bugs',
    open: new Set(['open', 'in-progress']),
    terminal: new Set(['fixed', 'wontfix']),
    always: [],
    whileOpen: ['Repro'],
    // Sections an entry may never carry. A bug's `Value` can only be invented — "it
    // should work" — and that dressing-up is what the register exists to stop.
    never: ['Value'],
    whileOpenKeys: ['severity'],
    // Header keys whose value is a word from a vocabulary the README documents, read
    // the same way as the status vocab: `<label>:` followed by backticked words.
    vocabKeys: { severity: 'Severity vocab' },
    // No bugs is the healthy state, so an empty register is not a parser gone quiet.
    // The entry count in the success line is still the positive control.
    mayBeEmpty: true,
    dated: 'reported',
  },
  // Assumptions: load-bearing assumptions. Not a backlog (no queue, no payoff
  // order) but the same shape rules apply, and backlog entries may depend on them —
  // which is the point.
  {
    ...ASSUMPTIONS,
    kind: 'assumptions',
    open: new Set(['open']),
    terminal: new Set(['verified', 'refuted', 'moot', 'moved']),
    always: ['Assumption'],
    whileOpen: ['Why it matters', 'How to verify'],
    // `moved`: not an assumption after all (a choice, a feature's acceptance, a
    // quantity). It stays as a stub so the ID still resolves, pointing at its new home.
    onStatus: { moved: { keys: ['moved_to'], sections: [] } },
    dated: 'raised',
    closed: 'resolved',
  },
  // Decisions: choices only the product owner makes. Blocks exactly like an
  // assumption, but is settled by deciding rather than by observing.
  {
    ...DECISIONS,
    kind: 'decisions',
    open: new Set(['open']),
    terminal: new Set(['decided', 'superseded']),
    always: ['Options'],
    whileOpen: [],
    // Header keys an open entry carries, and what each terminal status owes.
    whileOpenKeys: ['waiting_on'],
    onStatus: {
      decided: { keys: ['decided', 'leads_to'], sections: ['Decided', 'Why', 'Reopen if'] },
      superseded: { keys: ['superseded_by'], sections: [] },
    },
    dated: 'raised',
    closed: 'decided',
  },
];

// Open entries in these registers gate what depends on them: an entry resting on one
// may sit in the pool, but may not be queued or claimed.
const GATING = /^(A|D)-/;

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
// `--graph`: what blocks what, read from the same parse the checks use (see Graph,
// below). It is an explicit run, never a hook one.
const graphMode = argv.includes('--graph');
const jsonMode = argv.includes('--json');
if (jsonMode && !graphMode) {
  console.error('backlog-schema: --json goes with --graph');
  process.exit(2);
}
const explicit = argv.includes('--all') || graphMode;
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
function sectionVocab(text, label = 'Status vocab') {
  const out = new Set();
  const m = text.match(new RegExp(`${label}\\b[\\s\\S]{0,600}`, 'i'));
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
  if (entries.length === 0 && !b.mayBeEmpty) fail(`${b.dir}: no entry files parsed`);
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
  for (const [key, label] of Object.entries(b.vocabKeys ?? {})) {
    const words = readme === null ? new Set() : sectionVocab(readme, label);
    if (words.size === 0) { fail(`${b.readme}: no documented ${label} resolved`); continue; }
    // The order bugs are picked up in lives in entries.mjs; the words live here. Both
    // must name the same vocabulary, most urgent first, or one of them is lying.
    if (key === 'severity' && b.severity && [...words].join() !== b.severity.join()) {
      fail(`${b.readme}: ${label} {${[...words].join(', ')}} is not the pick-up order in scripts/entries.mjs {${b.severity.join(', ')}} — change both together, most urgent first`);
    }
    for (const e of entries) {
      const v = e.header[key];
      if (v && !words.has(v)) fail(`${e.file}: ${key} "${v}" for ${e.id} not in vocab {${[...words].join(', ')}}`);
    }
  }

  // — required sections: always-sections on every entry, open-sections while open —
  // Terminal entries legitimately compress to a status + a one-line outcome.
  for (const e of entries) {
    for (const s of b.always) {
      if (!e.sections.has(s)) fail(`${e.file}: ${e.id} missing **${s}**`);
    }
    for (const s of b.never ?? []) {
      if (e.sections.has(s)) fail(`${e.file}: ${e.id} carries **${s}** — a ${b.kind.replace(/s$/, '')} entry never does`);
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
  //
  // An open decision gates exactly the same way: work resting on a choice nobody has
  // made is resting on a guess about which way it will go.
  for (const e of entries) {
    for (const depId of idsOf(e, 'depends_on')) {
      if (!GATING.test(depId)) continue;
      const dep = byId.get(depId);
      // A dangling reference is wrong at any status: a terminal entry citing a
      // nonexistent assumption or decision is a broken audit trail, not a harmless leftover.
      if (!dep) { fail(`${e.file}: ${e.id} depends on ${depId}, which has no entry`); continue; }
      // A moved assumption is a forwarding address, not a dependency: whatever this
      // entry waits on now lives at the new home, which has its own status.
      if (dep.status === 'moved' && b.open.has(e.status ?? '')) {
        fail(
          `${e.file}: ${e.id} depends on ${depId}, which was moved to ` +
            `${idsOf(dep, 'moved_to').join(', ') || 'a new home'} — depend on its new home instead.`,
        );
        continue;
      }
      if (dep.status !== 'open') continue;
      const claimed = e.status === 'in-progress' || e.status === 'partial';
      if (!claimed && !queued.has(e.id)) continue; // parked in the pool — fine
      const isDecision = depId.startsWith('D-');
      fail(
        `${e.file}: ${e.id} is ${claimed ? `\`${e.status}\`` : 'in Next up'} but ` +
          `depends on ${depId}, still \`open\`. ${claimed
            ? `Work in flight is resting on ${isDecision ? 'a choice nobody has made' : 'an unverified assumption'}`
            : 'The queue is the dependency-ready head, and this entry is not ready'}` +
          ` — ${isDecision ? `decide ${depId}` : `verify ${depId}, promote it to a spike`}, ` +
          `or ${claimed ? 'rescope' : 'demote'} ${e.id}.`,
      );
    }
  }

  // — what a decision names must exist, and what it leads to must not be dropped —
  //
  // `leads_to:` is how a decision's consequence gets an owner (LESSONS L2). It is a
  // header field, so its target's status is readable: a shipped P# is the consequence
  // landing; an abandoned or deferred one is the consequence quietly dropped while the
  // decision still reads as in force.
  for (const e of entries) {
    // A dependency no other check reads: the gate above owns `A-n`/`D-n`, and the graph
    // block below owns the backlog's own `P#` edges. Everything else dangles here.
    for (const id of idsOf(e, 'depends_on')) {
      if (GATING.test(id) || (b.kind === 'product' && b.idPattern.test(id))) continue;
      if (!byId.has(id)) fail(`${e.file}: ${e.id} depends on ${id}, which has no entry`);
    }
    for (const key of ['waiting_on', 'leads_to', 'superseded_by', 'moved_to']) {
      for (const id of idsOf(e, key)) {
        if (!byId.has(id)) fail(`${e.file}: ${e.id} ${key} ${id}, which has no entry`);
      }
    }
    if (b.whileOpenKeys && b.open.has(e.status ?? '')) {
      for (const key of b.whileOpenKeys) {
        if (!e.header[key]) fail(`${e.file}: open ${e.id} has no \`${key}:\` in the header`);
      }
    }
    if (b.closedBy && e.header[b.closed] && !b.closedBy.has(e.status ?? '')) {
      fail(`${e.file}: ${e.id} is \`${e.status}\` but carries \`${b.closed}:\` — only a ${[...b.closedBy].join('/')} entry has that date`);
    }
    const owes = b.onStatus?.[e.status ?? ''];
    if (!owes) continue;
    for (const key of owes.keys) {
      if (!e.header[key]) fail(`${e.file}: ${e.status} ${e.id} has no \`${key}:\` in the header`);
    }
    for (const s of owes.sections) {
      if (!e.sections.has(s)) fail(`${e.file}: ${e.status} ${e.id} missing **${s}**`);
    }
    if (e.status === 'moved' && e.header.moved_to) {
      const to = idsOf(e, 'moved_to');
      if (!to.length || to.includes(e.id)) {
        fail(`${e.file}: ${e.id} is moved, but \`moved_to:\` must name the entry that is its new home`);
      }
    }
    if (e.status === 'superseded' && e.header.superseded_by) {
      const by = idsOf(e, 'superseded_by');
      if (!by.length || by.some((id) => !/^D-/.test(id))) {
        fail(`${e.file}: ${e.id} is superseded, but \`superseded_by:\` must name the D-n that replaced it`);
      }
    }
    if (e.status === 'decided') {
      for (const id of idsOf(e, 'leads_to')) {
        const t = byId.get(id);
        if (t && isTerminal(t) && t.status !== 'shipped') {
          fail(
            `${e.file}: ${e.id} leads to ${id}, which is \`${t.status}\` — the decision's ` +
              `consequence was dropped. Supersede ${e.id}, or repoint \`leads_to:\` at what ` +
              `carries it now.`,
          );
        }
      }
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

// — feature dependencies gate the queue and claims, read from one graph —
//
// The same two promises as the assumption gate above, kept for `P#` dependencies, and
// transitively: what a dependency waits on is waited on too. Only `shipped` is met.
//
//   queued       → every unmet dependency sits *above* it in the queue. Working the
//                  queue in order then keeps it dependency-ready (user decision,
//                  2026-10-16: queuing below an unshipped dependency is allowed).
//   in-progress  → every dependency is shipped. A claim builds on what exists.
//   /partial
//
// A `deferred` or `abandoned` dependency fails at both: it is never going to be met.
const backlogLoaded = loaded.find((l) => l.reg.kind === 'product');
if (backlogLoaded) {
  const g = dependencyGraph(backlogLoaded.entries);
  const via = (u) => (u.path.length > 2 ? ` (through ${u.path.slice(1, -1).join(' → ')})` : '');
  for (const cycle of g.cycles) {
    fail(`dependency cycle: ${cycle.join(' → ')} — none of these can ever be dependency-ready; drop one edge.`);
  }
  // An entry on a cycle gets the cycle's message alone: its queue advice ("queue X
  // above Y" around the loop) cannot all be followed, so it would only be noise.
  const onCycle = new Set(g.cycles.flat());
  for (const e of backlogLoaded.entries) {
    for (const id of g.deps.get(e.id) ?? []) {
      if (!byId.has(id)) fail(`${e.file}: ${e.id} depends on ${id}, which has no entry`);
    }
    if (onCycle.has(e.id)) continue;
    const unmet = g.unmet(e.id);
    const claimed = e.status === 'in-progress' || e.status === 'partial';
    const at = queueIds.indexOf(e.id);
    for (const u of unmet) {
      const dead = isTerminal(byId.get(u.id));
      if (claimed) {
        fail(
          `${e.file}: ${e.id} is \`${e.status}\` but depends on ${u.id}${via(u)}, which is ` +
            `\`${u.status}\`, not shipped — ${dead
              ? `it never will be. Drop the dependency or rescope ${e.id}.`
              : `work in flight is building on a feature that doesn't exist yet. Ship ${u.id} first, or rescope ${e.id}.`}`,
        );
      } else if (at >= 0 && dead) {
        fail(
          `${queueReg.queue}: ${e.id} is in Next up but depends on ${u.id}${via(u)}, which is ` +
            `\`${u.status}\` — it will never ship, so ${e.id} is not dependency-ready. ` +
            `Drop the dependency, or demote ${e.id}.`,
        );
      } else if (at >= 0) {
        const uAt = queueIds.indexOf(u.id);
        if (uAt >= 0 && uAt < at) continue;
        fail(
          `${queueReg.queue}: ${e.id} is in Next up but depends on ${u.id}${via(u)}, ` +
            `\`${u.status}\` and ${uAt < 0 ? 'not queued' : 'queued below it'} — the queue is ` +
            `the dependency-ready head, worked in order. Queue ${u.id} above ${e.id}, or demote ${e.id}.`,
        );
      }
    }
  }
}

// — IDs are globally unique across the registers —
const all = loaded.flatMap((l) => l.entries.map((e) => e.id).filter(Boolean));
const dupes = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))];
if (dupes.length) fail(`duplicate IDs across files: ${dupes.join(', ')}`);

// ── Graph ────────────────────────────────────────────────────────────────────
//
// The dependency graph as written, ported from photocull's `doc_check.py --graph` so
// one renderer can read either repo: the JSON shape is the contract, documented in
// .claude/GUIDE.md and held to it by tests/graph.test.mjs. Change both together, and
// bump GRAPH_VERSION when a consumer would break.
//
// `from` blocks `to`, and `field` is the header the edge is written in — on `to`, for
// both fields here. Edges and prose cover every entry as written, closed ones
// included; `open` says whether the entry's status is an open one in its register.
// Dangling IDs are left out: they are the checks' to report.

const GRAPH_VERSION = 1;
const GRAPH_FIELDS = ['depends_on', 'waiting_on'];

function graph() {
  const entries = [];
  const edges = [];
  const prose = [];
  for (const { reg, entries: es } of loaded) {
    for (const e of es) {
      if (!e.id) continue;
      entries.push({ id: e.id, register: reg.kind, status: e.status, open: reg.open.has(e.status ?? ''), title: e.header.title ?? '' });
      for (const field of GRAPH_FIELDS) {
        for (const id of idsOf(e, field)) {
          if (byId.has(id) && id !== e.id) edges.push({ from: id, to: e.id, field });
        }
        // `user` is the one non-ID a header may name (`waiting_on:`): a blocker with
        // no entry to follow, so it is listed, never chased.
        const v = e.header[field];
        if (v && v.split(/,\s*/).includes('user')) prose.push({ id: e.id, field, text: 'user' });
      }
    }
  }
  return { version: GRAPH_VERSION, entries, edges, prose };
}

/** The text view of graph(): what can start now, the chain behind what can't, and the prose blockers. */
function renderGraph(g) {
  const meta = new Map(g.entries.map((e) => [e.id, e]));
  const order = new Map(g.entries.map((e, n) => [e.id, n]));
  const live = new Set(g.entries.filter((e) => e.open).map((e) => e.id));
  const blockers = new Map([...live].map((i) => [i, []]));
  const unblocks = new Map([...live].map((i) => [i, []]));
  for (const { from: a, to: b } of g.edges) {
    if (live.has(a) && live.has(b) && !blockers.get(b).includes(a)) {
      blockers.get(b).push(a);
      unblocks.get(a).push(b);
    }
  }
  const prose = new Map();
  for (const p of g.prose) if (live.has(p.id)) prose.set(p.id, [...(prose.get(p.id) ?? []), p.text]);
  const byOrder = (a, b) => order.get(a) - order.get(b);

  // Everything downstream, not just the next hop: unblocking one entry that unblocks
  // three is worth more than unblocking two dead ends.
  const downstream = (i) => {
    const seen = new Set();
    const todo = [...unblocks.get(i)];
    while (todo.length) {
      const j = todo.pop();
      if (!seen.has(j) && j !== i) { seen.add(j); todo.push(...unblocks.get(j)); }
    }
    return [...seen].sort(byOrder);
  };
  const tag = (i) => (['proposed', 'open'].includes(meta.get(i).status) ? '' : ` [${meta.get(i).status}]`);

  const ready = [...live].filter((i) => !blockers.get(i).length)
    .map((i) => [i, downstream(i)])
    .sort(([a, da], [b, db]) => db.length - da.length || byOrder(a, b));
  const out = ['Start now (no open blocker), most-unblocking first:'];
  const w = Math.max(3, ...[...live].map((i) => i.length));
  for (const [i, down] of ready) {
    out.push(
      `  ${i.padEnd(w)}  ` + (down.length ? `unblocks ${down.length} (${down.join(', ')}): ` : '') +
        meta.get(i).title + tag(i) + (prose.get(i) ?? []).map((t) => `  [waiting on: ${t}]`).join(''),
    );
  }

  const chain = (i, depth, seen) => {
    const pad = '    ' + '   '.repeat(depth);
    for (const b of blockers.get(i)) {
      const again = seen.has(b) && (blockers.get(b).length || prose.has(b));
      out.push(`${pad}<- ${b} (${meta.get(b).status})${again ? ' (chain shown above)' : ''}`);
      if (!seen.has(b)) { seen.add(b); chain(b, depth + 1, seen); }
    }
    for (const t of prose.get(i) ?? []) out.push(`${pad}<- "${t}"`);
  };
  const blocked = [...live].filter((i) => blockers.get(i).length).sort(byOrder);
  out.push(blocked.length ? '\nBlocked, with the chain behind each:' : '\nBlocked: none');
  for (const i of blocked) {
    out.push(`  ${i} — ${meta.get(i).title}${tag(i)}`);
    chain(i, 0, new Set());
  }
  const pros = g.prose.filter((p) => live.has(p.id));
  out.push(pros.length ? '\nBlockers written as prose (no entry to follow; settle them by hand):' : '\nBlockers written as prose: none');
  for (const p of pros) out.push(`  ${p.id} ${p.field}: ${p.text}`);
  return out.join('\n');
}

// The graph prints whatever the check found — a malformed tree still has a graph worth
// reading — but says so on stderr, since a broken header can drop an edge.
if (graphMode) {
  const g = graph();
  console.log(jsonMode ? JSON.stringify(g, null, 2) : renderGraph(g));
  if (problems.length) {
    console.error(
      `backlog-schema: the check has ${problems.length} violation(s); the graph may be wrong ` +
        `until they're fixed (npm run check:docs)`,
    );
  }
  process.exit(0);
}

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
