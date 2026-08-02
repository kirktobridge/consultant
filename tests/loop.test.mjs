// Layer 3a — the loop walked end to end, on a fake project.
//
// Everything else in tests/ checks one rule in isolation. This walks a project through
// the states the docs describe, in order, asserting what is legal at each step. It
// catches the class of bug unit tests structurally cannot: **interactions**. Step 7
// only passes because step 6 happened, and nothing but a walk can assert that.
//
// The walk is also the only executable statement of what the system *is*. BACKLOG.md's
// examples are hand-maintained fiction; this is fiction that has to stay consistent or
// the build goes red.
//
// Deliberately model-free. Whether an agent reading /implement actually runs the
// DEPENDS GATE is a question about prompts, which is an evaluation — non-deterministic,
// rubric-graded, and not something to smuggle into a test suite that gates CI.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { P, OD, project, schema, out, cleanupAll, daysAgo } from './helpers/fixture.mjs';

after(cleanupAll);

/** The whole project state, as data. A "transition" returns the next state. */
const state = (over = {}) => ({ backlog: [], decisions: [], nextUp: [], ...over });

const legal = (s, why) => {
  const r = schema(project(s));
  assert.equal(r.code, 0, `${why}\nexpected LEGAL, got:\n${out(r)}`);
};
const illegal = (s, why, needle) => {
  const r = schema(project(s));
  assert.equal(r.code, 1, `${why}\nexpected ILLEGAL, but it passed`);
  if (needle) assert.match(out(r), needle, why);
};

