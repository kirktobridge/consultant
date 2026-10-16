// session-audit — what the last session left dangling, shown to the next one.
//
// It runs when a session starts, from a SessionStart hook in .claude/settings.json,
// whose stdout lands in the new session's context (OD-10). Start rather than end
// because a session that crashed or was simply closed never runs an end-of-session
// step, and those are the sessions most likely to have left something behind.
//
// Its checks split cleanly in two:
//
//   COMPUTING THE FINDING  — is any status dishonest, is anything dangling, did an
//                            assumption resolve without its dependents being swept.
//                            All decidable from git + the docs. That's this script.
//
//   DECIDING THE RESPONSE  — is that in-progress entry abandoned or just paused, is
//                            this untracked file worth committing. Judgement. That
//                            stays with the session and the user.
//
// A model running these greps and eyeballing them will occasionally mis-read one, and
// the failure is silent by construction (LESSONS L1). A script re-runs identically
// every time and cannot decide it already knows the answer.
//
// Exit: 0 nothing dangling | 1 findings to resolve | 2 could not audit (not a repo, &c.)
// OD-10: a SessionStart hook's output is dropped on a non-zero exit, so the hook
// forces 0 — exactly when there are findings is when the exit code would hide them.
//
// Usage: node scripts/session-audit.mjs [--base <branch>] [--json]

import { execFileSync } from 'node:child_process';
import { BACKLOG, DECISIONS, loadRegister, idsOf } from './entries.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
// indexOf returns -1 when absent, and argv[-1 + 1] is argv[0] — which silently made
// the next flag the branch name. Guard the lookup rather than the arithmetic.
const baseIdx = argv.indexOf('--base');
const baseArg = baseIdx >= 0 ? argv[baseIdx + 1] : null;

const findings = [];
const add = (severity, what, action) => findings.push({ severity, what, action });

// Two things break git when a Windows `claude` audits a repo inside WSL
// (\\wsl.localhost\…), and both read as "not a git repository":
//   - a shell. execSync runs cmd.exe, which cannot start in a UNC directory and
//     silently falls back to C:\Windows. execFileSync runs git directly.
//   - git's ownership check. Windows sees the WSL files as another user's and refuses
//     the repo. safe.directory=* lifts it for these calls only. That trusts this
//     repository's git config, which adds nothing: whoever runs this is already
//     running a script from the same repository.
// And one that makes it lie rather than fail: Windows has no executable bit, so every
// committed hook script reads as modified (755 → 644) — a dirty-tree finding at every
// session start. filemode=false is set on Windows only, so Linux still catches a
// real mode change.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
let lastError = '';
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    lastError = String(e.stderr ?? e.message ?? '').trim();
    return null;
  }
};

if (git('rev-parse', '--git-dir') === null) {
  // Pass git's own reason on: "not a repository" and "git refused this one" need
  // different fixes, and one message for both sends the reader after the wrong one.
  console.error(`session-audit: not a git repository, or git refused it — nothing to audit.${lastError ? `\n  git: ${lastError.split('\n')[0]}` : ''}`);
  process.exit(2);
}

// The integration branch. Guessing wrong would make every merge-state check lie, so
// this resolves against branches that actually exist rather than assuming `main`.
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const BASE = baseArg || ['main', 'master', 'trunk'].find((b) => branches.includes(b)) || null;
if (!BASE) {
  console.error(
    `session-audit: no integration branch found (looked for main/master/trunk among: ${branches.join(', ') || 'none'}).\n` +
      `Pass --base <branch>.`,
  );
  process.exit(2);
}

// ── Doc read ─────────────────────────────────────────────────────────────────
// Headers only, through the same strict reader the schema check uses. This is NOT the
// schema authority — backlog-schema-check.mjs is, and it reports a malformed header
// loudly. A field this audit can't read is simply absent here, so a format problem
// shows up as a red check rather than as a quietly different audit.

const backlog = loadRegister(ROOT, BACKLOG).entries;
const decisions = loadRegister(ROOT, DECISIONS).entries;
const odById = new Map(decisions.map((d) => [d.id, d]));
const today = new Date().toISOString().slice(0, 10);

// ── 1. Working tree ──────────────────────────────────────────────────────────

