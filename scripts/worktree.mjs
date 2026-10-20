// worktree — give a claimed entry its own branch and worktree, off local main (P15 R1).
// A bug (`B#`) gets one the same way as a feature (`P#`), from its own register (P5 R1).
//
// /implement used to leave this to the user: when to take a worktree, what to call the
// branch, whether the claim was visible from it. Every one of those is decidable from
// git and the backlog, so it is decided here rather than in the skill's prose.
//
//   - The claim must already be on the integration branch. A worktree cut before the
//     claim commit carries a backlog in which the entry is still unclaimed, and the
//     claim gate exists to stop exactly that.
//   - A claimed entry whose dependencies are unmet is refused, resumed or not (P32):
//     the claim reaching main does not prove it passed the schema check.
//   - The branch is cut from *local* main, explicitly, never from origin: the claim is
//     usually unpushed (A-6). settings.json's `worktree.baseRef: head` says the same
//     for any worktree EnterWorktree makes itself.
//   - It runs from the main checkout only. Inside a linked worktree the session is
//     refused git aimed at another checkout, and a worktree of a worktree is nobody's
//     intent.
//   - An entry that already has its branch is resumed, never duplicated — "continue
//     P15" in a fresh session lands back in the same worktree.
//
// Ad-hoc work (P33), a change too small to be an entry, gets `adhoc/<slug>` the same
// way, minus everything an entry supplies: no claim, no dependencies, no register. The
// main-checkout, clean-tree and resume rules still hold; they protect the checkout, not
// the backlog.
//
// The session then enters the printed path with EnterWorktree (`path:`), which is what
// lets ExitWorktree `keep` hand it back to the main checkout for the landing (R2).
//
// Exit: 0 created or resumed (last stdout line: `path: <abs>`) | 1 refused — a gate
// failed, the message says which | 2 could not run (not a repo, no integration branch)
//
// Usage: node scripts/worktree.mjs start <P#|B#> [--slug <slug>] [--base <branch>] [--json]
//        node scripts/worktree.mjs start --adhoc <slug> [--base <branch>] [--json]

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildableRegister, registerOf, parseEntry, idsOf, dependencyMet } from './entries.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] ?? null : null;
  return v?.startsWith('--') ? null : v; // `--adhoc --json` has no slug; `json` is not one
};
const asJson = argv.includes('--json');
const [cmd, rawId] = argv.filter((a, i) => !a.startsWith('--') && !['--slug', '--base', '--adhoc'].includes(argv[i - 1]));

const usage = 'usage: node scripts/worktree.mjs start <P#|B#> [--slug <slug>] [--base <branch>] [--json]\n'
  + '       node scripts/worktree.mjs start --adhoc <slug> [--base <branch>] [--json]';
const slugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const ADHOC = argv.includes('--adhoc');
if (cmd !== 'start' || (ADHOC ? rawId || argv.includes('--slug') : !rawId)) { console.error(usage); process.exit(2); }
const adhocSlug = ADHOC ? slugify(flag('--adhoc')) : null;
if (ADHOC && !adhocSlug) { console.error(`worktree: --adhoc needs a slug naming the change.\n${usage}`); process.exit(2); }
const ID = ADHOC ? `adhoc/${adhocSlug}` : rawId.toUpperCase();
const REG = ADHOC ? null : buildableRegister(ID);
if (!ADHOC && !REG) { console.error(`worktree: "${rawId}" is not a buildable id (P# or B#).\n${usage}`); process.exit(2); }

// Same git invocation as session-audit: no shell, and the WSL/Windows ownership and
// filemode workarounds, for the same reasons given there.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
let lastError = '';
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    lastError = String(e.stderr ?? e.message ?? '').trim();
    return null;
  }
};

const done = (code, action, msg, extra = {}) => {
  if (asJson) console.log(JSON.stringify({ id: ID, action, message: msg, ...extra }));
  else {
    (code === 0 ? console.log : console.error)(`worktree: ${msg}`);
    if (extra.path) console.log(`path: ${extra.path}`);
  }
  process.exit(code);
};

const top = git('rev-parse', '--show-toplevel');
if (top === null) done(2, 'error', `not a git repository, or git refused it.${lastError ? ` git: ${lastError.split('\n')[0]}` : ''}`);

const gitDir = resolve(top, git('rev-parse', '--git-dir'));
const commonDir = resolve(top, git('rev-parse', '--git-common-dir'));
if (gitDir !== commonDir) {
  done(1, 'refused', `this is a linked worktree (${top}). Run it from the main checkout — a session inside a worktree is refused git aimed at another checkout.`);
}

const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const BASE = flag('--base') || ['main', 'master', 'trunk'].find((b) => branches.includes(b)) || null;
if (!BASE || !branches.includes(BASE)) {
  done(2, 'error', `no integration branch found (looked for ${flag('--base') || 'main/master/trunk'} among: ${branches.join(', ') || 'none'}). Pass --base <branch>.`);
}

