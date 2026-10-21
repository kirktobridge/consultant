// What /implement builds when it is given no ID (P5 R1).
//
// Every open bug is picked up before the queue, most severe first, and is never ranked
// into it. Each case builds a real repo, commits its registers on main, and asks
// scripts/next.mjs — the same call the skill makes.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  P, B, A, decidedD, D, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles,
} from './helpers/fixture.mjs';

after(cleanupAll);

/** A repo whose main holds `state`; returns its root and git helpers. */
function repo(state) {
  const dir = tempDir();
  writeFiles(dir, renderFiles(state));
  return { dir, ...gitInit(dir) };
}
const next = (cwd, ...args) => run('next.mjs', args, { cwd });
const pick = (r) => (r.stdout.match(/^next: (\S+)$/m) || [])[1];

/** P1 claimed, its branch built and merged into main: landed, awaiting acceptance. */
function landedP1() {
  const r = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
  r.checkout('feat/p1-thing', true);
  writeFileSync(join(r.dir, 'x.txt'), 'built');
  r.commitAll('feat: thing (P1)');
  r.checkout('main');
  r.merge('feat/p1-thing');
  return r;
}

describe('next.mjs takes every open bug before the queue (P5 R1)', () => {
  test('with no bugs, the queue head comes up', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1', 'P2'] });
    const r = next(dir);
    assert.equal(r.code, 0, out(r));
    assert.equal(pick(r), 'P1');
  });

  test('an open bug is taken ahead of the queue, whatever its severity', () => {
    const { dir } = repo({ backlog: [P('P1')], nextUp: ['P1'], bugs: [B('B1', { severity: 'minor' })] });
    const r = next(dir);
    assert.equal(pick(r), 'B1', out(r));
    assert.match(r.stdout, /before the queue/);
  });

  test('bugs go most severe first, then oldest report, then lowest number', () => {
    const { dir } = repo({
      backlog: [P('P1')], nextUp: ['P1'],
      bugs: [
        B('B1', { severity: 'minor', reported: '2026-01-01' }),
        B('B2', { severity: 'major', reported: '2026-03-01' }),
        B('B3', { severity: 'major', reported: '2026-02-01' }),
        B('B4', { severity: 'critical', reported: '2026-04-01' }),
      ],
    });
    assert.equal(pick(next(dir)), 'B4');
    const j = JSON.parse(next(dir, '--json').stdout);
    assert.equal(j.next.from, 'bugs');
    assert.equal(j.openBugs, 4);
  });

  test('ties on severity and date fall to the lower number', () => {
    const { dir } = repo({ backlog: [P('P1')], bugs: [B('B7'), B('B3')] });
    assert.equal(pick(next(dir)), 'B3');
  });

  test('a claimed, fixed or wontfix bug is not proposed', () => {
    const { dir } = repo({
      backlog: [P('P1')], nextUp: ['P1'],
      bugs: [
        B('B1', { severity: 'critical', status: 'in-progress' }),
        B('B2', { severity: 'critical', status: 'fixed', repro: null }),
        B('B3', { severity: 'critical', status: 'wontfix', repro: null }),
      ],
    });
    assert.equal(pick(next(dir)), 'P1');
  });

  test('a bug resting on an open assumption or decision is held, and says on what', () => {
    const { dir } = repo({
      backlog: [P('P1')], nextUp: ['P1'],
      bugs: [B('B1', { severity: 'critical', dependsOn: ['A-1'] }), B('B2', { severity: 'minor', dependsOn: ['D-1'] })],
      assumptions: [A('A-1')],
      decisions: [D('D-1')],
    });
    const r = next(dir);
    assert.equal(pick(r), 'P1', out(r));
    assert.match(r.stdout, /held: B1 \(critical bug\) waits on A-1 \(open\)/);
    assert.match(r.stdout, /held: B2 \(minor bug\) waits on D-1 \(open\)/);
  });

  test('a bug resting on an unshipped feature is held; once the feature ships it is taken', () => {
    const state = (status) => ({
      backlog: [P('P1', { status, shipped: status === 'shipped' ? '2026-08-02' : null }), P('P2')],
      nextUp: ['P2'],
      bugs: [B('B1', { dependsOn: ['P1'] })],
    });
    const { dir, commitAll } = repo(state('partial'));
    assert.equal(pick(next(dir)), 'P2');
    writeFiles(dir, renderFiles(state('shipped')));
    commitAll('ship P1');
    assert.equal(pick(next(dir)), 'B1');
  });

  test('a decided decision does not hold a bug', () => {
    const { dir } = repo({ backlog: [P('P1')], bugs: [B('B1', { dependsOn: ['D-1'] })], decisions: [decidedD('D-1')] });
    assert.equal(pick(next(dir)), 'B1');
  });

  test('a claimed queue head is skipped for the next one', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
    const r = next(dir);
    assert.equal(pick(r), 'P2', out(r));
    assert.match(r.stdout, /skipping claimed P1/);
  });

  test('a claimed head whose branch has landed is skipped as awaiting acceptance, not as a build (B4)', () => {
    const { dir } = landedP1();
    const r = next(dir);
    assert.equal(pick(r), 'P2', out(r));
    assert.match(r.stdout, /skipping P1 \(landed \d{4}-\d{2}-\d{2}, awaiting acceptance\)/);
    assert.doesNotMatch(r.stdout, /claimed P1/);
  });

  test('the registers are read from main, never the checked-out copy', () => {
    const { dir, sh } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    sh('git checkout -qb elsewhere');
    writeFiles(dir, renderFiles({ backlog: [P('P1')], nextUp: ['P1'], bugs: [B('B1', { severity: 'critical' })] }));
    sh('git add -A');
    sh('git commit -qm "a bug that never reached main"');
    assert.equal(pick(next(dir)), 'P1');
  });

  test('nothing ready exits 1 and says how much it looked at', () => {
    const { dir } = repo({
      backlog: [P('P1', { status: 'in-progress' })], nextUp: ['P1'],
      bugs: [B('B1', { dependsOn: ['A-1'] })], assumptions: [A('A-1')],
    });
    const r = next(dir);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /nothing ready — 1 open bug\(s\), 1 queued ID\(s\) on main/);
  });

  test('outside a repo it exits 2', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'x'), '');
    assert.equal(next(dir).code, 2);
  });
});

