// Edit guard — blocks writes to human-owned files, via a PreToolUse hook.
//
// This is the only mechanism in the suite that *prevents* rather than reports. A skill
// told not to edit a file mostly complies; a hook always does. That difference is the
// whole reason the spec is safe to call a source of truth — an agent that can edit the
// definition of "correct" can define away its own bugs.
//
// Patterns live in `.claude/edit-blocklist`, one per line. Behaviour is unchanged from
// the Python original it replaces; the port exists so the suite needs one runtime
// rather than two. See tests/edit-guard.test.mjs.
//
// Exit 0 permits the edit. Exit 2 blocks it. Nothing else — and every failure path
// (unparseable payload, missing blocklist, no paths) deliberately permits, so a broken
// guard never wedges an unrelated edit.

import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const BLOCKLIST_FILE = join(HERE, 'edit-blocklist');

/** The git dir every checkout of one repository shares, or null if `root` isn't one. */
function commonDirOf(root) {
  const dotgit = join(root, '.git');
  try {
    if (statSync(dotgit).isDirectory()) return realpathSync(dotgit);
    // A linked worktree: `.git` is a file naming its private gitdir, which in turn
    // names the shared one in `commondir`.
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, 'utf8'));
    if (!m) return null;
    const gitdir = resolve(root, m[1].trim());
    const common = existsSync(join(gitdir, 'commondir'))
      ? resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim())
      : gitdir;
    return realpathSync(common);
  } catch {
    return null;
  }
}

/**
 * The checkout of `home`'s repository that contains `filePath` — the main checkout or
 * any linked worktree, nearest first. Falls back to `home`.
 *
 * This exists because the hooks run from wherever the session was launched (OD-7):
 * in a worktree session, `home` is the main checkout, and a worktree under
 * `.claude/worktrees/` is just a subfolder of it. Judged against `home`, a folder
 * pattern like `docs/dev_notes/` never matches the worktree's copy. Checkouts of
 * other repositories are walked past, so a path elsewhere on disk is judged exactly
 * as before. Exported because the PostToolUse checks need the same answer — and it
 * lives here, in a blocklisted file, because a guard that imported an editable
 * helper could be disarmed by editing the helper.
 */
export function checkoutOf(filePath, home = REPO_ROOT) {
  const common = commonDirOf(home);
  if (!common) return home;
  let dir = dirname(resolve(filePath));
  for (;;) {
    if (existsSync(join(dir, '.git')) && commonDirOf(dir) === common) return dir;
    const up = dirname(dir);
    if (up === dir) return home;
    dir = up;
  }
}

/**
 * Python's fnmatch, which is NOT glob: `*` crosses directory separators. That is
 * deliberate here — `src/generated/**` and `src/generated/*` mean the same thing, and
 * a porter writing either gets what they expect.
 */
export function fnmatch(name, pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      re += '.*';
    } else if (c === '?') {
      re += '.';
    } else if (c === '[') {
      let j = i + 1;
      if (pattern[j] === '!' || pattern[j] === '^') j++;
      if (pattern[j] === ']') j++;
      while (j < pattern.length && pattern[j] !== ']') j++;
      if (j >= pattern.length) {
        re += '\\['; // unterminated class is a literal bracket, as in Python
      } else {
        const body = pattern.slice(i + 1, j).replace(/\\/g, '\\\\');
        re += '[' + (body.startsWith('!') ? '^' + body.slice(1) : body) + ']';
        i = j;
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`).test(name);
}

export function loadBlocklist(file = BLOCKLIST_FILE) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Returns the pattern that blocked this path, or null.
 *
 * Four ways a pattern can match, kept from the original because each earns its place:
 * a trailing-slash folder prefix, a glob on the full relative path, a glob on the
 * basename alone, and an exact path-suffix. The basename and suffix rules are why a
 * bare `edit-blocklist` blocks any file of that name anywhere on disk — documented in
 * the blocklist itself, and the reason to prefer path-qualified patterns.
 */
export function isBlocked(filePath, patterns) {
  // Lexical resolution, not realpath: a Write may target a file that does not exist
  // yet. The only filesystem reads are checkoutOf's walk up to the nearest `.git`.
  const abs = resolve(filePath);
  const root = checkoutOf(abs);
  const prefix = root.endsWith(sep) ? root : root + sep;
  const rel = abs.startsWith(prefix) ? abs.slice(prefix.length) : filePath;
  const base = basename(rel);

  for (const pat of patterns) {
    if (pat.endsWith('/')) {
      if (rel.startsWith(pat) || rel === pat.slice(0, -1)) return pat;
    }
    if (fnmatch(rel, pat)) return pat;
    if (fnmatch(base, pat)) return pat;
    if (rel === pat || rel.endsWith('/' + pat)) return pat;
  }
  return null;
}

/** Every path a single tool call would write: Edit/Write, plus MultiEdit's edits[]. */
export function pathsFrom(payload) {
  const ti = payload?.tool_input ?? {};
  const out = [];
  if (typeof ti.file_path === 'string') out.push(ti.file_path);
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) if (typeof e?.file_path === 'string') out.push(e.file_path);
  }
  return out;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0); // unreadable or unparseable — never block on our own confusion
  }

  const paths = pathsFrom(payload);
  if (paths.length === 0) process.exit(0);

  const patterns = loadBlocklist();
  if (patterns.length === 0) process.exit(0);

  for (const p of paths) {
    const matched = isBlocked(p, patterns);
    if (matched) {
      process.stderr.write(`BLOCKED by edit-guard: '${p}' matches pattern '${matched}'\n`);
      process.exit(2);
    }
  }
  process.exit(0);
}

// Only when run as the hook — importing this for tests must not consume stdin.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