describe('the full loop: an idea blocked on an assumption, settled by a spike', () => {
  // The cast. `feature` is what we actually want; `assumption` is what it rests on;
  // `spike` is the work that settles the assumption.
  const feature = (over) => P('P2', { title: 'batching, sized to the real limit', ...over });
  const spike = (over) => P('P3', { title: 'measure the real rate limit', resolves: 'OD-1', ...over });
  const other = P('P1', { title: 'unrelated queued work' });

  test('1. /triage files a feature that rests on an unchecked assumption', () => {
    // Blocked-not-rejected: it exists, it names its blocker, it sits in the pool.
    legal(
      state({
        backlog: [other, feature({ dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1')],
        nextUp: ['P1'],
      }),
      'a blocked draft must be filable, or the register can only ever reject ideas',
    );
  });

  test('2. …but it may not be queued while the assumption is open', () => {
    illegal(
      state({
        backlog: [other, feature({ dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1')],
        nextUp: ['P1', 'P2'],
      }),
      'the queue claims dependency-ready',
      /P2 is in `## Next up`/,
    );
  });

  test('3. …and it may not be claimed either', () => {
    illegal(
      state({
        backlog: [other, feature({ status: 'in-progress', dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1')],
        nextUp: ['P1'],
      }),
      'nobody may build on an unverified figure',
      /P2 is `in-progress`/,
    );
  });

  test('4. the assumption is blocking the queue, so /triage promotes a spike', () => {
    // The spike is unblocked (it depends on nothing) and therefore queueable, while
    // the feature it serves stays parked.
    legal(
      state({
        backlog: [other, feature({ dependsOn: ['OD-1'] }), spike()],
        decisions: [OD('OD-1')],
        nextUp: ['P1', 'P3'],
      }),
      'a spike must be queueable even though the assumption it answers is open',
    );
  });

  test('5. the spike is built and claimed', () => {
    legal(
      state({
        backlog: [other, feature({ dependsOn: ['OD-1'] }), spike({ status: 'in-progress' })],
        decisions: [OD('OD-1')],
        nextUp: ['P1', 'P3'],
      }),
      'building the spike is exactly what should be allowed here',
    );
  });

  test('6. shipping the spike WITHOUT writing the answer back is refused', () => {
    illegal(
      state({
        backlog: [other, feature({ dependsOn: ['OD-1'] }), spike({ status: 'shipped' })],
        decisions: [OD('OD-1')],
        nextUp: ['P1'],
      }),
      'the whole point of the spike was the answer',
      /P3 shipped and resolves OD-1, but OD-1 is still `open`/,
    );
  });

  test('7. /ship writes the Resolution and closes the pair', () => {
    legal(
      state({
        backlog: [other, feature({ drafted: daysAgo(0), dependsOn: ['OD-1'] }), spike({ status: 'shipped' })],
        decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(0)} — 40/min.` })],
        nextUp: ['P1'],
      }),
      'spike and assumption must be able to close together',
    );
  });

  test('7b. but a dependent drafted BEFORE the answer must be re-read first', () => {
    // The step that is easy to miss, and the reason step 8 needs a re-dated entry.
    // Settling the assumption moved the ground under P2: it was written when the limit
    // was believed to be something else, so its scope may no longer make sense. The
    // staleness rule holds it until a human re-reads it and bumps `Drafted:` — which is
    // /triage groom's job, and is a re-read, never a date bump to quiet the check.
    illegal(
      state({
        backlog: [other, feature({ drafted: daysAgo(30), dependsOn: ['OD-1'] }), spike({ status: 'shipped' })],
        decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(0)} — 40/min.` })],
        nextUp: ['P1'],
      }),
      'resolving an assumption must force a re-read of what was written under it',
      /presumptively stale/,
    );
  });

  test('8. re-read and re-dated, the feature is queueable — ONLY because of step 7', () => {
    const resolved = OD('OD-1', { status: 'verified', resolution: `${daysAgo(0)} — 40/min.` });
    const queued = state({
      backlog: [other, feature({ drafted: daysAgo(0), dependsOn: ['OD-1'] }), spike({ status: 'shipped' })],
      decisions: [resolved],
      nextUp: ['P1', 'P2'],
    });
    legal(queued, 'a resolved assumption must actually unblock its dependents');

    // The counterfactual is the real assertion. Same queue, assumption still open →
    // illegal. Without this, step 8 could be passing for an unrelated reason.
    illegal(
      { ...queued, decisions: [OD('OD-1')] },
      'if this passes, step 8 proved nothing about the resolution',
      /P2 is in `## Next up`/,
    );
  });

  test('9. the feature is claimed and built', () => {
    legal(
      state({
        backlog: [
          other,
          feature({ status: 'in-progress', drafted: daysAgo(0), dependsOn: ['OD-1'] }),
          spike({ status: 'shipped' }),
        ],
        decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(0)} — 40/min.` })],
        nextUp: ['P1'],
      }),
      'the feature was unblocked in step 7 and may now be built',
    );
  });

  test('10. shipping it without refreshing the queue is refused', () => {
    illegal(
      state({
        backlog: [
          other,
          feature({ status: 'shipped', drafted: daysAgo(0), dependsOn: ['OD-1'] }),
          spike({ status: 'shipped' }),
        ],
        decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(0)} — 40/min.` })],
        nextUp: ['P1', 'P2'],
      }),
      '/ship must refresh Next up on a terminal flip',
      /Next-up P2 is terminal/,
    );
  });

  test('11. queue refreshed — the loop closes clean', () => {
    legal(
      state({
        backlog: [
          other,
          feature({ status: 'shipped', drafted: daysAgo(0), dependsOn: ['OD-1'] }),
          spike({ status: 'shipped' }),
        ],
        decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(0)} — 40/min.` })],
        nextUp: ['P1'],
      }),
      'the terminal state of a completed loop must be representable',
    );
  });
});

describe('the refutation branch: the assumption was wrong', () => {
  test('a spike may close by REFUTING, and the pair still closes', () => {
    legal(
      state({
        backlog: [P('P1'), P('P3', { status: 'shipped', resolves: 'OD-1' })],
        decisions: [OD('OD-1', { status: 'refuted', resolution: `${daysAgo(0)} — wrong, it is 10/min.` })],
        nextUp: ['P1'],
      }),
      'refuting is a legitimate close — it is the most valuable one',
    );
  });

  test('a dependent drafted before the refutation is flagged for re-reading', () => {
    illegal(
      state({
        backlog: [
          P('P1'),
          P('P2', { drafted: daysAgo(30), dependsOn: ['OD-1'] }),
          P('P3', { status: 'shipped', resolves: 'OD-1' }),
        ],
        decisions: [OD('OD-1', { status: 'refuted', resolution: `${daysAgo(1)} — wrong.` })],
        nextUp: ['P1'],
      }),
      'an entry written under a premise that has since been disproved must not pass silently',
      /presumptively stale/,
    );
  });
});

describe('the parallel-session invariant', () => {
  test('two entries may be in-progress at once — claims do not serialise the backlog', () => {
    legal(
      state({
        backlog: [P('P1', { status: 'in-progress' }), P('P2', { status: 'in-progress' }), P('P4')],
        nextUp: ['P4'],
      }),
      'one branch per session, but several sessions — the docs must permit concurrent claims',
    );
  });
});
