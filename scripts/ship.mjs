// ship — the tracked docs' writes as one checked commit each (P55).
//
// /ship's edits were hand edits: change a header line, run the check, commit, release
// the lock. Any step could be skipped or half-done, and a claim left uncommitted, or
// committed past a red check, reads as a claim to every other session. So each change
// becomes one command that either commits a green change or leaves the tree as it was.
//
//   claim <P#|B#> [R#]   flip a feature or bug to `in-progress` on the trunk (R0). It
//                        lands beside the old /ship: callers switch to it after 2 clean
//                        real claims. A milestone only names itself in the subject.
//
// A claim, in order:
//   - runs in the main checkout, on the trunk, with a clean tree. A claim made on a
//     branch is invisible to other sessions, and a dirty tree is another task's state.
//   - holds the land lock as `claim:<ID>`, through land.mjs, so the lock's staleness
//     rules stay in one place. It releases only a lock it took, on every exit — a
//     `claim:` lock left behind is never judged stale, so it would block every landing.
//   - refuses an entry that is missing, already `in-progress`, closed, or has a direct
//     dependency unmet, naming why. A `partial` feature sits between milestones and is
//     claimed again for the next one. Chains are left to the schema check, which runs
//     on the edited tree before the commit and walks them; it also holds the queue,
//     which a claim never changes (an `in-progress` entry stays a queue candidate).
//   - edits the `status:` header line only, and commits that one file. The commit runs
//     the repo's hooks. If anything fails after the edit, the file is put back.
//
// Exit: 0 done | 1 refused (the message says why) | 2 could not run
//
// Usage: node scripts/ship.mjs claim <P#|B#> [R#] [--wait <s>] [--trailer <line>] [--base <branch>] [--json]

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildableRegister, registerOf, parseEntry, idsOf, dependencyMet, newHomeOf } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const VALUED = ['--wait', '--trailer', '--base'];
const asJson = argv.includes('--json');
const [cmd, rawId, milestone, ...surplus] = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const ID = rawId?.toUpperCase() ?? null;

// Cleanup runs on every exit, a crash included: put the edit back unless it was
// committed, then release the lock if this run took it.
const cleanup = { edit: null, lock: null };
let lockNote = '';
const tidy = () => {
  if (cleanup.edit) { cleanup.edit(); cleanup.edit = null; }
  if (cleanup.lock) { lockNote = cleanup.lock(); cleanup.lock = null; }
};
process.on('exit', tidy);

const done = (code, action, msg, extra = {}) => {
  tidy();
  if (lockNote) msg += `\n${lockNote}`;
  if (asJson) console.log(JSON.stringify({ id: ID, action, message: msg, ...extra }));
  else (code === 0 ? console.log : console.error)(`ship: ${msg}`);
  process.exit(code);
};

const usage = 'usage: node scripts/ship.mjs claim <P#|B#> [R#] [--wait <s>] [--trailer <line>] [--base <branch>] [--json]';
if (cmd !== 'claim' || !ID || surplus.length) done(2, 'error', usage);
const REG = buildableRegister(ID);
if (!REG) done(2, 'error', `"${rawId}" is not a buildable id (P# or B#).\n${usage}`);
const MILESTONE = milestone?.toUpperCase() ?? null;
if (MILESTONE && !/^R\d+$/.test(MILESTONE)) done(2, 'error', `"${milestone}" is not a milestone (R#).\n${usage}`);
// A valued flag with nothing after it is an error, never its default (as with --base, B1).
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) done(2, 'error', `${name} needs a value.\n${usage}`);
  return v;
};
const wait = opt('--wait', '600');
if (!/^\d+$/.test(wait)) done(2, 'error', `--wait takes whole seconds, not "${wait}".`);
const trailer = opt('--trailer');

// Same git invocation as worktree.mjs and land.mjs: no shell, WSL-safe. Output is
// untrimmed, as claims.mjs reads it: trim() would quietly repair a header with a
// leading blank line or BOM, and the porcelain status's leading column.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
let lastError = '';
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\n$/, '');
  } catch (e) {
    // A hook may report on either stream.
    lastError = [e.stderr, e.stdout].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n') || String(e.message);
    return null;
  }
};
const firstLine = () => lastError.split('\n')[0];

const top = git('rev-parse', '--show-toplevel');
if (top === null) done(2, 'error', `not a git repository, or git refused it.${lastError ? ` git: ${firstLine()}` : ''}`);
const gitDir = resolve(top, git('rev-parse', '--git-dir'));
if (gitDir !== resolve(top, git('rev-parse', '--git-common-dir'))) {
  done(1, 'refused', `this is a linked worktree (${top}). Claims are made in the main checkout, on the trunk, so every session sees them.`);
}
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const { trunk: BASE, error: baseError } = trunkFromArgv(argv, branches);
if (baseError) done(2, 'error', baseError);
const head = git('symbolic-ref', '--quiet', '--short', 'HEAD');
if (head !== BASE) done(1, 'refused', `the main checkout is on ${head ?? 'a detached HEAD'}, not ${BASE}. A claim made off the trunk is invisible to other sessions.`);

const refuseIfDirty = () => {
  const d = git('status', '--porcelain');
  if (d === null) done(2, 'error', `git status failed: ${firstLine()}`);
  if (d) done(1, 'refused', `the main checkout has uncommitted changes:\n${d.split('\n').map((l) => `  ${l}`).join('\n')}\nCommit them as their own unit (or ask whose they are) before claiming ${ID}.`);
};
refuseIfDirty();

