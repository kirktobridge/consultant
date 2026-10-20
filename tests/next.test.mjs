// What /implement builds when it is given no ID (P5 R1).
//
// Every open bug is picked up before the queue, most severe first, and is never ranked
// into it. Each case builds a real repo, commits its registers on main, and asks
// scripts/next.mjs — the same call the skill makes.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
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
