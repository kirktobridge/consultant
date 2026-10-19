// test-clean — export the suite to a temp dir and run its own suite there (P28).
//
//   node scripts/test-clean.mjs [--keep]
//
// The question this answers is "does the suite work in a project that isn't this
// one?". A test that passes here only because this repo's own entries exist is the
// failure it catches, so the run must see nothing of this repo: a fresh directory, a
// fresh git history, `npm install` and `npm test` as a porter would run them.
//
// It runs in CI and not in the pre-commit hook: it runs the whole suite a second time,
// which doubles the hook's wait for a question that rarely changes commit to commit.
//
// --keep leaves the copy on disk and prints where, for looking at a failure.

import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(mkdtempSync(join(tmpdir(), 'skillsuite-clean-')), 'copy');

// Git exports repo-locating variables to the hooks it runs (see tests/helpers/fixture.mjs);
// inherited, they would point the copy's git at this repo's index.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
// The copy's checks must judge the copy, not whichever project launched this.
delete env.CLAUDE_PROJECT_DIR;
// Inherited from a `node --test` parent, this makes the child's runner print nothing
// and exit 0 — a pass that proves nothing.
delete env.NODE_TEST_CONTEXT;

const step = (label, cmd, args, cwd = dir) => {
  console.log(`test-clean: ${label}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`test-clean: FAILED at "${label}" (exit ${r.status ?? r.signal}); copy kept at ${dir}`);
    process.exit(1);
  }
};

step('export', process.execPath, [join(root, 'scripts', 'export.mjs'), dir], root);
// A porter drops the suite into a git repository, and several checks read git.
step('git init', 'git', ['init', '-q', '-b', 'main']);
step('git config', 'git', ['config', 'user.email', 'clean@example.com']);
step('git config', 'git', ['config', 'user.name', 'Clean Run']);
step('git add', 'git', ['add', '-A']);
step('git commit', 'git', ['commit', '-qm', 'export', '--no-verify']);
step('npm install', 'npm', ['install', '--no-audit', '--no-fund']);
step('npm test', 'npm', ['test']);

if (keep) console.log(`test-clean: OK; copy kept at ${dir}`);
else {
  rmSync(dirname(dir), { recursive: true, force: true });
  console.log('test-clean: OK');
}