describe('next.mjs --count picks a batch for parallel subagents (P17)', () => {
  const picked = (r) => [...r.stdout.matchAll(/^ {2}picked: (\S+)$/gm)].map((m) => m[1]);

  test('takes up to N from the queue, in its order', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2'), P('P3'), P('P4')], nextUp: ['P1', 'P2', 'P3', 'P4'] });
    const r = next(dir, '--count', '3');
    assert.equal(r.code, 0, out(r));
    assert.deepEqual(picked(r), ['P1', 'P2', 'P3']);
    assert.match(r.stdout, /^batch: 3 of 3 asked/m);
  });

  test('skips an entry that depends on one picked in the same batch, and says why', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2', { dependsOn: ['P1'] }), P('P3')], nextUp: ['P1', 'P2', 'P3'] });
    const r = next(dir, '--count', '3');
    assert.deepEqual(picked(r), ['P1', 'P3'], out(r));
    assert.match(r.stdout, /skipped: P2 — waits on P1 \(picked in this batch\)/);
  });

  test('skips what an unshipped feature holds, directly or through another entry', () => {
    const { dir } = repo({
      backlog: [P('P1', { status: 'partial' }), P('P2', { dependsOn: ['P1'] }), P('P3', { dependsOn: ['P2'] }), P('P4')],
      nextUp: ['P3', 'P4'],
    });
    const r = next(dir, '--count', '2');
    assert.deepEqual(picked(r), ['P4'], out(r));
    assert.match(r.stdout, /skipped: P3 — waits on P2 \(proposed\), P1 \(partial\) via P2/);
  });

  test('skips a claimed entry and one an open assumption holds', () => {
    const { dir } = repo({
      backlog: [P('P1', { status: 'in-progress' }), P('P2', { dependsOn: ['A-1'] }), P('P3')],
      nextUp: ['P1', 'P2', 'P3'], assumptions: [A('A-1')],
    });
    const r = next(dir, '--count', '3');
    assert.deepEqual(picked(r), ['P3'], out(r));
    assert.match(r.stdout, /skipped: P1 — claimed/);
    assert.match(r.stdout, /skipped: P2 — waits on A-1 \(open\)/);
  });

  test('a landed claim is skipped as awaiting acceptance, not as another session\'s build (B4)', () => {
    const { dir } = landedP1();
    const r = next(dir, '--count', '2');
    assert.deepEqual(picked(r), ['P2'], out(r));
    assert.match(r.stdout, /skipped: P1 — landed \d{4}-\d{2}-\d{2}, awaiting the owner's acceptance/);
    assert.doesNotMatch(r.stdout, /another session is building it/);
    const j = JSON.parse(next(dir, '--count', '2', '--json').stdout);
    assert.match(j.skipped.find((s) => s.id === 'P1')?.landed ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });

  test('a merge from before the current claim is an earlier milestone, not this one landing', () => {
    const { dir, commitAll } = landedP1();
    const f = join(dir, 'docs/backlog/P1.md');
    const flip = (s) => writeFileSync(f, readFileSync(f, 'utf8').replace(/^status: .*$/m, `status: ${s}`));
    flip('partial');
    commitAll('docs: P1 R1 landed (P1)');
    flip('in-progress');
    commitAll('docs: claim P1 R2 (P1)');
    const r = next(dir);
    assert.match(r.stdout, /skipping claimed P1/, out(r));
    assert.match(next(dir, '--count', '2').stdout, /skipped: P1 — claimed \(in-progress\)/);
  });

  test('a landed branch that has kept going is a build again', () => {
    const { dir, checkout, commitAll } = landedP1();
    checkout('feat/p1-thing');
    writeFileSync(join(dir, 'y.txt'), 'more');
    commitAll('feat: more (P1)');
    checkout('main');
    assert.match(next(dir, '--count', '2').stdout, /skipped: P1 — claimed \(in-progress\): another session is building it/);
  });

  test('picks from the queue only, naming a ready bug rather than batching it', () => {
    const { dir } = repo({ backlog: [P('P1')], nextUp: ['P1'], bugs: [B('B1')] });
    const r = next(dir, '--count', '2');
    assert.deepEqual(picked(r), ['P1'], out(r));
    assert.match(r.stdout, /note: B1 .* a batch picks from the queue only/);
  });

  test('--json carries the batch', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2', { dependsOn: ['P1'] })], nextUp: ['P1', 'P2'] });
    const j = JSON.parse(next(dir, '--count', '2', '--json').stdout);
    assert.deepEqual(j.picked, ['P1']);
    assert.deepEqual(j.skipped, [{ id: 'P2', why: 'waits on P1 (picked in this batch)' }]);
  });

  test('a transitive dependency picked in this batch keeps its path; a dangling one holds', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['P1'] }), P('P3', { dependsOn: ['P2'] }), P('P4', { dependsOn: ['P9'] })],
      nextUp: ['P1', 'P2', 'P3', 'P4'],
    });
    const r = next(dir, '--count', '4');
    assert.deepEqual(picked(r), ['P1'], out(r));
    assert.match(r.stdout, /skipped: P3 — waits on P2 \(proposed\), P1 \(picked in this batch\) via P2/);
    assert.match(r.stdout, /skipped: P4 — waits on P9 \(no entry\)/);
  });

  test('a held bug is still reported', () => {
    const { dir } = repo({ backlog: [P('P1')], nextUp: ['P1'], bugs: [B('B1', { dependsOn: ['A-1'] })], assumptions: [A('A-1')] });
    assert.match(next(dir, '--count', '1').stdout, /held: B1 .* waits on A-1 \(open\)/);
  });

  test('nothing ready exits 1; a bad count exits 2', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })], nextUp: ['P1'] });
    assert.equal(next(dir, '--count', '2').code, 1);
    for (const bad of ['x', '0', '1e1', '0x2', '3.0']) assert.equal(next(dir, '--count', bad).code, 2, bad);
  });
});

