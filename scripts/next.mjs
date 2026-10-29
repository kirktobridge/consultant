// next — what /implement builds when it is given no ID (P5 R1).
//
// Every open bug comes before the queue. A bug is never ranked into QUEUE.md: the queue
// says which feature is worth building next, and "this is broken" is not weighed against
// features, it goes first. Bugs are taken most urgent first — the severity order in
// entries.mjs — then the oldest report, then the lowest number. Only when no bug is
// ready does the queue's head come up.
//
// "Ready" is /implement's DEPENDS GATE, applied before the proposal rather than after
// it, and judged by one function (holdsOf) in both modes (P37): a dependency that is an
// unshipped `P#` (directly or through another entry), an unfixed `B#`, an `open` `A-n` /
// `D-n`, or an ID with no entry holds the entry back. A held bug is printed with what
// holds it; a held queue entry is skipped for the next one, naming what holds it. A claimed
// entry (`in-progress`) is skipped too: someone else's build, or one that has landed and
// waits on the owner's acceptance — the reason says which (landing.mjs). Every claimed
// bug gets a `claimed:` line saying which, so a bug the owner reopened reads as being
// built again (P60).
//
// Everything is read from the integration branch, never the checked-out copy, for the
// claim gate's reason: a worktree's files are as old as its branch.
//
// `--count N` is the batch an orchestrator hands to parallel subagents (P17): up to N
// entries from the queue, in its order, each dependency-ready. An entry that depends on
// one picked earlier in the same batch is skipped, since that one is not shipped yet —
// P23's graph decides, the same walk the schema check makes. Overlap is no reason to
// skip: a collision costs a rebase at landing, not a broken main. A batch picks from the
// queue only; a ready bug is named, for /implement to take on its own.
//
// Exit: 0 an ID was proposed (first stdout line: `next: <ID>`; with --count, one
// `picked: <ID>` line each) | 1 nothing is ready to build | 2 could not run (not a
// repo, no integration branch, a bad --count)
//
// Usage: node scripts/next.mjs [--base <branch>] [--count <N>] [--json]

import { execFileSync } from 'node:child_process';
import { REGISTERS, BACKLOG, BUGS, parseEntry, parseQueue, dependencyGraph, holdsOf } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { landings } from './landing.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

// Same git invocation as worktree.mjs, for the reasons given in session-audit.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
let lastError = '';
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
    }).trim();
  } catch (e) {
    lastError = String(e.stderr ?? e.message ?? '').trim();
    return null;
  }
};
const stop = (msg) => { console.error(`next: ${msg}`); process.exit(2); };

if (git('rev-parse', '--git-dir') === null) stop(`not a git repository, or git refused it.${lastError ? ` git: ${lastError.split('\n')[0]}` : ''}`);
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const { trunk: BASE, error: baseError } = trunkFromArgv(argv, branches);
if (baseError) stop(baseError);
const countAt = argv.indexOf('--count');
const COUNT = countAt < 0 ? null : (/^\d+$/.test(argv[countAt + 1] ?? '') ? Number(argv[countAt + 1]) : 0);
if (countAt >= 0 && !(COUNT > 0)) stop(`--count needs a whole number above 0, not "${argv[countAt + 1] ?? ''}".`);

// ── The registers, as they are on the integration branch ─────────────────────

const byId = new Map();
const entriesOf = (reg) => {
  const files = (git('ls-tree', '--name-only', `${BASE}:${reg.dir}`) || '').split('\n')
    .filter((f) => /\.md$/.test(f) && reg.idPattern.test(f.replace(/\.md$/, '')));
  return files.map((f) => {
    const { header } = parseEntry(git('show', `${BASE}:${reg.dir}/${f}`) ?? '', reg.keys);
    const e = { id: header.id ?? f.replace(/\.md$/, ''), status: header.status ?? null, header };
    byId.set(e.id, e);
    return e;
  });
};
const loaded = new Map(REGISTERS.map((r) => [r, entriesOf(r)]));

// A claimed entry is skipped either way; the reason says whether a session is still
// building it or it has landed and waits on the owner's acceptance (B4).
const { landedAt } = landings(git, BASE, { branches });
const claimed = (id) => {
  const at = landedAt(id);
  return at ? { short: `${id} (landed ${at.slice(0, 10)}, awaiting the owner's acceptance)`, why: `landed ${at.slice(0, 10)}, awaiting the owner's acceptance`, landed: at }
    : { short: `claimed ${id}`, why: 'claimed (in-progress): another session is building it' };
};

// What holds an entry is entries.mjs's holdsOf, for bugs, a single pick and a batch alike,
// so the two modes can't disagree about readiness (P37). `picked` names a hold picked
// earlier in the same batch: not shipped yet, so it holds, but it is no open question.
const graph = dependencyGraph(loaded.get(BACKLOG));
const holding = (e, picked = []) => holdsOf(e, graph, (id) => byId.get(id)?.status ?? null)
  .map((h) => `${h.id} (${picked.includes(h.id) ? 'picked in this batch' : h.status ?? 'no entry'})`
    + (h.path.length > 2 ? ` via ${h.path.slice(1, -1).join(' → ')}` : ''));

// ── Bugs first ───────────────────────────────────────────────────────────────

