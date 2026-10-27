// git — a shared way for the loop's scripts to run git.
//
// Scripts each carried their own copy of this, and the copies drifted: some trimmed the
// output, which quietly repairs an entry header with a leading blank line or BOM and
// eats the first column of `status --porcelain`; some kept only stderr from a failure,
// losing a hook that reports on stdout. A script still holding its own copy can differ
// from this one in exactly those ways; moving it here is how it stops.
//
//   - no shell: arguments go to git as given, so nothing is quoted or expanded.
//   - `safe.directory=*`: under WSL the repo's owner can read as someone else, and git
//     then refuses every command, which a script would read as "nothing there".
//   - on Windows, `core.filemode=false`, or every file reads as modified.
//   - output keeps everything but git's final newline.
//   - a failure returns null; `git.error()` is both streams. `git.firstError()` is the
//     line that says why: git's first `fatal:`/`error:`/`CONFLICT` line, since a failed
//     merge puts its progress ("Auto-merging …") first; else the first line.

import { execFileSync } from 'node:child_process';

const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];

/** A git runner in `cwd` (default: the process's). */
export function gitIn(cwd) {
  let lastError = '';
  const git = (...args) => {
    try {
      return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
      }).replace(/\n$/, '');
    } catch (e) {
      lastError = [e.stderr, e.stdout].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n') || String(e.message ?? e);
      return null;
    }
  };
  git.error = () => lastError;
  git.firstError = () => {
    const lines = lastError.split('\n');
    return lines.find((l) => /^(fatal|error|CONFLICT)\b/.test(l)) ?? lines[0];
  };
  return git;
}
