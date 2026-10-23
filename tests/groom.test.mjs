// groom.mjs (P42) — the five groups, against real git repositories.
//
// Like the session audit, nothing is mocked: groom reads real branches and merges, so
// a faked git would test the opposite of the thing. Each group is asserted through
// --json, so a change of wording can't pass or fail a test about membership; the
// wording that matters (a re-point names its target) is asserted on the text.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { P, B, A, D, X, N, decidedD, project, gitInit, run, out, daysAgo, tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const NOTHING = 0;
const ITEMS = 1;
const CANNOT = 2;

function repo(state) {
  const dir = project(state);
  const g = gitInit(dir);
  return { dir, g };
}
const groom = (dir, args = []) => run('groom.mjs', args, { cwd: dir });
const groups = (dir) => {
  const r = groom(dir, ['--json']);
  assert.ok(r.code === NOTHING || r.code === ITEMS, out(r));
  return JSON.parse(r.stdout).groups;
};
const ids = (items) => items.map((i) => i.id);

describe('unblocked and newly void', () => {
  test('an assumption verified after an entry was drafted lists the entry as unblocked', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { drafted: daysAgo(10), dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(2), resolution: 'held.' })],
    });
    const g = groups(dir);
    assert.deepEqual(ids(g.unblocked), ['P2']);
    assert.deepEqual(ids(g.void), []);
    assert.equal(groom(dir).code, ITEMS);
  });

  test('refuted instead, the entry and a shipped dependent are listed as possibly void', () => {
    const { dir } = repo({
      backlog: [
        P('P1'),
        P('P2', { drafted: daysAgo(10), dependsOn: ['A-1'] }),
        P('P3', { status: 'shipped', shipped: daysAgo(5), dependsOn: ['A-1'] }),
      ],
      assumptions: [A('A-1', { status: 'refuted', resolved: daysAgo(2), resolution: 'wrong.' })],
    });
    const g = groups(dir);
    assert.deepEqual(ids(g.void), ['P2', 'P3']);
    assert.deepEqual(ids(g.unblocked), [], 'a void entry is listed once, in the more urgent group');
  });

  test('an entry re-dated after the resolution has been re-read, and is not listed again', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { drafted: daysAgo(1), dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(2), resolution: 'held.' })],
    });
    assert.deepEqual(ids(groups(dir).unblocked), []);
  });

  test('a feature that shipped after its dependent was drafted unblocks it', () => {
    const { dir } = repo({
      backlog: [P('P1', { status: 'shipped', shipped: daysAgo(1) }), P('P2', { drafted: daysAgo(10), dependsOn: ['P1'] })],
      nextUp: [],
    });
    const [item] = groups(dir).unblocked;
    assert.equal(item?.id, 'P2');
    assert.match(item.why.join(), /P1 landed/);
  });

  test('an assumption verified under an entry that still waits on a feature: stale, not unblocked', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { drafted: daysAgo(10), dependsOn: ['A-1', 'P1'] })],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(2), resolution: 'held.' })],
    });
    const g = groups(dir);
    assert.deepEqual(ids(g.unblocked), []);
    assert.deepEqual(ids(g.stale), ['P2']);
    assert.match(g.stale[0].why.join(), /A-1 verified.*still waits on P1/);
  });

  test('an experiment that closed after its dependent was drafted unblocks it', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { drafted: daysAgo(10), dependsOn: ['X1'] })],
      research: {
        experiments: [X('X1', { status: 'answered', closed: daysAgo(1), runs: ['N1'] })],
        runs: [N('N1')],
      },
    });
    assert.deepEqual(ids(groups(dir).unblocked), ['P2']);
  });

  test('one that still waits on something else is stale, not unblocked', () => {
    const { dir } = repo({
      backlog: [
        P('P1', { status: 'shipped', shipped: daysAgo(1) }),
        P('P2', { drafted: daysAgo(10), dependsOn: ['P1', 'P3'] }),
        P('P3'),
      ],
      nextUp: ['P3'],
    });
    const g = groups(dir);
    assert.deepEqual(ids(g.unblocked), []);
    assert.deepEqual(ids(g.stale), ['P2']);
  });
});

describe('about to block', () => {
  test('an open assumption blocking the queue head appears; one blocking only parked entries does not', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] }), P('P3', { dependsOn: ['A-2'] })],
      assumptions: [A('A-1'), A('A-2')],
      nextUp: ['P2'],
    });
    const g = groups(dir);
    assert.deepEqual(ids(g.aboutToBlock), ['A-1']);
    assert.match(g.aboutToBlock[0].action, /spike decision/);
  });

  test('it counts a queued entry held through another entry', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] }), P('P3', { dependsOn: ['P2'] })],
      assumptions: [A('A-1')],
      nextUp: ['P3'],
    });
    assert.match(groups(dir).aboutToBlock[0]?.why.join() ?? '', /holds queued P3/);
  });

  test('an open decision holding the queue asks the owner, not a spike', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['D-1'] })],
      decisions: [D('D-1')],
      nextUp: ['P2'],
    });
    assert.match(groups(dir).aboutToBlock[0]?.action ?? '', /Ask the owner to decide D-1/);
  });
});

