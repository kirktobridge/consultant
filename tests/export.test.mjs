// The manifest and the export (P28).
//
// The manifest says which tracked files are the suite and which are this repo's own
// state; the export writes the suite alone, with each instance file it still needs
// written from template/. What's pinned here: an unmarked file fails by name, an export
// carries no instance content that didn't come from template/, and what it writes
// passes its own schema check. Whether the copy's whole suite passes is
// `npm run test:clean`, which CI runs; it's too slow to nest inside this one.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO, run, out, tempDir, cleanupAll, gitInit, schema } from './helpers/fixture.mjs';
import { classify, trackedFiles } from '../scripts/manifest.mjs';

after(cleanupAll);

/** A git repo holding the manifest and export scripts, plus the given extra files. */
function miniRepo(extra = {}) {
  const dir = tempDir();
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of ['manifest.mjs', 'export.mjs']) cpSync(join(REPO, 'scripts', f), join(dir, 'scripts', f));
  writeFileSync(join(dir, 'README.md'), '# a project\n');
  for (const [rel, text] of Object.entries(extra)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  gitInit(dir);
  return dir;
}

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

describe('the manifest', () => {
  test('passes when every tracked file is marked, and counts what it read (L3)', () => {
    const r = run('manifest.mjs', ['--check'], { cwd: miniRepo() });
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /manifest: OK \(3 tracked files: 3 suite, 0 instance\)/);
  });

  test('a tracked file marked neither suite nor instance fails, naming the file', () => {
    const r = run('manifest.mjs', ['--check'], { cwd: miniRepo({ 'src/new-thing.js': 'x\n' }) });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /src\/new-thing\.js: not marked suite or instance/);
  });

  test('a directory pattern covers what is under it, and `*` stays in one segment', () => {
    assert.equal(classify('docs/backlog/P7.md'), 'instance');
    assert.equal(classify('docs/backlog/README.md'), 'suite');
    assert.equal(classify('tests/instance/this-repo.test.mjs'), 'instance');
    assert.equal(classify('tests/schema.test.mjs'), 'suite');
    assert.equal(classify('tests/nested/x.test.mjs'), null);
    assert.equal(classify('.claude/skills/ship/SKILL.md'), 'suite');
  });
});

describe('the export', () => {
  const dest = join(tempDir(), 'copy');
  const r = run('export.mjs', [dest]);
  const files = r.code === 0 ? walk(dest).map((p) => relative(dest, p).replaceAll('\\', '/')) : [];

  test('writes a copy, and says how much', () => {
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /export: .+ \(\d+ suite files, \d+ from template\/\)/);
    assert.ok(files.length >= 20, `only ${files.length} files exported — did the file list come back empty?`);
  });

  test("every suite file is exported, and every instance file is template/'s, not this repo's", () => {
    const today = new Date().toISOString().slice(0, 10);
    const suite = trackedFiles(REPO).filter((f) => classify(f) === 'suite');
    assert.deepEqual(suite.filter((f) => !files.includes(f)), [], 'suite files missing from the export');
    const leaked = [];
    for (const f of files) {
      if (classify(f) === 'suite') continue;
      const tpl = join(REPO, 'template', f);
      if (!existsSync(tpl)) { leaked.push(`${f}: no template — this repo's own file`); continue; }
      const want = readFileSync(tpl, 'utf8').replaceAll('{{today}}', today);
      if (readFileSync(join(dest, f), 'utf8') !== want) leaked.push(`${f}: differs from its template`);
    }
    assert.deepEqual(leaked, []);
  });

  test("the copy holds no drill or instance test of this repo's", () => {
    assert.deepEqual(files.filter((f) => /^docs\/drills\/|^tests\/instance\//.test(f)), []);
  });

  test("the copy's own schema check passes", () => {
    const s = schema(dest);
    assert.equal(s.code, 0, out(s));
    // 3 seeds in 4 registers, plus the research track's 3, which ship adopted and empty.
    assert.match(s.stdout, /backlog-schema: OK \(3 entries across 7 register\(s\)\)/);
  });

  test('refuses a target that is not empty', () => {
    const again = run('export.mjs', [dest]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /is not empty/);
  });

  test('refuses while the manifest is incomplete, naming the file', () => {
    const dir = miniRepo({ 'src/new-thing.js': 'x\n' });
    const e = run('export.mjs', [join(tempDir(), 'copy')], { cwd: dir });
    assert.equal(e.code, 1);
    assert.match(e.stderr, /src\/new-thing\.js: not marked/);
  });
});
