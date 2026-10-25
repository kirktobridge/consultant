// groom — the groom report, computed: what /triage groom starts from (P42).
//
// A groom answers five questions about the backlog, and each can be decided from the
// docs and git. A session deriving them by hand misses a dependent silently, so this
// script derives them and the session keeps only the judgement: is the entry still
// accurate, does it need rescoping, is it void, and the spike decision.
//
//   unblocked      an open entry whose dependencies are all met now, at least one of
//                  them since it was drafted — or the dependents of a resolution
//   newly void     the dependents of a refuted assumption, shipped ones included
//   about to block an open assumption or decision holding back a queued entry, or one
//                  in the owner's recorded order
//   stale          an open entry drafted before a dependency or an ad-hoc merge
//                  touching it landed, or still naming a moved or superseded ID
//   abandoned      an `in-progress` entry no branch names
//
// Each item carries the one action it needs. The resolutions' dependents come from
// sweep.mjs, the same answer the session audit's section 4 gives, and the staleness
// rule is the schema check's own (sweep.mjs too). It reads this checkout's docs, as the
// audit's section 4 does, and the trunk's branches and ad-hoc merges. Read-only.
//
// "About to block" reads the queue and the owner's recorded order (D-3, P24): an entry
// the owner has ordered is as near to being built as a queued one.
//
// Exit: 0 nothing to groom | 1 items to act on | 2 could not groom (not a repo, &c.)
//
// Usage: node scripts/groom.mjs [--base <branch>] [--json]
//        node scripts/groom.mjs --for <A-n|D-n>   one resolution's dependents (/ship's sweep)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKLOG, BUGS, ASSUMPTIONS, DECISIONS, EXPERIMENTS, loadRegister, idsOf, parseQueue, parseManualOrder, dependencyMet, buildableRegister } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { DONE, settledDependents, sweepAdvice, staleFlags, readAdhocMerges, branchNames, heldBy } from './sweep.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const stop = (msg) => { console.error(`groom: ${msg}`); process.exit(2); };

// Same git invocation as session-audit: no shell, WSL-safe, for the reasons given there.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
    }).trim();
  } catch { return null; }
};

if (git('rev-parse', '--git-dir') === null) stop('not a git repository, or git refused it — nothing to groom.');
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const { trunk: BASE, error } = trunkFromArgv(argv, branches);
if (error) stop(error);

const backlog = loadRegister(ROOT, BACKLOG).entries;
const bugs = loadRegister(ROOT, BUGS).entries;
const pool = [...backlog, ...bugs];
const settleable = [...loadRegister(ROOT, ASSUMPTIONS).entries, ...loadRegister(ROOT, DECISIONS).entries];
const byId = new Map([...pool, ...settleable, ...loadRegister(ROOT, EXPERIMENTS).entries]
  .filter((e) => e.id).map((e) => [e.id, e]));
const datedKey = (e) => buildableRegister(e.id).dated;
// Settled through its own sweep (settledDependents), not through a landing date.
const settledBySweep = (id) => ASSUMPTIONS.idPattern.test(id) || DECISIONS.idPattern.test(id);

// ── --for: one resolution, for /ship's sweep ─────────────────────────────────

const forAt = argv.indexOf('--for');
if (forAt >= 0) {
  const id = argv[forAt + 1];
  const x = settleable.find((e) => e.id === id);
  if (!x) stop(`--for needs an assumption or decision that has an entry; got ${id ?? 'nothing'}.`);
  const r = settledDependents(x, pool);
  if (asJson) {
    console.log(JSON.stringify(r && { ...r, dependents: r.dependents.map((d) => ({ id: d.id, status: d.status })), advice: sweepAdvice(r) }, null, 2));
  } else if (!r) {
    console.log(`groom: ${id} is still open — nothing to sweep.`);
  } else if (!r.dependents.length) {
    console.log(`groom: ${id} is \`${r.status}\` and no entry still owes it a sweep.`);
  } else {
    console.log(`groom: ${id} is \`${r.status}\` and ${r.dependents.length} entr(y/ies) depend on it: ${r.dependents.map((d) => `${d.id} (${d.status})`).join(', ')}.\n  → ${sweepAdvice(r)}`);
  }
  process.exit(r?.dependents.length ? 1 : 0);
}

// ── The five groups ──────────────────────────────────────────────────────────
// An entry appears once, in the most urgent group that holds it: void before unblocked
// before stale. Each item collects every reason it is there.

const groups = { unblocked: new Map(), void: new Map(), aboutToBlock: new Map(), stale: new Map(), abandoned: new Map() };
const placed = (id) => ['void', 'unblocked', 'stale'].some((g) => groups[g].has(id));
const put = (group, e, why, action) => {
  const item = groups[group].get(e.id) ?? { id: e.id, status: e.status, why: [], action };
  item.why.push(why);
  groups[group].set(e.id, item);
};
const waitsOn = (e) => idsOf(e, 'depends_on').filter((d) => !dependencyMet(d, byId.get(d)?.status ?? null));
const reread = (e) => `re-read ${e.id} against the code and bump \`${datedKey(e)}:\``;

const sweeps = settleable.map((x) => settledDependents(x, pool)).filter((r) => r?.dependents.length);
const settledAt = (r) => `${r.id} ${r.status}${r.date ? ` ${r.date}` : ''}`;

for (const r of sweeps.filter((s) => s.kind === 'void')) {
  for (const e of r.dependents) {
    put('void', e, `${settledAt(r)}`, DONE.has(e.status)
      ? `${e.id} is ${e.status} on a refuted assumption: check whether what shipped rests on it, and file what it broke via /triage.`
      : `${reread(e)}, then rescope or abandon it via /ship if the refutation voided it.`);
  }
}