describe('stale and abandoned', () => {
  test('an entry still naming a superseded decision is told to re-point to its superseded_by:', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['D-1'] })],
      decisions: [D('D-1', { status: 'superseded', waitingOn: null, supersededBy: 'D-2' }), decidedD('D-2')],
    });
    const [item] = groups(dir).stale;
    assert.equal(item?.id, 'P2');
    assert.match(item.action, /D-1 was superseded by D-2\. Re-point each dependent's `depends_on:` from D-1 to D-2 via \/ship/);
    assert.doesNotMatch(item.action, /unblocked/);
  });

  test('a shipped entry naming a superseded decision is not told to re-point: nothing builds it again', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { status: 'shipped', shipped: daysAgo(5), dependsOn: ['D-1'] })],
      decisions: [D('D-1', { status: 'superseded', waitingOn: null, supersededBy: 'D-2' }), decidedD('D-2')],
    });
    assert.deepEqual(ids(groups(dir).stale), []);
    assert.equal(groom(dir).code, NOTHING);
  });

  test('an in-progress entry no branch names is abandoned; one with a branch is not', () => {
    const { dir, g } = repo({
      backlog: [P('P1', { status: 'in-progress' }), P('P2', { status: 'in-progress' })],
      nextUp: [],
    });
    g.branch('feat/p2-the-thing');
    assert.deepEqual(ids(groups(dir).abandoned), ['P1']);
  });
});

describe('the audit and groom agree (Accept 3)', () => {
  test('for one repo state they name the same dependents of a resolution, bugs included', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] })],
      bugs: [B('B1', { dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(0), resolution: 'held.' })],
    });
    const audit = run('session-audit.mjs', [], { cwd: dir }).stdout;
    assert.match(audit, /A-1 is `verified` \(resolved today\) and 2 entr\(y\/ies\) depend on it: P2 \(proposed\), B1 \(open\)\./);
    assert.deepEqual(ids(groups(dir).unblocked), ['P2', 'B1']);
    assert.match(groom(dir, ['--for', 'A-1']).stdout, /depend on it: P2 \(proposed\), B1 \(open\)\./);
  });

  test('a superseded decision is worded as a re-point by both', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['D-1'] })],
      decisions: [D('D-1', { status: 'superseded', waitingOn: null, supersededBy: 'D-2' }), decidedD('D-2')],
    });
    appendFileSync(join(dir, 'docs/decisions/D-1.md'), '\nSuperseded by D-2.\n'); // makes it news to the audit
    const re = /Re-point each dependent's `depends_on:` from D-1 to D-2 via \/ship/;
    assert.match(run('session-audit.mjs', [], { cwd: dir }).stdout, re);
    assert.match(groom(dir, ['--for', 'D-1']).stdout, re);
  });

  test("an edit to one settled entry's file re-raises only that entry", () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] }), P('P3', { dependsOn: ['A-2'] })],
      assumptions: [
        A('A-1', { status: 'verified', resolved: daysAgo(3), resolution: 'held.' }),
        A('A-2', { status: 'verified', resolved: daysAgo(3), resolution: 'held.' }),
      ],
    });
    appendFileSync(join(dir, 'docs/assumptions/A-1.md'), '\nRe-checked.\n');
    const audit = run('session-audit.mjs', [], { cwd: dir }).stdout;
    assert.match(audit, /A-1 is `verified` and 1 entr\(y\/ies\) depend on it: P2/);
    assert.doesNotMatch(audit, /A-2 is `verified`/);
  });
});

describe('read-only, and its exit codes', () => {
  test('a groom run leaves git status unchanged', () => {
    const { dir } = repo({
      backlog: [P('P1', { status: 'in-progress' }), P('P2', { drafted: daysAgo(10), dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'refuted', resolved: daysAgo(2), resolution: 'wrong.' })],
    });
    appendFileSync(join(dir, 'docs/backlog/P1.md'), '\nAn uncommitted note.\n');
    const status = () => execSync('git status --porcelain --untracked-files=all', { cwd: dir, encoding: 'utf8' });
    const before = status();
    assert.notEqual(before, '', 'the control: a dirty tree, so an unchanged one is evidence');
    assert.equal(groom(dir).code, ITEMS);
    groom(dir, ['--json']);
    groom(dir, ['--for', 'A-1']);
    assert.equal(status(), before);
  });

  test('a clean backlog exits 0 and says so', () => {
    const { dir } = repo({});
    const r = groom(dir);
    assert.equal(r.code, NOTHING, out(r));
    assert.match(r.stdout, /nothing to groom \(base main\)/);
  });

  test('outside a repository it exits 2, distinct from nothing to groom', () => {
    const r = groom(tempDir());
    assert.equal(r.code, CANNOT, out(r));
    assert.match(r.stderr, /not a git repository/);
  });

  test('a --base that names no branch exits 2', () => {
    const { dir } = repo({});
    assert.equal(groom(dir, ['--base', 'nope']).code, CANNOT);
  });
});
