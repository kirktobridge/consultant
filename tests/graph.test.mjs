// The dependency graph — `backlog-schema-check.mjs --graph [--json]`.
//
// Two things are pinned here. The text view must rank by what each entry unblocks and
// walk each chain to its end, because that is what /triage groom and any "what's next?"
// read off it. The JSON must match the contract in .claude/GUIDE.md, because other
// tools (P7's renderer, P19's session start, photocull's own) read it without reading
// this repo's code: a shape that drifts breaks them silently.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { P, B, A, D, X, R, F, project, run, out, cleanupAll, REPO } from './helpers/fixture.mjs';

after(cleanupAll);

const graph = (dir, json = false) => {
  const r = run('backlog-schema-check.mjs', ['--graph', ...(json ? ['--json'] : [])], { cwd: dir });
  assert.equal(r.code, 0, `graph mode failed:\n${out(r)}`);
  return r;
};

/**
 * P5 -> D-1 (also waiting on the user) -> P4, A-1 -> P2, a shipped P3 resting on P5, and
 * P1 blocking nothing. P1 comes first in file order, so ranking by what an entry unblocks
 * is visible: it has to come out last.
 */
const chain = (extra = {}) =>
  project({
    ...extra,
    backlog: [
      P('P1'),
      P('P2', { dependsOn: ['A-1'] }),
      P('P3', { status: 'shipped', shipped: '2026-08-02', dependsOn: ['P5'] }),
      P('P4', { title: 'After the decision', dependsOn: ['D-1'] }),
      P('P5'),
    ],
    bugs: [B('B1')],
    assumptions: [A('A-1')],
    decisions: [D('D-1', { waitingOn: 'P5, user' })],
  });

describe('graph', () => {
  test('edges and prose blockers are read as written, closed entries included', () => {
    const g = JSON.parse(graph(chain(), true).stdout);
    const edges = new Set(g.edges.map((e) => `${e.from}>${e.to}:${e.field}`));
    assert.deepEqual(edges, new Set(['A-1>P2:depends_on', 'P5>P3:depends_on', 'D-1>P4:depends_on', 'P5>D-1:waiting_on']));
    assert.deepEqual(g.prose, [{ id: 'D-1', field: 'waiting_on', text: 'user' }]);
    const meta = Object.fromEntries(g.entries.map((e) => [e.id, e]));
    assert.equal(meta.P4.title, 'After the decision');
    assert.deepEqual([meta.P3.open, meta.P1.open, meta['A-1'].register], [false, true, 'assumptions']);
  });

  test('the text view ranks what can start by everything it unblocks, and walks each chain', () => {
    const [start, blocked, prose] = graph(chain()).stdout.trimEnd().split('\n\n');
    const lines = start.split('\n').slice(1);
    assert.match(lines[0], /^ {2}P5 +unblocks 2 \(P4, D-1\): /, start); // P4 only through D-1
    assert.match(lines[1], /^ {2}A-1 +unblocks 1 \(P2\): /, start);
    assert.match(lines[2], /^ {2}P1 +P1 example$/, start);
    assert.doesNotMatch(start, /D-1 example/, 'D-1 waits on P5, so it cannot start');
    assert.doesNotMatch(`${start}${blocked}`, /P3 /, 'shipped: not in the graph’s view');
    const rows = blocked.split('\n');
    const at = rows.findIndex((l) => l.startsWith('  P4 — '));
    const p4 = rows.slice(at + 1).map((l) => l.trim());
    assert.deepEqual(p4.slice(0, p4.findIndex((l) => !l.startsWith('<-'))), ['<- D-1 (open)', '<- P5 (proposed)', '<- "user"']);
    assert.match(prose, /D-1 waiting_on: user/);
  });

  // P13 R0. A decision waiting on an experiment is blocked by it, like any other entry.
  // Runs and findings are records, never blockers, so they stay out of the graph.
  test('an experiment blocks the decision waiting on it; runs and findings are not graphed', () => {
    const dir = project({
      decisions: [D('D-1', { waitingOn: 'X1', decisionRule: 'adopt if ≥ 60%.' })],
      research: { experiments: [X('X1', { feeds: ['D-1'] })], runs: [R('R1')], findings: [F('F1')] },
    });
    const g = JSON.parse(graph(dir, true).stdout);
    assert.ok(g.edges.some((e) => e.from === 'X1' && e.to === 'D-1' && e.field === 'waiting_on'));
    assert.equal(g.entries.find((e) => e.id === 'X1').register, 'experiments');
    assert.ok(!g.entries.some((e) => ['R1', 'F1'].includes(e.id)), 'a record was graphed');
    assert.match(graph(dir).stdout, /D-1 — D-1 example\n {4}<- X1 \(proposed\)/);
  });

  test('a cycle is shown once, not walked forever', () => {
    const dir = project({ backlog: [P('P1', { dependsOn: ['P2'] }), P('P2', { dependsOn: ['P1'] })] });
    assert.match(graph(dir).stdout, /\(chain shown above\)/);
  });

  test('a tree the check rejects still graphs, and says the graph may be wrong', () => {
    const r = graph(project({ backlog: [P('P1', { value: null })] }));
    assert.match(r.stdout, /Start now/);
    assert.match(r.stderr, /1 violation\(s\); the graph may be wrong/);
  });

  test('--json without --graph is refused', () => {
    assert.equal(run('backlog-schema-check.mjs', ['--json'], { cwd: project() }).code, 2);
  });

  // The contract test: GUIDE.md's example block is the shape, and every item the real
  // output carries must have exactly its keys and value types.
  test('the JSON matches the contract documented in GUIDE.md', () => {
    const guide = readFileSync(join(REPO, '.claude', 'GUIDE.md'), 'utf8');
    const section = guide.split('### The dependency graph')[1].split('\n## ')[0].split('\n### ')[0];
    const doc = JSON.parse(section.split('```json')[1].split('```')[0]);
    const g = JSON.parse(graph(chain({ research: { experiments: [X('X1')], runs: [R('R1')], findings: [F('F1')] } }), true).stdout);
    assert.equal(g.version, doc.version, 'bump the documented version with the output’s');
    assert.deepEqual(Object.keys(g).sort(), Object.keys(doc).sort());
    const shape = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v]));
    for (const key of ['entries', 'edges', 'prose']) {
      assert.ok(g[key].length, `fixture produced no ${key}: the comparison would be vacuous`);
      for (const item of g[key]) assert.deepEqual(shape(item), shape(doc[key][0]), `${key} item differs from GUIDE.md`);
    }
    const vocab = (label) => new Set([...section.match(new RegExp(`^${label}:.*$`, 'm'))[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    // The fixture carries every register and both fields, so equality (not subset) is the claim.
    assert.deepEqual(new Set(g.entries.map((e) => e.register)), vocab('Graph registers'));
    assert.deepEqual(new Set([...g.edges, ...g.prose].map((e) => e.field)), vocab('Graph fields'));
  });

  // The real-repo version of this lives in tests/instance/ (P28): it reads this repo's
  // entries, which a clean copy doesn't have.
});