describe('the landing check reads every branch, a rebuild, and GitHub merges (B5)', () => {
  const reason = (dir) => (next(dir, '--count', '2').stdout.match(/skipped: P1 — (.*)$/m) || [])[1] ?? '';
  const LANDED = /^landed \d{4}-\d{2}-\d{2}, awaiting the owner's acceptance$/;
  const BUILDING = /another session is building it/;

  test('an earlier milestone\'s leftover branch does not hide this claim\'s landing', () => {
    const { dir, checkout, commitAll, merge } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1', 'P2'] });
    checkout('feat/p1-a', true); // sorts before feat/p1-thing
    writeFileSync(join(dir, 'old.txt'), 'never merged');
    commitAll('feat: R1 leftovers (P1)');
    checkout('main');
    const f = join(dir, 'docs/backlog/P1.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^status: .*$/m, 'status: in-progress'));
    commitAll('docs: claim P1 (P1)');
    checkout('feat/p1-thing', true);
    writeFileSync(join(dir, 'x.txt'), 'built');
    commitAll('feat: thing (P1)');
    checkout('main');
    merge('feat/p1-thing');
    assert.match(reason(dir), LANDED);
  });

  test('a fresh branch cut to rebuild a rejected landing is a build, not the landing', () => {
    const { dir, sh } = landedP1();
    sh('git branch -D feat/p1-thing');
    assert.match(reason(dir), LANDED);
    sh('git branch feat/p1-thing');
    assert.match(reason(dir), BUILDING);
  });

  test('a GitHub pull-request merge is a landing', () => {
    const { dir, sh, checkout, commitAll } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
    checkout('feat/p1-thing', true);
    writeFileSync(join(dir, 'x.txt'), 'built');
    commitAll('feat: thing (P1)');
    checkout('main');
    sh('git merge -q --no-ff feat/p1-thing -m "Merge pull request #12 from kirk/feat/p1-thing"');
    assert.match(reason(dir), LANDED);
  });

  test('a remote-tracking merge is a landing', () => {
    const { dir, sh, checkout, commitAll } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
    checkout('feat/p1-thing', true);
    writeFileSync(join(dir, 'x.txt'), 'built');
    commitAll('feat: thing (P1)');
    checkout('main');
    sh(`git merge -q --no-ff feat/p1-thing -m "Merge remote-tracking branch 'origin/feat/p1-thing'"`);
    assert.match(reason(dir), LANDED);
  });

  test('a leftover branch resumed for this claim, landed, then built on again, is a build', () => {
    const { dir, checkout, commitAll, merge } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1', 'P2'] });
    checkout('feat/p1-x', true);
    writeFileSync(join(dir, 'old.txt'), 'R1 leftovers');
    commitAll('feat: R1 leftovers (P1)');
    checkout('main');
    const f = join(dir, 'docs/backlog/P1.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^status: .*$/m, 'status: in-progress'));
    commitAll('docs: claim P1 (P1)');
    checkout('feat/p1-x');
    writeFileSync(join(dir, 'x.txt'), 'R2');
    commitAll('feat: R2 (P1)');
    checkout('main');
    merge('feat/p1-x');
    assert.match(reason(dir), LANDED);
    checkout('feat/p1-x');
    writeFileSync(join(dir, 'y.txt'), 'after rejection');
    commitAll('feat: rework (P1)');
    checkout('main');
    assert.match(reason(dir), BUILDING);
  });

  test('two branches of one claim that both landed read as landed', () => {
    const { dir, checkout, commitAll, merge } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
    for (const b of ['feat/p1-api', 'feat/p1-ui']) {
      checkout(b, true);
      writeFileSync(join(dir, `${b.slice(8)}.txt`), b);
      commitAll(`feat: ${b} (P1)`);
      checkout('main');
    }
    merge('feat/p1-api');
    merge('feat/p1-ui');
    assert.match(reason(dir), LANDED);
  });

  test('a branch with no history in common with main does not hide a landing', () => {
    const { dir, sh } = landedP1();
    sh('git checkout -q --orphan feat/p1-notes');
    sh('git commit -q --allow-empty -m notes');
    sh('git checkout -q -f main');
    assert.match(reason(dir), LANDED);
  });
});

describe('the landing check sees squash and rebase merges, and a fast-forwarded branch (B6)', () => {
  const reason = (dir) => (next(dir, '--count', '2').stdout.match(/skipped: P1 — (.*)$/m) || [])[1] ?? '';
  const LANDED = /^landed \d{4}-\d{2}-\d{2}, awaiting the owner's acceptance$/;
  const BUILDING = /another session is building it/;

  /** P1 claimed, built on feat/p1-thing in two commits, back on main with nothing landed. */
  function built() {
    const r = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
    r.checkout('feat/p1-thing', true);
    writeFileSync(join(r.dir, 'x.txt'), 'built');
    r.commitAll('feat: thing (P1)');
    writeFileSync(join(r.dir, 'y.txt'), 'more');
    r.commitAll('feat: more (P1)');
    r.checkout('main');
    return r;
  }
  const squash = ({ sh }) => {
    sh('git merge -q --squash feat/p1-thing');
    sh('git commit -q -m "Add the thing (#12)" -m "* feat: thing (P1)" -m "* feat: more (P1)"');
  };

  test('a GitHub squash merge is a landing, with its branch kept or deleted', () => {
    const r = built();
    assert.match(reason(r.dir), BUILDING);
    squash(r);
    assert.match(reason(r.dir), LANDED);
    r.sh('git branch -D feat/p1-thing');
    assert.match(reason(r.dir), LANDED);
  });

  test('a rebase merge is a landing', () => {
    const r = built();
    writeFileSync(join(r.dir, 'other.txt'), 'main moved');
    r.commitAll('feat: other (P2)');
    r.sh('git cherry-pick main..feat/p1-thing');
    assert.match(reason(r.dir), LANDED);
  });

  test('a fast-forward landing is a landing', () => {
    const r = built();
    r.sh('git merge -q --ff-only feat/p1-thing');
    assert.match(reason(r.dir), LANDED);
  });

  test('a squashed branch that kept going is a build', () => {
    const r = built();
    squash(r);
    r.checkout('feat/p1-thing');
    writeFileSync(join(r.dir, 'x.txt'), 'reworked');
    r.commitAll('feat: rework (P1)');
    r.checkout('main');
    assert.match(reason(r.dir), BUILDING);
  });

  test('a squash that does not name the entry is not its landing', () => {
    const r = built();
    r.sh('git merge -q --squash feat/p1-thing');
    r.sh('git commit -q -m "Add the thing (#12)"');
    assert.match(reason(r.dir), BUILDING);
  });

  test('a fresh branch cut at a squash landing to rebuild it is a build', () => {
    const r = built();
    squash(r);
    r.sh('git branch -D feat/p1-thing');
    r.sh('git branch feat/p1-redo');
    assert.match(reason(r.dir), BUILDING);
  });

  test('a squash over a file other landed work also changed is a landing', () => {
    const r = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
    writeFileSync(join(r.dir, 'shared.txt'), 'a\nb\nc\nd\ne\nf\ng\n');
    r.commitAll('feat: shared file (P2)');
    r.checkout('feat/p1-thing', true);
    writeFileSync(join(r.dir, 'shared.txt'), 'A\nb\nc\nd\ne\nf\ng\n');
    r.commitAll('feat: thing (P1)');
    r.checkout('main');
    writeFileSync(join(r.dir, 'shared.txt'), 'a\nb\nc\nd\ne\nf\nG\n');
    r.commitAll('feat: other (P2)');
    squash(r);
    assert.match(reason(r.dir), LANDED);
  });

  test('a reverted squash is not a landing', () => {
    const r = built();
    squash(r);
    r.sh('git branch -D feat/p1-thing'); // with no branch to look at, only the landing decides
    assert.match(reason(r.dir), LANDED);
    r.sh('git revert --no-edit HEAD');
    assert.match(reason(r.dir), BUILDING);
  });

  test('milestone and multi-ID tags name the entry; another ID that contains it does not', () => {
    for (const [title, want] of [['feat: thing (P1 R1)', LANDED], ['feat: thing (P37, P1)', LANDED], ['feat: thing (P11)', BUILDING]]) {
      const r = built();
      r.sh('git merge -q --squash feat/p1-thing');
      r.sh(`git commit -q -m "${title}"`);
      r.sh('git branch -D feat/p1-thing');
      assert.match(reason(r.dir), want, title);
    }
  });

  test('/ship\'s bookkeeping is not a landing; a docs squash of real work is', () => {
    const r = built();
    writeFileSync(join(r.dir, 'docs/backlog/P1.md'), readFileSync(join(r.dir, 'docs/backlog/P1.md'), 'utf8') + '\nnote\n');
    r.commitAll('feat: note on P1 (P1)');
    r.sh('git branch -D feat/p1-thing');
    assert.match(reason(r.dir), BUILDING);
    writeFileSync(join(r.dir, 'GUIDE.md'), 'rewritten');
    r.commitAll('docs: rewrite the guide (P1)');
    assert.match(reason(r.dir), LANDED);
  });

  test('a kept squashed branch stays landed after main edits the same lines', () => {
    const r = built();
    squash(r);
    writeFileSync(join(r.dir, 'x.txt'), 'changed again on main');
    r.commitAll('feat: later (P2)');
    assert.match(reason(r.dir), LANDED);
  });

  test('a merged branch whose reflog holds no commits of its own (fetched, not built here) is landed', () => {
    const r = built();
    r.sh('git merge -q --no-ff feat/p1-thing -m "Merge pull request #12 from kirk/feat/p1-thing"');
    r.sh('git branch -D feat/p1-thing');
    r.sh('git branch feat/p1-thing HEAD^2');
    assert.match(reason(r.dir), LANDED);
  });

  test('a landed branch fast-forwarded to main with no new work is still landed', () => {
    const { dir, sh, checkout, commitAll } = landedP1();
    writeFileSync(join(dir, 'later.txt'), 'other work');
    commitAll('feat: other (P2)');
    checkout('feat/p1-thing');
    sh('git merge -q --ff-only main');
    checkout('main');
    assert.match(reason(dir), LANDED);
  });
});
