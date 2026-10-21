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
