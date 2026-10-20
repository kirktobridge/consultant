// review — does this branch's diff get the review step, and does it warrant a security
// review too (P8)?
//
// /implement reviews the diff with the harness's /code-review before /verify. The point
// of a rule for *skipping* it is that the skip is a fact anyone can re-check, not a
// judgement made at the end of a build, when everything feels done. So the rule is code:
//
//   skip      the diff changes only Markdown (`*.md`) — or nothing at all. Prose is
//             held by the process tests and the schema check; /code-review looks for
//             correctness bugs, and a diff with no code has none to find.
//   required  anything else, and any security-relevant file below, Markdown or not.
//
// /security-review is warranted when the diff touches a file that runs on someone's
// machine without being asked, or decides what an agent may do. Two sources, so that
// neither is a hand-kept copy of the other:
//   - every file a hook in .claude/settings.json runs (`$CLAUDE_PROJECT_DIR/<path>`),
//     and every local module those files import, followed transitively;
//   - SECURITY below: what settings.json cannot name — itself, the git hooks, the hook
//     installer, CI, package.json (its `prepare` runs on install).
// /security-review audits code, so prose that grants an agent permissions (CLAUDE.md, a
// SKILL.md) is not on it; that is the product owner's to read.
//
// The diff is the working tree (untracked files included) against the merge base with
// the integration branch, so it covers committed and uncommitted work alike: the step
// runs before the build commit. Paths are repo-root relative wherever this is run from.
//
// Exit: 0 review required (stdout: `review: required`, then `security-review: warranted`
// or `security-review: not warranted`) | 1 skippable (stdout: `review: skip — <why>`)
// | 2 could not run — never a skip
//
// Usage: node scripts/review.mjs [--base <ref>] [--json]

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

// PORTING: paths in your project that execute unasked or grant permissions and that no
// hook in .claude/settings.json names. Patterns: a path, or a directory prefix ending in `/`.
export const SECURITY = [
  '.claude/settings.json',
  '.claude/hooks/',
  '.claude/edit-blocklist',
  'scripts/install-hooks.mjs',
  '.github/workflows/',
  'package.json',
];

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf('--base');
const asJson = argv.includes('--json');

// Same git invocation as next.mjs, for the reasons given in session-audit.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
let lastError = '';
let cwd;
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
    });
  } catch (e) {
    lastError = String(e.stderr ?? e.message ?? '').trim();
    return null;
  }
};
const stop = (msg) => { console.error(`review: ${msg}`); process.exit(2); };
const gitSays = () => (lastError ? ` git: ${lastError.split('\n')[0]}` : '');

const top = git('rev-parse', '--show-toplevel')?.trim();
if (!top) stop(`not a git repository, or git refused it.${gitSays()}`);
cwd = top;

let BASE;
if (baseIdx >= 0) {
  BASE = argv[baseIdx + 1];
  if (!BASE || BASE.startsWith('--')) stop('--base needs a ref.');
  if (git('rev-parse', '--verify', '--quiet', `${BASE}^{commit}`) === null) stop(`--base ${BASE} is not a commit.${gitSays()}`);
} else {
  const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
  BASE = ['main', 'master', 'trunk'].find((b) => branches.includes(b));
  if (!BASE) stop(`no integration branch found (looked for main/master/trunk among: ${branches.join(', ') || 'none'}). Pass --base <ref>.`);
}

const mergeBase = git('merge-base', BASE, 'HEAD')?.trim();
if (!mergeBase) stop(`no merge base between ${BASE} and HEAD.${gitSays()}`);
// -z: unquoted paths, whatever characters they hold.
const changed = git('diff', '-z', '--name-only', '--no-renames', mergeBase);
const untracked = git('ls-files', '-z', '--others', '--exclude-standard', '--full-name', ':/');
if (changed === null || untracked === null) stop(`could not read the diff against ${BASE}.${gitSays()}`);
const files = [...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(Boolean))].sort();

// ── What the hooks run ───────────────────────────────────────────────────────

function hookRun() {
  const settings = join(top, '.claude', 'settings.json');
  if (!existsSync(settings)) return [];
  let cfg;
  try { cfg = JSON.parse(readFileSync(settings, 'utf8')); } catch { stop('.claude/settings.json is not valid JSON.'); }
  const commands = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'command' && typeof x === 'string' ? commands.push(x) : walk(x);
  };
  walk(cfg.hooks ?? {});
  const seen = new Set();
  const queue = commands.flatMap((c) => [...c.matchAll(/\$\{?CLAUDE_PROJECT_DIR\}?\/([^\s"']+)/g)].map((m) => normalize(m[1]).replaceAll('\\', '/')));
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    let text;
    try { text = readFileSync(join(top, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.\.?\/[^'"]+)['"]/g)) {
      queue.push(normalize(join(dirname(f), m[1])).replaceAll('\\', '/'));
    }
  }
  return [...seen];
}

const hooked = new Set(hookRun());
const matches = (f, p) => (p.endsWith('/') ? f.startsWith(p) : f === p);
const security = files.filter((f) => hooked.has(f) || SECURITY.some((p) => matches(f, p)));
const code = files.filter((f) => !/\.md$/i.test(f));
const required = code.length > 0 || security.length > 0;
const why = files.length === 0 ? `no changes against ${BASE}` : `only Markdown changed against ${BASE} (${files.length} file(s))`;

if (asJson) {
  console.log(JSON.stringify({ base: BASE, review: required, security: security.length > 0, files, code, securityFiles: security }));
} else if (required) {
  console.log('review: required');
  console.log(`security-review: ${security.length ? 'warranted' : 'not warranted'}`);
  if (code.length) console.log(`  ${code.length} non-Markdown file(s) changed against ${BASE}: ${code.join(', ')}`);
  if (security.length) console.log(`  runs unasked or grants permissions: ${security.join(', ')}`);
} else {
  console.log(`review: skip — ${why}`);
}
process.exit(required ? 0 : 1);
