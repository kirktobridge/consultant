// trunkGraph refuses to drop an entry it can't read (P36).
//
// The graph skips an entry whose header won't parse, and the run still succeeds, so
// each case commits a broken file on main and asserts the reader fails, naming it,
// rather than handing back a graph that is one entry short.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { P, X, N, project, gitInit, cleanupAll } from './helpers/fixture.mjs';
import { trunkGraph } from '../scripts/trunk-graph.mjs';

after(cleanupAll);

// The scripts' own git invocation (session-audit, status), so the reader is tested as called.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
const gitIn = (dir) => (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return null; }
};
const read = (dir) => trunkGraph({ root: dir, base: 'main', git: gitIn(dir) });

/** A repo whose main holds `state`, with `edit(dir)` committed on top. */
function repo(state, edit = () => {}) {
  const dir = project(state);
  const g = gitInit(dir);
  edit(dir);
  g.commitAll('edit');
  return dir;
}
const rewrite = (dir, rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));

describe('trunkGraph names an entry file the graph left out', () => {
  test('an entry whose first line is not --- fails the read, by file', () => {
    const dir = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1'] },
      (d) => rewrite(d, 'docs/backlog/P2.md', (t) => t.replace(/^---/, '***')));
    const r = read(dir);
    assert.equal(r.graph, null);
    assert.match(r.failed ?? '', /docs\/backlog\/P2\.md/);
  });

  test('an entry whose header has no id fails the read too', () => {
    const dir = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1'] },
      (d) => rewrite(d, 'docs/backlog/P2.md', (t) => t.replace(/^id: .*\n/m, '')));
    assert.match(read(dir).failed ?? '', /docs\/backlog\/P2\.md/);
  });

  test('an entry in the graph whose status line did not parse fails the read', () => {
    const dir = repo({ backlog: [P('P1'), P('P2', { status: 'in-progress' })], nextUp: ['P1'] },
      (d) => rewrite(d, 'docs/backlog/P2.md', (t) => t.replace(/^status: /m, 'status:')));
    assert.match(read(dir).failed ?? '', /docs\/backlog\/P2\.md/);
  });

  test('an experiment the graph left out fails the read', () => {
    const dir = repo({ research: { experiments: [X('X1')] } },
      (d) => rewrite(d, 'docs/research/experiments/X1.md', (t) => t.replace(/^---/, '***')));
    assert.match(read(dir).failed ?? '', /docs\/research\/experiments\/X1\.md/);
  });

  test('every broken file is named, not only the first', () => {
    const dir = repo({ backlog: [P('P1'), P('P2'), P('P3')], nextUp: ['P1'] }, (d) => {
      for (const id of ['P2', 'P3']) rewrite(d, `docs/backlog/${id}.md`, (t) => t.replace(/^---/, '***'));
    });
    assert.match(read(dir).failed ?? '', /docs\/backlog\/P2\.md, docs\/backlog\/P3\.md/);
  });

  test('many broken files are counted past the first few, so the audit stays short', () => {
    const ids = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
    const dir = repo({ backlog: ids.map((id) => P(id)), nextUp: ['P1'] }, (d) => {
      for (const id of ids) rewrite(d, `docs/backlog/${id}.md`, (t) => t.replace(/^---/, '***'));
    });
    const failed = read(dir).failed ?? '';
    assert.match(failed, /docs\/backlog\/P5\.md, and 3 more/);
    assert.doesNotMatch(failed, /P6\.md/);
  });

  test('git failing to list the registers is a failure, not an empty graph', () => {
    const dir = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    const r = trunkGraph({ root: dir, base: 'main', git: () => null });
    assert.equal(r.graph, null);
    assert.match(r.failed ?? '', /could not list/);
  });
});

describe('trunkGraph still reads what the graph never carries', () => {
  test('ordinary entries give a graph and no failure', () => {
    const dir = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1'] });
    const r = read(dir);
    assert.equal(r.failed, null);
    assert.deepEqual(r.graph.entries.map((e) => e.id), ['P1', 'P2']);
  });

  test('a stray file whose name is no ID is left to the schema check', () => {
    const dir = repo({ backlog: [P('P1')], nextUp: ['P1'] },
      (d) => writeFileSync(join(d, 'docs/backlog/notes.md'), 'scratch\n'));
    assert.equal(read(dir).failed, null);
  });

  test('a research run, which the graph does not carry, is not a dropped entry', () => {
    const dir = repo({ research: { experiments: [X('X1')], runs: [N('N1', { experiment: 'X1' })] } },
      (d) => rewrite(d, 'docs/research/runs/N1.md', (t) => t.replace(/^---/, '***')));
    assert.equal(read(dir).failed, null);
  });

  test('a broken entry on a branch only does not fail a read of main', () => {
    const dir = project({ backlog: [P('P1'), P('P2')], nextUp: ['P1'] });
    const g = gitInit(dir);
    g.checkout('feat/p2-x', true);
    rewrite(dir, 'docs/backlog/P2.md', (t) => t.replace(/^---/, '***'));
    g.commitAll('broken on a branch');
    assert.equal(read(dir).failed, null);
  });
});