const rank = (s) => { const i = BUGS.severity.indexOf(s); return i < 0 ? BUGS.severity.length : i; };
const open = loaded.get(BUGS).filter((b) => b.status === 'open')
  .sort((a, b) => rank(a.header.severity) - rank(b.header.severity)
    || String(a.header.reported ?? '').localeCompare(String(b.header.reported ?? ''))
    || Number(a.id.slice(1)) - Number(b.id.slice(1)));
const held = open.map((b) => ({ id: b.id, severity: b.header.severity ?? null, on: holding(b) })).filter((h) => h.on.length);
const bug = open.find((b) => !held.some((h) => h.id === b.id));
// A claimed bug is never picked, but it is named with its state, as a skipped queue entry
// is: being built, landed and awaiting the owner, or reopened and being built again (P60).
// A claim with no landing and no branch is not "being built" by anyone: say what it is.
const claimedBugs = loaded.get(BUGS).filter((b) => b.status === 'in-progress').map((b) => {
  const { why, landed } = claimed(b.id);
  if (landed) return { id: b.id, why, landed };
  if (branches.some((br) => br.toLowerCase().startsWith(`feat/${b.id.toLowerCase()}-`))) return { id: b.id, why };
  const last = String(b.header.rejected ?? '').split(/,\s*/).filter(Boolean).at(-1);
  return { id: b.id, why: last
    ? `reopened ${last}: claimed to be built again, no branch yet`
    : 'claimed (in-progress), but no branch builds it: an abandoned claim, or one about to start' };
});

// ── Then the queue ───────────────────────────────────────────────────────────

const queueText = git('show', `${BASE}:${BACKLOG.queue}`);
const queued = queueText === null ? [] : parseQueue(queueText).ids;

// Up to `n` entries from the queue, in its order, each dependency-ready, and why each
// one passed over was. A single pick is this walk with n = 1, so it skips what a batch
// skips, for the same reason.
const walk = (n) => {
  const picked = [];
  const skipped = [];
  for (const id of queued) {
    if (picked.length >= n) break;
    const e = byId.get(id);
    if (!e) { skipped.push({ id, kind: 'no entry', why: 'queued but has no entry' }); continue; }
    if (e.status === 'in-progress') {
      // `landed` lets a JSON reader tell "waits on the owner" from "being built" without the prose.
      const { short, why, landed } = claimed(id);
      skipped.push({ id, kind: 'claimed', why, short, ...(landed && { landed }) });
      continue;
    }
    const on = holding(e, picked);
    if (on.length) { skipped.push({ id, kind: 'held', why: `waits on ${on.join(', ')}` }); continue; }
    picked.push(id);
  }
  // A claim is named in the pick's own line (`short`, kept in the JSON so session-audit's
  // banner words it the same, B16); a held or entry-less one gets a line of its own.
  return { picked, skipped, shorts: skipped.filter((s) => s.short).map((s) => s.short) };
};

// ── A batch (--count) ────────────────────────────────────────────────────────

if (COUNT !== null) {
  const { picked, skipped } = walk(COUNT);
  if (asJson) {
    console.log(JSON.stringify({ base: BASE, asked: COUNT, picked, skipped, readyBug: bug?.id ?? null, held, claimedBugs, queued }));
  } else {
    console.log(`batch: ${picked.length} of ${COUNT} asked, from ${BACKLOG.queue} on ${BASE}`);
    for (const id of picked) console.log(`  picked: ${id}`);
    for (const s of skipped) console.log(`  skipped: ${s.id} — ${s.why}`);
    if (bug) console.log(`  note: ${bug.id} (${bug.header.severity} bug) is ready and goes before the queue; a batch picks from the queue only, so /implement ${bug.id} takes it on its own`);
    for (const h of held) console.log(`  held: ${h.id} (${h.severity} bug) waits on ${h.on.join(', ')}`);
    for (const c of claimedBugs) console.log(`  claimed: ${c.id} (bug) — ${c.why}`);
  }
  process.exit(picked.length ? 0 : 1);
}

const { picked: [head = null], skipped, shorts } = walk(1);
const queuePick = head ? { id: head, from: 'queue', why: `head of ${BACKLOG.queue}${shorts.length ? ` (skipping ${shorts.join(', ')})` : ''}` } : null;
const pick = bug
  ? { id: bug.id, from: 'bugs', severity: bug.header.severity ?? null, why: `${bug.header.severity} bug, reported ${bug.header.reported} — every open bug is picked up before the queue, most severe first` }
  : queuePick;

if (asJson) {
  // `skipped` is the queue walk's, up to the queue pick, and is given even when a bug is picked;
  // so is `queuePick`, what the queue offers after the bug (session-audit's banner, B16).
  console.log(JSON.stringify({ base: BASE, next: pick, queuePick, skipped, held, claimedBugs, openBugs: open.length, queued }));
} else {
  if (pick) console.log(`next: ${pick.id}\n  ${pick.why}`);
  else console.log(`next: nothing ready — ${open.length} open bug(s), ${queued.length} queued ID(s) on ${BASE}, none buildable now.`);
  if (pick?.from !== 'bugs') for (const s of skipped.filter((s) => s.kind !== 'claimed')) console.log(`  skipped: ${s.id} — ${s.why}`);
  for (const h of held) console.log(`  held: ${h.id} (${h.severity} bug) waits on ${h.on.join(', ')}`);
  for (const c of claimedBugs) console.log(`  claimed: ${c.id} (bug) — ${c.why}`);
}
process.exit(pick ? 0 : 1);
