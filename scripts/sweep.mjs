// sweep — what changed under an open entry, decided once for every reader (P42).
//
// The session audit, groom and /ship's sweep each ask what a resolution did to the
// entries that name it, and each used to answer on its own, so the answers drifted:
// one read features only, one worded a superseded decision as an unblock. Answered
// once, here, they can't disagree. The schema check's staleness rule lives here for the
// same reason: groom lists the entries the check flags.
//
//   settledDependents  what an assumption's or decision's outcome did to the entries
//                      that name it: unblocked, possibly void, or owed a re-point
//   isRecent           whether a resolution is news — settled today, or its own file
//                      changed against the trunk
//   staleFlags         an open entry drafted before a dependency closed, or before an
//                      ad-hoc merge naming it
//   readAdhocMerges    the ad-hoc merges on the trunk that staleness reads
//   heldBy             every open entry an ID holds back, directly or through another
//
// No writes and no git of its own: a caller passes its `git`, so every reader keeps its
// own invocation (and its own reasons for it).

import { BACKLOG, BUGS, ASSUMPTIONS, DECISIONS, EXPERIMENTS, RUNS, FINDINGS, idsOf, isId, newHomeOf } from './entries.mjs';

const LIFECYCLES = [BACKLOG, BUGS, ASSUMPTIONS, DECISIONS, EXPERIMENTS, RUNS, FINDINGS];
/** The register an ID belongs to, research registers included, or undefined. */
const lifecycleOf = (id) => LIFECYCLES.find((r) => r.idPattern.test(id ?? ''));
/** An entry's header date for when its claims were established. */
const datedOf = (e) => e.header[lifecycleOf(e.id)?.dated];

// Entries done for good. `deferred` is not among them: an entry parked on an open
// question is the one most worth hearing that the question settled.
export const DONE = new Set(['shipped', 'abandoned', 'fixed', 'wontfix']);

// What each outcome does to the entries that name it. Only a verified assumption or a
// decision unblocks (P25). A refutation may void them. `moot` settled nothing they
// were waiting to learn, and the reason they waited may be gone with it. `moved` and
// `superseded` settled nothing at all: their dependents point at a dead ID (B10).
const KIND = {
  verified: 'unblocked', decided: 'unblocked', refuted: 'void', moot: 're-read',
  moved: 're-point', superseded: 're-point',
};

/**
 * What a settled assumption or decision did to its dependents, or null while it is
 * open. `pool` is the entries that may depend on it — features and bugs both.
 *
 * Shipped work may rest on a false premise, so a refutation names every dependent;
 * every other outcome is advice about what to build next, and a done entry isn't built
 * again. A re-point names every live dependent still pointing at the dead ID. Otherwise
 * an open dependent re-dated on or after the resolution has been re-read since, and is
 * left out — the date rule the staleness check uses.
 */
export function settledDependents(x, pool) {
  const kind = KIND[x.status];
  if (!kind) return null;
  const date = x.header[lifecycleOf(x.id)?.closed] ?? null;
  const dependents = pool.filter((e) => {
    if (!idsOf(e, 'depends_on').includes(x.id)) return false;
    if (DONE.has(e.status)) return kind === 'void';
    if (kind === 're-point') return true;
    const dated = datedOf(e);
    return !(date && dated && dated >= date);
  });
  return { id: x.id, status: x.status, kind, date, to: newHomeOf(x), dependents };
}

/** The advice for a settledDependents result, worded the same for every reader. */
export function sweepAdvice({ id, status, kind, to }) {
  if (kind === 'void') return 'A refutation can VOID dependents rather than unblock them — re-read each against the new truth, and check whether anything already shipped on the false assumption.';
  if (kind === 're-read') return 'The question stopped mattering, so it settled nothing these entries were waiting to learn. Re-read each for scope, since the reason it waited may be gone too, before any goes into the queue via /ship.';
  if (kind === 're-point') {
    const [key, verb] = status === 'moved' ? ['moved_to', 'refiled as'] : ['superseded_by', 'superseded by'];
    return to.length
      ? `Nothing was settled: ${id} was ${verb} ${to.join(', ')}. Re-point each dependent's \`depends_on:\` from ${id} to ${to.join(', ')} via /ship; the schema check fails an open entry that names a ${status} ID.`
      : `Nothing was settled, and ${id} records no \`${key}:\`, so there is nowhere to re-point its dependents yet. Record where it ${status === 'moved' ? 'moved' : 'went'} via /ship first.`;
  }
  return 'These are now unblocked and nothing else will notice. Have /ship run `npm run queue`: the queue is generated, and may now take one.';
}