const worktrees = new Map(); // branch → path
let wtPath = null;
for (const line of (git('worktree', 'list', '--porcelain') || '').split('\n')) {
  if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length);
  else if (line.startsWith('branch refs/heads/')) worktrees.set(line.slice('branch refs/heads/'.length), wtPath);
}

// A worktree lives at .claude/worktrees/<branch after `feat/`>; an ad-hoc one keeps an
// `adhoc-` prefix, so a slug can never land on an entry's directory.
const pathFor = (branch) => join(top, '.claude', 'worktrees', branch.replace(/^feat\//, '').replace(/^adhoc\//, 'adhoc-'));

/** Resume `branch` if it exists (giving it its worktree back if need be), else cut it off BASE. */
function provision(branch, exists) {
  const path = worktrees.get(branch) || pathFor(branch);
  const what = ADHOC ? branch : `${ID} → ${branch}`;
  const has = ADHOC ? `${branch} exists` : `${ID} already has ${branch}`;
  if (exists) {
    if (worktrees.has(branch)) done(0, 'resumed', `${has}; resuming its worktree.`, { branch, path });
    if (existsSync(path)) done(1, 'refused', `${path} exists but is not ${branch}'s worktree. Move it aside, then re-run.`);
    if (git('worktree', 'add', '-q', path, branch) === null) done(2, 'error', `git worktree add failed: ${lastError.split('\n')[0]}`);
    done(0, 'resumed', `${has}; gave it a worktree again.`, { branch, path });
  }
  // A new branch. Same rule as /implement's clean-tree gate: a dirty main checkout is
  // another task's live state, and the integration step will refuse it later anyway.
  const dirty = git('status', '--porcelain');
  if (dirty === null) done(2, 'error', `git status failed: ${lastError.split('\n')[0]}`);
  if (dirty) {
    done(1, 'refused', `the main checkout has uncommitted changes:\n${dirty.split('\n').map((l) => `  ${l}`).join('\n')}\nCommit them as their own unit (or ask whose they are) before starting ${ID}.`);
  }
  if (existsSync(path)) done(1, 'refused', `${path} already exists and is not a worktree of ${branch}. Move it aside, then re-run.`);
  if (git('worktree', 'add', '-q', '-b', branch, path, BASE) === null) {
    done(2, 'error', `git worktree add failed: ${lastError.split('\n')[0]}`);
  }
  done(0, 'created', `${what}, off local ${BASE} (${git('rev-parse', '--short', BASE)}).`, { branch, path });
}

if (ADHOC) provision(ID, branches.includes(ID));

// The claim, read from the integration branch — never the checked-out copy.
const text = git('show', `${BASE}:${REG.dir}/${ID}.md`);
if (text === null) done(1, 'refused', `${ID} has no entry on ${BASE} — untriaged ideas go to /triage first.`);
const entry = parseEntry(text, REG.keys);
const status = entry.header.status;
if (!REG.claimed.includes(status)) {
  done(1, 'refused', `${ID} is \`${status}\` on ${BASE}, not claimed. Claim it on ${BASE} first (via /ship), then start its worktree — a worktree cut before the claim commit cannot see the claim.`);
}

// /implement's DEPENDS GATE, held here too (P32). The schema check refuses a blocked
// claim at commit time, but a claim can still reach main past it — no hook installed,
// `--no-verify`, or a dependency that reopened after the claim. Read from main, like
// the claim, and applied before resuming as well as before creating. Direct
// dependencies only: the schema check walks the chains.
const unmet = idsOf(entry, 'depends_on').map((id) => {
  const reg = registerOf(id);
  const dep = reg && git('show', `${BASE}:${reg.dir}/${id}.md`);
  return { id, status: dep ? parseEntry(dep, reg.keys).header.status ?? null : null };
}).filter((d) => !dependencyMet(d.id, d.status));
if (unmet.length) {
  done(1, 'refused', `${ID} is claimed but blocked on ${BASE}: it depends on ${unmet.map((d) => `${d.id} (${d.status ? `\`${d.status}\`` : 'no entry'})`).join(', ')}. Settle what blocks it first — an open decision is the user's to take, an open assumption needs its Resolution — then re-run.`,
    { unmet });
}

// Existing work for this entry is resumed, not duplicated. The `-` keeps P1 from
// matching P15's branch. A bug's branch is `feat/b<#>-…` too: every script that finds an
// entry from its branch reads the ID after `feat/`, whichever register it is in.
const prefix = `feat/${ID.toLowerCase()}-`;
const mine = branches.filter((b) => b.startsWith(prefix));
if (mine.length > 1) {
  done(1, 'refused', `${ID} has ${mine.length} branches (${mine.join(', ')}). Which one is live is a judgement — delete the stale one, then re-run.`);
}
if (mine.length === 1) provision(mine[0], true);

const slug = slugify(flag('--slug') || entry.header.title).split('-').filter(Boolean).slice(0, 4).join('-');
if (!slug) done(1, 'refused', `${ID} has no title to name its branch after. Pass --slug <slug>.`);
provision(`${prefix}${slug}`, false);
