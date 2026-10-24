// Emit claims a run directory of its own (B12) — a second emit never overwrites the
// first one's manifest, since grading reads only the manifest.
//
// Driven through the real CLI. Default-named runs go under EVAL_RUNS_ROOT, a temp
// directory, never the real evals/runs/, where a leftover would leak into other tests.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const RUN = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals', 'run.mjs');
const CASE = 'depends-gate-refuses-blocked-entry';
const REFUSED = 2;

function evalRun(args, env = {}) {
  const r = spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status ?? 1, all: `${r.stdout}\n${r.stderr}` };
}

const stampAt = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-').slice(0, 19);

describe('emit', () => {
  test('an --out that already holds a run is refused, and its manifest is untouched', () => {
    const dir = tempDir();
    const first = evalRun(['--case', CASE, '--reps', '1', '--out', dir]);
    assert.equal(first.code, 0, first.all);
    const before = readFileSync(join(dir, 'manifest.json'), 'utf8');

    const second = evalRun(['--case', CASE, '--reps', '2', '--out', dir]);
    assert.equal(second.code, REFUSED, second.all);
    assert.match(second.all, /already holds a run/);
    assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), before);
  });

  test('an --out an emit is still writing (prompts/, no manifest yet) is refused', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'prompts'));
    const r = evalRun(['--case', CASE, '--reps', '1', '--out', dir]);
    assert.equal(r.code, REFUSED, r.all);
    assert.deepEqual(readdirSync(join(dir, 'prompts')), []);
  });

  test('a default run dir whose stamp is taken gets its own directory', () => {
    // Occupy every stamp the emit could draw, so it is forced to collide.
    const runs = tempDir();
    const now = Date.now();
    const taken = [];
    for (let s = -2; s <= 30; s++) {
      const dir = join(runs, stampAt(now + s * 1000));
      mkdirSync(join(dir, 'prompts'), { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), 'occupied');
      taken.push(dir);
    }
    const listed = new Set(readdirSync(runs));

    const r = evalRun(['--case', CASE, '--reps', '1'], { EVAL_RUNS_ROOT: runs });
    assert.equal(r.code, 0, r.all);

    const fresh = readdirSync(runs).filter((d) => !listed.has(d));
    assert.equal(fresh.length, 1, `new run dirs: ${fresh}`);
    assert.match(fresh[0], /-2$/);
    const manifest = JSON.parse(readFileSync(join(runs, fresh[0], 'manifest.json'), 'utf8'));
    assert.equal(manifest.items.length, 1);
    for (const dir of taken) assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), 'occupied');
  });
});