// The lock, through land.mjs: one implementation of who holds it and when it is stale.
const land = (...args) => spawnSync(process.execPath, [join(HERE, 'land.mjs'), ...args, '--base', BASE], { cwd: top, encoding: 'utf8' });
const OWNER = `claim:${ID}`;
const status = land('lock', 'status', '--json');
let heldBefore = false;
try { heldBefore = status.status === 0 && JSON.parse(status.stdout || 'null')?.owner === OWNER; } catch { /* unreadable: take it below */ }
const took = land('lock', 'take', OWNER, '--wait', wait);
if (took.status !== 0) {
  done(took.status === 1 ? 1 : 2, took.status === 1 ? 'refused' : 'error',
    `could not take the land lock. ${(took.stderr || took.stdout).trim().replace(/^land: /, '')}`);
}
// land.mjs says when taking the lock cleared a stale one; that is worth passing on.
const cleared = /\(cleared a stale lock[^)]*\)/.exec(took.stdout)?.[0] ?? '';
if (!heldBefore) {
  cleanup.lock = () => {
    const r = land('lock', 'release', OWNER);
    return r.status === 0 ? '' : `The land lock is still held by ${OWNER}: ${(r.stderr || r.stdout).trim()} Release it with \`node scripts/land.mjs lock release ${OWNER}\`.`;
  };
}

// Another session may have committed while this one waited for the lock.
refuseIfDirty();

// The entry and its dependencies, read from the trunk — never a stale copy.
const rel = `${REG.dir}/${ID}.md`;
const text = git('show', `${BASE}:${rel}`);
if (text === null) done(1, 'refused', `${ID} has no entry on ${BASE} — untriaged ideas go to /triage first.`);
const entry = parseEntry(text, REG.keys);
const was = entry.header.status;
if (!was) done(1, 'refused', `${rel} on ${BASE} has no readable \`status:\` header. Run npm run check:docs for what is wrong with it.`);
if (was === 'in-progress') done(1, 'refused', `${ID} is already claimed: it is \`in-progress\` on ${BASE}. A stale claim is cleared through /ship, never overridden.`);
if (!REG.open.has(was)) done(1, 'refused', `${ID} is \`${was}\` on ${BASE}, which is closed. Reopening it is the owner's call, not a claim.`);

// As worktree.mjs words it (B10): a moved assumption or a superseded decision is
// forwarded, not settled, so the fix is to re-point the dependency.
const unmet = idsOf(entry, 'depends_on').map((id) => {
  const reg = registerOf(id);
  const dep = reg && git('show', `${BASE}:${reg.dir}/${id}.md`);
  const parsed = dep ? parseEntry(dep, reg.keys) : null;
  return { id, status: parsed?.header.status ?? null, to: newHomeOf(parsed) };
}).filter((d) => !dependencyMet(d.id, d.status));
if (unmet.length) {
  const forwarded = unmet.filter((d) => d.to.length);
  const open = unmet.filter((d) => !d.to.length);
  const kind = (re) => open.some((d) => re.test(d.id));
  const fixes = [
    kind(/^[PB]\d/) && 'build what it depends on first',
    kind(/^D-/) && 'an open decision is the owner\'s to take',
    kind(/^A-/) && 'an open assumption needs its Resolution',
    forwarded.length && `re-point its \`depends_on:\` via /ship: ${forwarded.map((d) => `${d.id} → ${d.to.join(', ')}`).join(', ')}`,
  ].filter(Boolean).join('; ');
  done(1, 'refused', `${ID} depends on ${unmet.map((d) => `${d.id} (${d.status ? `\`${d.status}\`` : 'no entry'})`).join(', ')} on ${BASE}. ${fixes[0].toUpperCase()}${fixes.slice(1)}.`,
    { unmet: unmet.map(({ id, status: s }) => ({ id, status: s })) });
}

// The edit: the header's status line, nothing else, in the file's own line endings.
const path = join(top, rel);
const before = readFileSync(path, 'utf8');
const eol = before.includes('\r\n') ? '\r\n' : '\n';
const lines = before.split(eol);
const end = lines.indexOf('---', 1);
const at = lines.findIndex((l, i) => i > 0 && i < end && /^status:/.test(l));
if (lines[0] !== '---' || end < 0 || at < 0) done(1, 'refused', `${rel} has no \`status:\` line in its header to flip.`);
lines[at] = 'status: in-progress';
cleanup.edit = () => writeFileSync(path, before);
writeFileSync(path, lines.join(eol));

const check = spawnSync(process.execPath, [join(HERE, 'backlog-schema-check.mjs'), '--all'], {
  cwd: top, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: top },
});
if (check.status !== 0) {
  done(1, 'refused', `the schema check is red with ${ID} claimed, so nothing was committed:\n${`${check.stdout}\n${check.stderr}`.trim()}`);
}

const what = MILESTONE ? `${ID} ${MILESTONE}` : ID;
const message = `docs: claim ${what} (${ID})${trailer ? `\n\n${trailer}` : ''}`;
if (git('commit', '-q', '-m', message, '--', rel) === null) {
  done(1, 'refused', `the commit failed, so ${ID} is unclaimed and the file is put back. git: ${lastError}`);
}
cleanup.edit = null;
done(0, 'claimed', `${what} claimed on ${BASE} (${git('rev-parse', '--short', 'HEAD')}).${cleared ? ` The land lock: ${cleared.slice(1, -1)}.` : ''}`, { commit: git('rev-parse', 'HEAD') });
