// preflight runs /implement's step-1 gates and prints a premise table (P41 R0).
//
// Each case commits registers on main and runs the real script, asserting the exit code
// (the contract a session reads) and the gate or row it names.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { P, A, D, B, project, gitInit, run, out, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

/** A repo whose main holds `state`, plus any extra files, committed. */
function repo(state, files = {}) {
  const dir = project({ nextUp: [], ...state });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  gitInit(dir);
  return dir;
}
const preflight = (dir, ...args) => run('preflight.mjs', args, { cwd: dir });
const report = (dir, ...args) => JSON.parse(preflight(dir, ...args, '--json').stdout);
const gate = (r, g) => r.gates.find((x) => x.gate === g);

describe('a gate that fails names itself and its blocker, and exits non-zero', () => {
  test('a claimed entry fails the claim gate', () => {
    const dir = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /claim {5}FAIL — P1 is already in-progress on main/);
    assert.match(r.stdout, /verdict: blocked \(claim\)/);
  });

  test('an entry resting on an open assumption fails the depends gate, naming it', () => {
    const dir = repo({ backlog: [P('P1', { dependsOn: ['A-1'] })], assumptions: [A('A-1')] });
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /depends {3}FAIL — waits on A-1 \(open\)/);
  });

  test('an entry resting on an open decision fails the depends gate, naming it', () => {
    const dir = repo({ backlog: [P('P1', { dependsOn: ['D-1'] })], decisions: [D('D-1')] });
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /depends {3}FAIL — waits on D-1 \(open\)/);
  });

  test('an unshipped feature dependency fails it, and the chain is named to its root', () => {
    const dir = repo({
      backlog: [P('P1', { dependsOn: ['P2'] }), P('P2', { dependsOn: ['A-1'] })],
      assumptions: [A('A-1')],
    });
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /depends {3}FAIL — waits on P2 \(proposed\), which rest on A-1 \(open\)/);
  });

  test('a moved assumption or a superseded decision still fails it (B10)', () => {
    const dir = repo({
      backlog: [P('P1', { dependsOn: ['A-1', 'D-1'] }), P('P3')],
      assumptions: [A('A-1', { status: 'moved', resolved: '2026-08-02', movedTo: 'P3', resolution: 'a choice, not a fact.' })],
      decisions: [D('D-1', { status: 'superseded', waitingOn: null, supersededBy: 'D-2' }), D('D-2')],
    });
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /depends {3}FAIL — waits on .*A-1 \(moved\)/);
    assert.match(r.stdout, /depends {3}FAIL — waits on .*D-1 \(superseded\)/);
  });

  test('a dependency with no entry fails it too', () => {
    const dir = repo({ backlog: [P('P1', { dependsOn: ['P99'] })] });
    assert.match(preflight(dir, 'P1').stdout, /depends {3}FAIL — waits on P99 \(no entry\)/);
  });

  test('a shipped entry fails the status gate: nothing is left to build', () => {
    const dir = repo({ backlog: [P('P1', { status: 'shipped', shipped: '2026-08-02', accept: null })] });
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 1, out(r));
    assert.equal(gate(report(dir, 'P1'), 'status').ok, false);
  });

  test('a bug runs the same gates', () => {
    const dir = repo({ backlog: [P('P1')], bugs: [B('B1', { dependsOn: ['P1'] })] });
    const r = preflight(dir, 'B1');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /depends {3}FAIL — waits on P1 \(proposed\)/);
  });
});

describe('a ready entry exits 0', () => {
  test('nothing claimed, nothing open beneath it', () => {
    const dir = repo({
      backlog: [P('P1', { dependsOn: ['P2'] }), P('P2', { status: 'shipped', shipped: '2026-08-02', accept: null }), P('P3', { status: 'in-progress' })],
    });
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /claim {5}ok — P1 is not claimed; claimed elsewhere: P3/);
    assert.match(r.stdout, /verdict: ready/);
  });

  test('milestones and a spike are reported, never failed', () => {
    const dir = repo({
      backlog: [P('P1', { scope: '- R0: the first half.\n- R1: the rest.', resolves: 'A-1' })],
      assumptions: [A('A-1')],
    });
    const r = report(dir, 'P1', 'R0');
    assert.deepEqual(r.milestones, ['R0', 'R1']);
    assert.deepEqual(r.resolves, ['A-1']);
    assert.equal(preflight(dir, 'P1', 'R0').code, 0);
    assert.match(preflight(dir, 'P1').stdout, /milestone R0, R1 in Scope — build one per invocation; confirm which/);
  });
});

