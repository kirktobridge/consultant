// When /implement's review step runs, and when it may be skipped (P8).
//
// The skip rule is a condition anyone can re-check: only Markdown changed against the
// integration branch. Each case builds a real repo with a feature branch and asks
// scripts/review.mjs — the same call the skill makes.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { run, out, tempDir, cleanupAll, gitInit } from './helpers/fixture.mjs';

after(cleanupAll);

/** A repo with one commit on main and a feature branch checked out. */
function repo() {
  const dir = tempDir();
  writeFileSync(join(dir, 'README.md'), '# r\n');
  const g = gitInit(dir);
  g.checkout('feat/x', true);
  const put = (path, text = 'x\n') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  return { dir, put, ...g };
}
const review = (cwd, ...args) => run('review.mjs', args, { cwd });

describe('review.mjs: the skip rule is a condition, not a judgement (P8)', () => {
  test('no changes at all: skippable, and it says why', () => {
    const { dir } = repo();
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /^review: skip — no changes against main$/m);
  });

  test('a Markdown-only diff, committed and uncommitted: skippable', () => {
    const { dir, put, commitAll } = repo();
    put('docs/a.md');
    commitAll();
    put('.claude/skills/x/SKILL.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /only Markdown changed against main \(2 file\(s\)\)/);
  });

  test('one code file among the Markdown makes it required', () => {
    const { dir, put, commitAll } = repo();
    put('docs/a.md');
    put('scripts/x.mjs');
    commitAll();
    const r = review(dir);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /^review: required$/m);
    assert.match(r.stdout, /^security-review: not warranted$/m);
    assert.match(r.stdout, /scripts\/x\.mjs/);
  });

  test('an untracked code file counts — the step runs before the build commit', () => {
    const { dir, put } = repo();
    put('src/new.js');
    assert.equal(review(dir).code, 0);
  });

  test('deleting a code file counts', () => {
    const { dir, put, commitAll, checkout, sh } = repo();
    checkout('main');
    put('lib.js');
    commitAll();
    checkout('feat/y', true);
    sh('git rm -q lib.js');
    assert.equal(review(dir).code, 0);
  });

  test('changes already on main are not this branch\'s diff', () => {
    const { dir, put, commitAll, checkout } = repo();
    checkout('main');
    put('scripts/landed.mjs');
    commitAll();
    checkout('feat/y', true);
    put('notes.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
  });

  for (const path of ['.claude/hooks/h.mjs', '.claude/settings.json', 'package.json', '.github/workflows/ci.yml', '.claude/edit-blocklist']) {
    test(`touching ${path} warrants a security review`, () => {
      const { dir, put } = repo();
      put(path, path.endsWith('.json') ? '{}\n' : 'x\n');
      const r = review(dir);
      assert.equal(r.code, 0, out(r));
      assert.match(r.stdout, /^security-review: warranted$/m);
      assert.ok(r.stdout.includes(path), r.stdout);
    });
  }

  describe('what a hook in .claude/settings.json runs is read from it, not listed by hand', () => {
    /** main registers two hooks; one imports a module, which imports another. */
    function hooked() {
      const r = repo();
      r.checkout('main');
      r.put('.claude/settings.json', JSON.stringify({ hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/audit.mjs" || true' }] }],
        PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/guard.mjs"' }] }],
      } }));
      r.put('scripts/audit.mjs', "import { x } from './lib.mjs';\n");
      r.put('scripts/lib.mjs', "import './deep/more.mjs';\n");
      r.put('scripts/deep/more.mjs');
      r.put('scripts/other.mjs');
      r.put('.claude/guard.mjs');
      r.commitAll();
      r.checkout('feat/h', true);
      return r;
    }
    for (const path of ['scripts/audit.mjs', '.claude/guard.mjs', 'scripts/lib.mjs', 'scripts/deep/more.mjs']) {
      test(`${path} is hook-run, so it warrants one`, () => {
        const { dir, put } = hooked();
        put(path, 'changed\n');
        const r = review(dir);
        assert.match(r.stdout, /^security-review: warranted$/m, out(r));
        assert.ok(r.stdout.includes(path), r.stdout);
      });
    }
    test('a script no hook reaches does not', () => {
      const { dir, put } = hooked();
      put('scripts/other.mjs', 'changed\n');
      assert.match(review(dir).stdout, /^security-review: not warranted$/m);
    });
  });

  test('Markdown in a security path is not skipped', () => {
    const { dir, put } = repo();
    put('.claude/hooks/README.md');
    const r = review(dir);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /^security-review: warranted$/m);
  });

  test('run from a subdirectory, it still sees the whole tree, by repo-root paths', () => {
    const { dir, put } = repo();
    put('docs/x.md');
    put('scripts/new.mjs');
    put('.claude/hooks/pre-push');
    const r = run('review.mjs', [], { cwd: join(dir, 'docs') });
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /scripts\/new\.mjs/);
    assert.match(r.stdout, /^security-review: warranted$/m);
  });

  test('a Markdown file with a non-ASCII name is still Markdown', () => {
    const { dir, put, commitAll } = repo();
    put('docs/café.md');
    commitAll();
    put('docs/naïve.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
  });

  test('--json carries the same verdict', () => {
    const { dir, put } = repo();
    put('scripts/install-hooks.mjs');
    const j = JSON.parse(review(dir, '--json').stdout);
    assert.equal(j.base, 'main');
    assert.equal(j.review, true);
    assert.equal(j.security, true);
    assert.deepEqual(j.securityFiles, ['scripts/install-hooks.mjs']);
  });

  test('no integration branch: exit 2, never a skip', () => {
    const dir = tempDir();
    gitInit(dir, 'develop');
    const r = review(dir);
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /no integration branch/);
  });

  test('--base names the integration branch', () => {
    const dir = tempDir();
    const { checkout } = gitInit(dir, 'develop');
    checkout('feat/z', true);
    writeFileSync(join(dir, 'a.js'), 'x\n');
    const r = review(dir, '--base', 'develop');
    assert.equal(r.code, 0, out(r));
  });

  test('--base takes any ref that resolves, and refuses a missing one', () => {
    const { dir, put, sh } = repo();
    sh('git tag v1 main');
    put('a.js');
    assert.equal(review(dir, '--base', 'v1').code, 0);
    const r = review(dir, '--base');
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /--base needs a ref/);
    assert.equal(review(dir, '--base', 'nope').code, 2);
  });
});