/**
 * Whether a settled entry is news: settled today, or its own file is among `changed`
 * (paths, as `git diff --name-only` prints them). Its own file, not its register's
 * folder: an edit to one resolution re-raises that one, not every settled entry beside it.
 */
export const isRecent = (x, changed, today) =>
  x.header[lifecycleOf(x.id)?.closed] === today || changed.includes(x.file);

/**
 * The schema check's staleness rule, for one register's entries: each open entry
 * drafted before a dependency closed (`{ entry, drafted, depId, landed }`) or before an
 * ad-hoc merge that names it (`{ entry, drafted, merge, landed }`). Presumptively stale:
 * the change usually moved the very code the entry describes. Conservative by
 * construction: it fires only when both dates parse, so a missing date never invents
 * an alarm. A date on or before `drafted:` is one the entry was written knowing about,
 * so re-dating after a re-read clears it.
 */
export function staleFlags(entries, reg, byId, merges = []) {
  const flags = [];
  for (const e of entries) {
    if (!reg.open.has(e.status ?? '')) continue;
    const drafted = e.header[reg.dated];
    if (!drafted) continue;
    for (const depId of idsOf(e, 'depends_on')) {
      const dep = byId.get(depId);
      const r = lifecycleOf(depId);
      if (!dep || !r?.terminal.has(dep.status ?? '')) continue;
      const landed = dep.header[r.closed];
      if (!landed || landed <= drafted) continue;
      flags.push({ entry: e, drafted, depId, landed });
    }
    for (const m of merges) {
      if (!m.relates.includes(e.id) || m.date <= drafted) continue;
      flags.push({ entry: e, drafted, merge: m, landed: m.date });
    }
  }
  return flags;
}

/**
 * The ad-hoc merges on `trunk` (P34): `[{ sha, date, relates }]`, or null when its
 * history can't be read. An ad-hoc merge is one carrying an `Ad-hoc:` trailer, which
 * land.mjs refuses to merge an `adhoc/` branch without. Read from the trunk, never
 * HEAD: in a worktree, HEAD is a branch cut before the merges that matter.
 */
export function readAdhocMerges(git, trunk) {
  const fmt = '%h%x1f%cs%x1f%(trailers:key=Ad-hoc,valueonly,separator=%x20)%x1f%(trailers:key=Relates,valueonly,separator=%x2C)%x1e';
  const log = git('log', '--first-parent', '--merges', '--grep=^Ad-hoc:', `--format=${fmt}`, trunk, '--');
  if (log === null) return null;
  return log
    .split('\x1e')
    .map((r) => r.trim().split('\x1f'))
    .filter(([sha, , adhoc]) => sha && adhoc?.trim())
    .map(([sha, date, , relates = '']) => ({
      sha,
      date,
      // IDs, not tokens: a hand-written `Relates: P2.` still names P2, and `R0` names nothing.
      relates: (relates.toUpperCase().match(/\b[A-Z]-?\d+\b/g) ?? []).filter(isId),
    }));
}

/**
 * Whether a branch name is an entry's. A word match, not a substring: `includes('p1')`
 * read feat/p18-… as P1's branch, which hid an abandoned P1 claim behind any branch
 * whose ID starts with 1.
 */
export const branchNames = (id) => new RegExp(`\\b${id}\\b`, 'i');

/**
 * Every entry in `pool` that `id` holds back: each one naming it in `depends_on:`, and
 * each one waiting on one of those, until a done entry stops the walk.
 */
export function heldBy(id, pool) {
  const held = new Set();
  const walk = (from) => {
    for (const e of pool) {
      if (held.has(e.id) || DONE.has(e.status) || !idsOf(e, 'depends_on').includes(from)) continue;
      held.add(e.id);
      walk(e.id);
    }
  };
  walk(id);
  return held;
}