describe('the premise table never reads a check that could not run as absent', () => {
  const code = { 'scripts/real.mjs': "import fs from 'node:fs';\nexport const presentName = 1;\n" };

  test('a file Scope names that is gone reads VERIFIED absent; one that exists reads found', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Change `scripts/real.mjs` and `scripts/gone.mjs`, and `docs/none/x.md`.' })] }, code);
    const rows = Object.fromEntries(report(dir, 'P1').premises.map((p) => [p.name, p.verdict]));
    assert.deepEqual(rows, { 'scripts/real.mjs': 'found', 'scripts/gone.mjs': 'VERIFIED absent', 'docs/none/x.md': 'VERIFIED absent' });
  });

  test('a symbol is searched: present reads found, missing reads VERIFIED absent', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Rename `presentName` to `missingName`; add `--new-flag`.' })] }, code);
    const rows = Object.fromEntries(report(dir, 'P1').premises.map((p) => [p.name, p.verdict]));
    assert.deepEqual(rows, { presentName: 'found', missingName: 'VERIFIED absent', '--new-flag': 'VERIFIED absent' });
  });

  test('a search whose control fails reads NOT evidence, never absent', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Rename `missingName`.' })] }, { 'scripts/x.mjs': 'no control here\n' });
    const [row] = report(dir, 'P1').premises;
    assert.equal(row.verdict, 'NOT evidence');
    assert.match(row.why, /grep-checked exit 2/);
  });

  test('with nothing to search, a symbol reads NOT evidence', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Rename `missingName`.' })] });
    assert.equal(report(dir, 'P1').premises[0].verdict, 'NOT evidence');
  });

  test('a bare file name is found wherever it is tracked; a member expression is not a path', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Extend `real.mjs`; read `graph.edges` and `meta.get`.' })] }, code);
    assert.deepEqual(report(dir, 'P1').premises.map((p) => [p.name, p.verdict, p.why ?? null]),
      [['real.mjs', 'found', 'scripts/real.mjs']]);
  });

  test('every word of a span is read: a command names its script, a call its function', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Run `node scripts/real.mjs <ID>`; call `presentName({ root })`.' })] }, code);
    assert.deepEqual(report(dir, 'P1').premises.map((p) => [p.name, p.verdict]),
      [['scripts/real.mjs', 'found'], ['presentName', 'found']]);
  });

  test('a flag is not found inside a longer one', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Add `--new`.' })] }, { 'scripts/f.mjs': "import x from 'y';\nconst a = '--new-flag';\n" });
    assert.equal(report(dir, 'P1').premises[0].verdict, 'VERIFIED absent');
  });

  test('another entry\'s milestone cited in Scope is not this entry\'s', () => {
    const dir = repo({ backlog: [P('P1', { scope: '- R0: reuse what P12 R3 built.' })] });
    assert.deepEqual(report(dir, 'P1').milestones, ['R0']);
  });

  test('a template, a command and plain words are not premises', () => {
    const dir = repo({ backlog: [P('P1', { scope: 'Run `npm test`; write `docs/backlog/P#.md`; mark it `shipped`.' })] }, code);
    assert.deepEqual(report(dir, 'P1').premises, []);
  });
});

describe('preflight that cannot run says so with exit 2', () => {
  test('an ID with no entry', () => {
    const dir = repo({ backlog: [P('P1')] });
    const r = preflight(dir, 'P9');
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /P9 has no entry on main/);
  });

  test('an ID that is not buildable', () => {
    const r = preflight(repo({ backlog: [P('P1')] }), 'A-1');
    assert.equal(r.code, 2, out(r));
  });

  test('an unreadable entry on the trunk stops it (P36)', () => {
    const dir = project({ backlog: [P('P1'), P('P2')], nextUp: [] });
    const g = gitInit(dir);
    writeFileSync(join(dir, 'docs/backlog/P2.md'), '*** not a header\n');
    g.commitAll('a header nothing can read');
    const r = preflight(dir, 'P1');
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /docs\/backlog\/P2\.md/);
  });
});
