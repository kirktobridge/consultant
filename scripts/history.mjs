// history — what happened to each backlog entry, read from git.
//
// This replaces a hand-maintained baton file. That file was a second copy of facts git
// already holds — what was claimed, built, merged, landed — written by a session at the
// moment it least wanted to write anything, and read by the next one as if it were
// current. Git cannot fall behind itself, so the history is derived instead of kept.
//
// It works because of a convention the loop already follows: every commit that moves an
// entry names its ID in the subject — `docs: claim P16 in-progress`,
// `feat: … (P16)`, the merge of `feat/p16-…`, `docs: P16 landed …`. A commit that
// leaves the ID out is invisible here, which is why /implement says to include it.
//
// Exit: 0 history printed | 1 the ID names no commit | 2 could not read history
//
// Usage: node scripts/history.mjs [P#] [--base <branch>]

import { execFileSync } from 'node:child_process';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const argv = process.argv.slice(2);
const baseIdx = argv.indexOf('--base');
const baseArg = baseIdx >= 0 ? argv[baseIdx + 1] : null;
// The same -1 trap as session-audit: with no --base, baseIdx + 1 is 0, which would
// skip the first argument — the ID, in the common case.
const idArg = argv.find((a, i) => /^P\d+$/i.test(a) && !(baseIdx >= 0 && i === baseIdx + 1))?.toUpperCase() ?? null;

// safe.directory=*: Windows git refuses a repo inside WSL as another user's. The
// reasoning is session-audit's: running this script already trusts this repository.
let lastError = '';
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    lastError = String(e.stderr ?? e.message ?? '').trim();
    return null;
  }
};

if (git('rev-parse', '--git-dir') === null) {
  console.error(`history: not a git repository, or git refused it — no history to read.${lastError ? `\n  git: ${lastError.split('\n')[0]}` : ''}`);
  process.exit(2);
}

const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const BASE = baseArg || ['main', 'master', 'trunk'].find((b) => branches.includes(b)) || null;
if (!BASE) {
  console.error(
    `history: no integration branch found (looked for main/master/trunk among: ${branches.join(', ') || 'none'}).\n` +
      'Pass --base <branch>.',
  );
  process.exit(2);
}

// ── Commits ──────────────────────────────────────────────────────────────────
// Unit/record separators rather than newlines: commit bodies contain newlines, and a
// close report is exactly the multi-line body this exists to show.

const US = '\x1f';
const RS = '\x1e';
const raw = git('log', '--all', '--reverse', '--date-order', '--date=format:%Y-%m-%d %H:%M',
  `--format=%h${US}%ad${US}%p${US}%s${US}%b${RS}`);
if (raw === null) {
  console.error('history: git log failed.');
  process.exit(2);
}

const TRAILER = /^(Co-Authored-By|Signed-off-by):/i;
const commits = raw.split(RS).map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
  const [sha, date, parents, subject, body = ''] = r.split(US);
  return {
    sha,
    date,
    merge: parents.trim().split(/\s+/).length > 1,
    subject,
    body: body.split('\n').filter((l) => !TRAILER.test(l)).join('\n').trim(),
    // Case-insensitive so the merge of `feat/p16-…` counts; the word boundary keeps
    // P16 from matching P160.
    ids: [...new Set([...subject.matchAll(/\bp(\d+)\b/gi)].map((m) => `P${m[1]}`))],
  };
});

const byId = new Map();
for (const c of commits) for (const id of c.ids) (byId.get(id) ?? byId.set(id, []).get(id)).push(c);

const ids = idArg ? [idArg] : [...byId.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const indent = (s, pad) => s.split('\n').map((l) => (l ? pad + l : l)).join('\n');

for (const id of ids) {
  const list = byId.get(id) ?? [];
  console.log(`## ${id} — ${list.length} commit(s)`);
  for (const c of list) {
    console.log(`  ${c.date}  ${c.sha}  ${c.merge ? '[merge] ' : ''}${c.subject}`);
    if (c.body) console.log(indent(c.body, '      '));
  }
  console.log('');
}

// ── Unmerged branches ────────────────────────────────────────────────────────
// The other thing the baton file carried: work that exists only on a branch. Its
// latest commit message is the closest thing to a note its author left.

const unmerged = (git('branch', '--no-merged', BASE, '--format=%(refname:short)') || '').split('\n').filter(Boolean);
if (!idArg || unmerged.some((b) => new RegExp(`\\b${idArg}\\b`, 'i').test(b))) {
  const shown = idArg ? unmerged.filter((b) => new RegExp(`\\b${idArg}\\b`, 'i').test(b)) : unmerged;
  console.log(`## Unmerged into ${BASE} — ${shown.length} branch(es)`);
  for (const b of shown) {
    const msg = (git('log', '-1', '--date=format:%Y-%m-%d %H:%M', `--format=%h${US}%ad${US}%B`, b) || '').trim();
    const [sha, date, body = ''] = msg.split(US);
    const text = body.split('\n').filter((l) => !TRAILER.test(l)).join('\n').trim();
    console.log(`  ${b}  (${date}, ${sha})`);
    if (text) console.log(indent(text, '      '));
  }
  console.log('');
}

// The positive control (LESSONS L3): an empty answer must say how much was searched,
// or a broken log read looks exactly like an entry nobody touched.
if (idArg && !byId.has(idArg)) {
  console.error(`history: no commit subject names ${idArg} (scanned ${commits.length} commit(s) on all branches).`);
  process.exit(1);
}