const status = git('status', '--porcelain') || '';
const dirty = status.split('\n').filter(Boolean);
if (dirty.length) {
  const untrackedCode = dirty
    .filter((l) => l.startsWith('??') && /\s(src|scripts|tests?)\//.test(l))
    .map((l) => l.slice(3));
  add('info', `${dirty.length} uncommitted change(s) in the working tree.`,
    'Commit each completed unit on its own, code and docs separate — or, if they are a previous session\'s abandoned edits, ask the user before discarding them.');
  if (untrackedCode.length) {
    add('warn', `Untracked file(s) under code directories: ${untrackedCode.join(', ')}.`,
      'These are usually a half-finished unit or a scratch file that escaped the scratchpad. Commit with their feature, or delete.');
  }
}

// ── 2. Spikes and the assumptions they owe ───────────────────────────────────
// The schema check fails a *shipped* spike whose OD is still open. That leaves the
// in-flight case, where the answer may exist only in a session's transcript.

for (const e of backlog) {
  for (const odId of idsOf(e, 'resolves').filter((id) => /^OD-/.test(id))) {
    const od = odById.get(odId);
    if (!od) continue; // schema check owns dangling refs
    if (od.status !== 'open') continue;
    if (e.status === 'in-progress' || e.status === 'partial') {
      add('warn', `Spike ${e.id} is \`${e.status}\` and ${odId} is still \`open\`.`,
        `If a session established the answer, write it into ${odId}'s Resolution via /ship — an answer that exists only in the transcript is lost. If not, the spike is still owed.`);
    }
  }
}

// ── 3. Claims that no longer match reality ───────────────────────────────────
// An `in-progress` entry means "a branch is building this right now". If no unmerged
// branch mentions it, that claim is either finished (needs its /ship flip, or — on the
// last milestone — the user's acceptance, since /land never flips `shipped`) or
// abandoned (needs clearing), and these look identical from the doc alone.

const unmerged = (git('branch', '--no-merged', BASE, '--format=%(refname:short)') || '')
  .split('\n').filter(Boolean);
const merged = (git('branch', '--merged', BASE, '--format=%(refname:short)') || '')
  .split('\n').filter(Boolean).filter((b) => b !== BASE);

for (const e of backlog.filter((x) => x.status === 'in-progress')) {
  // A word match, not a substring: `includes('p1')` read feat/p18-… as P1's branch,
  // which hid an abandoned P1 claim behind any branch whose ID starts with 1.
  const names = new RegExp(`\\b${e.id}\\b`, 'i');
  const onUnmerged = unmerged.some((b) => names.test(b));
  const onMerged = merged.some((b) => names.test(b));
  if (onUnmerged) continue; // legitimately in flight
  if (onMerged) {
    add('warn', `${e.id} is \`in-progress\` but its branch is already merged into ${BASE}.`,
      `If milestones remain, its \`partial\` flip was missed — run /ship on ${BASE}. If that was the last one, it awaits the user's acceptance: show them /land's per-criterion report and ask. \`shipped\` is their flip, never yours.`);
  } else {
    add('warn', `${e.id} is \`in-progress\` but no branch names it.`,
      'Either the work merged and its flip is owed (`partial` via /ship, or `shipped` once the user accepts it — ask them), or this is an abandoned claim blocking another session from picking the entry up: clear it back to `proposed` via /ship. Resolve it — a stale claim is worse than no claim.');
  }
}

// ── 4. Resolutions nobody swept ──────────────────────────────────────────────
// A resolved OD changes the state of every entry that named it, and nothing else in
// the loop notices. `refuted` is the case worth stopping over: those dependents may
// be void rather than unblocked.

for (const od of decisions) {
  if (od.status === 'open') continue;
  const resolvedToday = od.header.resolved === today;
  const changedThisSession = (git('diff', BASE, '--name-only') || '').includes(`${DECISIONS.dir}/`);
  if (!resolvedToday && !changedThisSession) continue;
  const dependents = backlog.filter((e) => idsOf(e, 'depends_on').includes(od.id));
  if (dependents.length === 0) continue;
  const ids = dependents.map((d) => `${d.id} (${d.status})`).join(', ');
  add(od.status === 'refuted' ? 'alert' : 'info',
    `${od.id} is \`${od.status}\`${resolvedToday ? ' (resolved today)' : ''} and ${dependents.length} entr(y/ies) depend on it: ${ids}.`,
    od.status === 'refuted'
      ? 'A refutation can VOID dependents rather than unblock them — re-read each against the new truth, and check whether anything already shipped on the false assumption. Deep pass: /triage groom.'
      : 'These are now unblocked and nothing else will notice. Consider promoting one into the queue (docs/backlog/QUEUE.md) via /ship.');
}

// ── Report ───────────────────────────────────────────────────────────────────

if (asJson) {
  console.log(JSON.stringify({ base: BASE, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

const RANK = { alert: 0, warn: 1, info: 2 };
const LABEL = { alert: 'ALERT', warn: 'CHECK', info: 'note ' };
findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

if (findings.length === 0) {
  console.log(`session-audit: clean (base ${BASE}) — statuses match reality, tree committed.`);
  process.exit(0);
}
console.log(`session-audit: ${findings.length} item(s) left dangling — resolve before starting new work (base ${BASE})\n`);
for (const f of findings) console.log(`  [${LABEL[f.severity]}] ${f.what}\n           → ${f.action}\n`);
process.exit(1);
