// trunk — which branch is the integration branch (P12).
//
// The loop used to assume `main`, and a clone whose trunk is `master` got a claim gate
// that errored on its first command (`fatal: invalid object name 'main'`). The rule
// that replaces the assumption is session-audit's, and it lives here once: a `--base`
// the caller names, else the first of main/master/trunk that exists as a local branch,
// else fail loudly. Scripts import `findTrunk` rather than keeping their own copy of
// the list; the skills call this file as a command rather than restating it in prose.
//
// Guessing is never on the list: a wrong trunk makes every read "from main" a read
// from somewhere else, and nothing downstream would notice.
//
// Exit: 0 the trunk's name is the one stdout line | 2 no trunk — the message says how
// to name one (not a repo, no candidate branch, or a `--base` that is not a branch)
//
// Usage: node scripts/trunk.mjs [--base <branch>]

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** The branches tried, in order, when no `--base` names the trunk. */
export const TRUNK_CANDIDATES = ['main', 'master', 'trunk'];

/** The first candidate among `branches`, or null. */
export const findTrunk = (branches) => TRUNK_CANDIDATES.find((b) => branches.includes(b)) || null;

/** How a caller names the trunk when it can't be found. One sentence, shared. */
export const NAME_IT = 'Name it with --base <branch>.';

/**
 * Resolve the trunk among `branches`: `base` if given and it is one of them, else the
 * first candidate. Returns `{ trunk }` or `{ error }`, the error saying how to fix it.
 */
export function resolveTrunk(branches, base = null) {
  if (base) {
    if (branches.includes(base)) return { trunk: base };
    return { error: `--base ${base} is not a local branch (branches: ${branches.join(', ') || 'none'}).` };
  }
  const trunk = findTrunk(branches);
  if (trunk) return { trunk };
  return { error: `no trunk found (looked for ${TRUNK_CANDIDATES.join('/')} among: ${branches.join(', ') || 'none'}). ${NAME_IT}` };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const stop = (msg) => { console.error(`trunk: ${msg}`); process.exit(2); };
  const i = argv.indexOf('--base');
  const base = i >= 0 ? argv[i + 1] ?? null : null;
  if (i >= 0 && (!base || base.startsWith('--'))) stop(`--base needs a branch. ${NAME_IT}`);

  // Same git invocation as session-audit: no shell, WSL-safe, for the reasons given there.
  const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
  let out;
  try {
    out = execFileSync('git', ['-c', 'safe.directory=*', ...WIN, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    stop(`not a git repository, or git refused it. git: ${String(e.stderr ?? e.message ?? '').trim().split('\n')[0]}`);
  }
  const r = resolveTrunk(out.split('\n').filter(Boolean), base);
  if (r.error) stop(r.error);
  console.log(r.trunk);
}
