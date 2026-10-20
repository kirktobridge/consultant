// next — what /implement builds when it is given no ID (P5 R1).
//
// Every open bug comes before the queue. A bug is never ranked into QUEUE.md: the queue
// says which feature is worth building next, and "this is broken" is not weighed against
// features, it goes first. Bugs are taken most urgent first — the severity order in
// entries.mjs — then the oldest report, then the lowest number. Only when no bug is
// ready does the queue's head come up.
//
// "Ready" is /implement's DEPENDS GATE, applied before the proposal rather than after
// it: a dependency that is an unshipped `P#`, an unfixed `B#`, or an `open` `A-n` /
// `D-n` holds the bug back, and this prints it as held with what holds it. A claimed
// entry (`in-progress`) is someone else's build, so it is skipped too.
//
// Everything is read from the integration branch, never the checked-out copy, for the
// claim gate's reason: a worktree's files are as old as its branch.
//
// Exit: 0 an ID was proposed (first stdout line: `next: <ID>`) | 1 nothing is ready to
// build | 2 could not run (not a repo, no integration branch)
//
// Usage: node scripts/next.mjs [--base <branch>] [--json]

import { execFileSync } from 'node:child_process';
import { REGISTERS, BACKLOG, BUGS, parseEntry, parseQueue, idsOf, dependencyMet } from './entries.mjs';

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf('--base');
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
const BASE = (baseIdx >= 0 ? argv[baseIdx + 1] : null) || ['main', 'master', 'trunk'].find((b) => branches.includes(b)) || null;
if (!BASE || !branches.includes(BASE)) stop(`no integration branch found (looked for ${baseIdx >= 0 ? argv[baseIdx + 1] : 'main/master/trunk'} among: ${branches.join(', ') || 'none'}). Pass --base <branch>.`);

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

const holding = (e) => idsOf(e, 'depends_on').filter((id) => !dependencyMet(id, byId.get(id)?.status))
  .map((id) => `${id} (${byId.get(id)?.status ?? 'no entry'})`);

// ── Bugs first ───────────────────────────────────────────────────────────────

const rank = (s) => { const i = BUGS.severity.indexOf(s); return i < 0 ? BUGS.severity.length : i; };
const open = loaded.get(BUGS).filter((b) => b.status === 'open')
  .sort((a, b) => rank(a.header.severity) - rank(b.header.severity)
    || String(a.header.reported ?? '').localeCompare(String(b.header.reported ?? ''))
    || Number(a.id.slice(1)) - Number(b.id.slice(1)));
const held = open.map((b) => ({ id: b.id, severity: b.header.severity ?? null, on: holding(b) })).filter((h) => h.on.length);
const bug = open.find((b) => !held.some((h) => h.id === b.id));

// ── Then the queue ───────────────────────────────────────────────────────────

const queueText = git('show', `${BASE}:${BACKLOG.queue}`);
const queued = queueText === null ? [] : parseQueue(queueText).ids;
const head = queued.find((id) => byId.get(id)?.status !== 'in-progress') ?? null;

let pick = null;
if (bug) {
  pick = { id: bug.id, from: 'bugs', why: `${bug.header.severity} bug, reported ${bug.header.reported} — every open bug is picked up before the queue, most severe first` };
} else if (head) {
  pick = { id: head, from: 'queue', why: `head of ${BACKLOG.queue}${head !== queued[0] ? ` (skipping claimed ${queued.slice(0, queued.indexOf(head)).join(', ')})` : ''}` };
}

if (asJson) {
  console.log(JSON.stringify({ base: BASE, next: pick, held, openBugs: open.length, queued }));
} else {
  if (pick) console.log(`next: ${pick.id}\n  ${pick.why}`);
  else console.log(`next: nothing ready — ${open.length} open bug(s), ${queued.length} queued ID(s) on ${BASE}, none buildable now.`);
  for (const h of held) console.log(`  held: ${h.id} (${h.severity} bug) waits on ${h.on.join(', ')}`);
}
process.exit(pick ? 0 : 1);
