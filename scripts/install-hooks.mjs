// install-hooks — point git at the hooks this repo version-controls.
//
// THE PROBLEM THIS SOLVES is not that the hooks are untracked. They are: everything
// under `.claude/` is committed, hooks included. The problem is that git only ever
// reads `.git/hooks/`, a directory no `git clone` populates and no commit can reach.
// So a fresh clone of this suite arrives with the enforcement layer present as text
// and absent as behavior — the single worst state, because the file is right there
// and reads as if it were running.
//
// `core.hooksPath` closes that: one local config value that redirects git to
// `.claude/hooks/`, so the committed hook IS the live hook and editing it takes
// effect with no reinstall step. Preferred over symlinking into `.git/hooks/`
// because symlinks need developer mode on Windows and break under worktrees, where
// `.git` is a file rather than a directory.
//
// It runs from npm's `prepare`, i.e. on the `npm install` every clone already does.
// That is the only moment we can count on, since git config is per-clone and cannot
// be committed.
//
// NEVER let this fail an install. A tarball with no `.git`, a sandbox with no git
// binary and a CI runner are all legitimate; refusing to install the package over a
// convenience hook would be a far worse bug than an unarmed hook. Every failure path
// here reports and exits 0. The load-bearing copy is `npm test` in CI, which does not
// depend on any of this.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Git, captured. `status: null` means the binary is absent, not that git said no. */
function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), missing: r.error != null };
}

const HOOKS_DIR = '.claude/hooks';

/** Report and leave, always successfully — see the header. */
function skip(why) {
  console.log(`install-hooks: skipped — ${why}`);
  process.exit(0);
}

const inRepo = git('rev-parse', '--is-inside-work-tree');
if (inRepo.missing) skip('git is not installed. Hooks stay inert; `npm test` still holds.');
if (!inRepo.ok || inRepo.out !== 'true') {
  skip('not a git working tree (tarball or vendored copy). Nothing to arm.');
}

if (!existsSync(join(ROOT, HOOKS_DIR))) {
  skip(`${HOOKS_DIR}/ does not exist. Nothing to point git at.`);
}

// Do not clobber another hook manager. If husky or lefthook owns this setting, saying
// so is useful; overwriting it silently would break their hooks and look like our bug.
const current = git('config', '--local', '--get', 'core.hooksPath');
if (current.ok && current.out && current.out !== HOOKS_DIR) {
  console.log(
    `install-hooks: core.hooksPath is already "${current.out}" — leaving it alone.\n` +
      `  Another hook manager likely owns it. To use this suite's hooks instead:\n` +
      `      git config core.hooksPath ${HOOKS_DIR}\n` +
      `  or chain ours from yours. The pre-commit hook is not running until you do.`,
  );
  process.exit(0);
}

if (current.ok && current.out === HOOKS_DIR) {
  console.log(`install-hooks: already armed (core.hooksPath = ${HOOKS_DIR}).`);
  process.exit(0);
}

const set = git('config', '--local', 'core.hooksPath', HOOKS_DIR);
if (!set.ok) skip('git config would not write (read-only or unusual clone).');

console.log(
  `install-hooks: armed — core.hooksPath = ${HOOKS_DIR}.\n` +
    `  The committed hooks are now the live hooks; edits take effect with no reinstall.\n` +
    `  Note this makes git ignore .git/hooks/ entirely, including any personal hooks there.`,
);