// Unblocked: every dependency met now, at least one of them since the entry was drafted
// — by a resolution (its sweep, which also reaches a deferred entry parked on it) or by
// a dependency that landed. One still waiting on something else is stale instead: a
// dependency moved under it, but it is not ready.
const merges = readAdhocMerges(git, BASE);
const flags = [[backlog, BACKLOG], [bugs, BUGS]].flatMap(([entries, reg]) => staleFlags(entries, reg, byId, merges ?? []));
const cleared = [
  ...sweeps.filter((s) => s.kind === 'unblocked' || s.kind === 're-read').flatMap((r) => r.dependents.map((e) => ({
    e, why: r.kind === 're-read' ? `${settledAt(r)} — the reason it waited may be gone; re-read it for scope` : settledAt(r),
  }))),
  ...flags.filter((f) => f.depId && !settledBySweep(f.depId)).map((f) => ({
    e: f.entry, why: `${f.depId} landed ${f.landed}, after ${datedKey(f.entry)} ${f.drafted}`,
  })),
];
for (const { e, why } of cleared) {
  if (groups.void.has(e.id)) continue;
  const held = waitsOn(e);
  if (held.length) put('stale', e, `${why}; still waits on ${held.join(', ')}`, `Presumptively stale: ${reread(e)}, or rescope it via /ship, before building.`);
  else put('unblocked', e, why, BUGS.idPattern.test(e.id)
    ? `${reread(e)}; a ready bug is picked up before the queue.`
    : `${reread(e)}; /ship's \`npm run queue\` ranks it.`);
}

// Stale: a dead ID to re-point, or a change that landed since the entry was drafted.
for (const r of sweeps.filter((s) => s.kind === 're-point')) {
  for (const e of r.dependents) {
    if (groups.void.has(e.id) || groups.unblocked.has(e.id)) continue;
    put('stale', e, `names ${r.id}, which is ${r.status}`, sweepAdvice(r));
  }
}
// A dependency's flag was placed above, through its sweep or as cleared; an ad-hoc
// merge has no dependency to clear, so it can only make an entry stale.
for (const f of flags.filter((x) => x.merge)) {
  const e = f.entry;
  if (placed(e.id) && !groups.stale.has(e.id)) continue;
  put('stale', e, `ad-hoc merge ${f.merge.sha} names it, landed ${f.landed}, after ${datedKey(e)} ${f.drafted}`,
    `Presumptively stale: ${reread(e)}, or rescope it via /ship, before building.`);
}

// About to block: an open assumption or decision holding back anything queued or ordered.
const readOr = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : '');
const queued = parseQueue(readOr(BACKLOG.queue)).ids;
const ordered = parseManualOrder(readOr(BACKLOG.manualOrder)).ids.filter((id) => !queued.includes(id));
for (const x of settleable.filter((s) => s.status === 'open')) {
  const held = [...heldBy(x.id, pool)];
  const holds = [
    [held.filter((id) => queued.includes(id)), (ids) => `holds queued ${ids}`],
    [held.filter((id) => ordered.includes(id)), (ids) => `holds ${ids}, in the recorded order`],
  ].filter(([ids]) => ids.length).map(([ids, say]) => say(ids.join(', ')));
  if (!holds.length) continue;
  put('aboutToBlock', x, holds.join('; '), ASSUMPTIONS.idPattern.test(x.id)
    ? `Take the spike decision (/triage): settle ${x.id} now if it is cheap, build its spike, or rescope what it holds.`
    : `Ask the owner to decide ${x.id}; /ship records it.`);
}

// Abandoned: a claim no branch names. A merged one awaits acceptance instead, and the
// session audit reports that.
const others = branches.filter((b) => b !== BASE);
for (const e of pool.filter((x) => x.status === 'in-progress')) {
  const names = branchNames(e.id);
  if (others.some((b) => names.test(b))) continue;
  put('abandoned', e, 'no branch names it', `Ask the owner whether it is abandoned; if so, /ship clears it back to \`${BUGS.idPattern.test(e.id) ? 'open' : 'proposed'}\`.`);
}

// ── Report ───────────────────────────────────────────────────────────────────

const warning = merges === null ? `could not read ${BASE}'s history for ad-hoc merges; stale omits them` : null;
const out = Object.fromEntries(Object.entries(groups).map(([g, m]) => [g, [...m.values()]]));
const total = Object.values(out).reduce((n, items) => n + items.length, 0);

if (asJson) {
  console.log(JSON.stringify({ base: BASE, groups: out, ...(warning && { warning }) }, null, 2));
  process.exit(total ? 1 : 0);
}

const TITLE = { unblocked: 'Unblocked', void: 'Newly void', aboutToBlock: 'About to block', stale: 'Stale', abandoned: 'Abandoned' };
const lines = [total
  ? `groom: ${total} item(s) to act on (base ${BASE}). Nothing is applied: propose each action and let the owner choose.`
  : `groom: nothing to groom (base ${BASE}).`];
if (warning) lines.push(`  (${warning})`);
for (const [g, items] of Object.entries(out)) {
  lines.push('', `${TITLE[g]}: ${items.length || 'none'}`);
  for (const i of items) lines.push(`  ${i.id} (${i.status}) — ${i.why.join('; ')}`, `      → ${i.action}`);
}
console.log(lines.join('\n'));
process.exit(total ? 1 : 0);
