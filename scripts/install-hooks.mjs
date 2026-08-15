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
import { existsSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
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

/**
 * Name the personal hooks that arming this suite just switched off.
 *
 * This is the one thing the user cannot discover for themselves. Every other failure
 * mode here announces itself; a hook that stops being looked for produces no error, no
 * output and no log line — the symptom is that something quietly stopped happening,
 * which is close to unsearchable. So the install is the only moment we can say it.
 *
 * Reports; never moves anything. Renaming files inside someone's .git as a side effect
 * of `npm install` would be a worse surprise than the one being reported.
 */
function reportOrphanedHooks() {
  const common = git('rev-parse', '--git-common-dir');
  if (!common.ok || !common.out) return;
  const dir = join(isAbsolute(common.out) ? common.out : join(ROOT, common.out), 'hooks');
  if (!existsSync(dir)) return;

  const orphans = [];
  let legacyLink = false;

  for (const name of readdirSync(dir)) {
    // .sample ships with git and is inert. .local is the chained name — the fixed state.
    if (name.endsWith('.sample') || name.endsWith('.local')) continue;
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }

    // A symlink into this suite is our own earlier install, now superseded and inert.
    // Reporting it as a personal hook would send someone chasing their own tail.
    if (st.isSymbolicLink()) {
      let target = '';
      try { target = readlinkSync(p); } catch { /* dangling */ }
      if (target.replaceAll('\\', '/').includes(HOOKS_DIR)) { legacyLink = true; continue; }
    }
    if (!st.isDirectory() && (st.mode & 0o111) !== 0) orphans.push(name);
  }

  if (orphans.length) {
    console.log(
      `\ninstall-hooks: ${orphans.length} personal hook(s) in .git/hooks/ are NO LONGER RUNNING.\n` +
        `  core.hooksPath redirects git's entire hook lookup, so these are now skipped in\n` +
        `  silence. Rename each to <name>.local and this suite's hooks will chain to it:\n\n` +
        orphans.map((n) => `      mv .git/hooks/${n} .git/hooks/${n}.local`).join('\n') +
        `\n\n  Not moved for you — that is your directory. See ${HOOKS_DIR}/README.md.`,
    );
  }
  if (legacyLink) {
    console.log(
      `\ninstall-hooks: .git/hooks/ still holds a symlink from an older install of this\n` +
        `  suite. It is inert now (core.hooksPath wins) and safe to delete.`,
    );
  }
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
  // Still report: a personal hook can be dropped in long after the suite was armed,
  // and that is exactly when nobody is expecting it to be ignored.
  reportOrphanedHooks();
  process.exit(0);
}

const set = git('config', '--local', 'core.hooksPath', HOOKS_DIR);
if (!set.ok) skip('git config would not write (read-only or unusual clone).');

console.log(
  `install-hooks: armed — core.hooksPath = ${HOOKS_DIR}.\n` +
    `  The committed hooks are now the live hooks; edits take effect with no reinstall.\n` +
    `  Personal hooks keep working under .git/hooks/<name>.local — see ${HOOKS_DIR}/README.md.`,
);
reportOrphanedHooks();
