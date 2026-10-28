// session-audit — what the last session left dangling, shown to the next one.
//
// It runs when a session starts, from a SessionStart hook in .claude/settings.json,
// whose stdout lands in the new session's context (A-10). Start rather than end
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
// A-10: a SessionStart hook's output is dropped on a non-zero exit, so the hook
// forces 0 — exactly when there are findings is when the exit code would hide them.
//
// Usage: node scripts/session-audit.mjs [--base <branch>] [--json]

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKLOG, BUGS, ASSUMPTIONS, DECISIONS, loadRegister, idsOf, parseQueue, today as localToday } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { trunkGraph, graphIndex } from './trunk-graph.mjs';
import { settledDependents, sweepAdvice, isRecent, branchNames } from './sweep.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

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
// A --base must name a real branch too: one that names nothing made every check below
// pass vacuously, and the audit reported clean against a branch it never read (B1).
const { trunk: BASE, error: baseError } = trunkFromArgv(argv, branches);
if (baseError) {
  console.error(`session-audit: ${baseError}`);
  process.exit(2);
}

// ── Doc read ─────────────────────────────────────────────────────────────────
// Headers only, through the same strict reader the schema check uses. This is NOT the
// schema authority — backlog-schema-check.mjs is, and it reports a malformed header
// loudly. A field this audit can't read is simply absent here, so a format problem
// shows up as a red check rather than as a quietly different audit.

const backlog = loadRegister(ROOT, BACKLOG).entries;
// What a branch can be building: a feature or a bug fix (P5 R1). Claims are audited
// across both; spikes and dependents below stay the backlog's business.
const buildable = [...backlog, ...loadRegister(ROOT, BUGS).entries];
const assumptions = loadRegister(ROOT, ASSUMPTIONS).entries;
const aById = new Map(assumptions.map((d) => [d.id, d]));
const decisions = loadRegister(ROOT, DECISIONS).entries;
const today = localToday();

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
// The schema check fails a *shipped* spike whose assumption is still open. That leaves the
// in-flight case, where the answer may exist only in a session's transcript.

for (const e of backlog) {
  for (const aId of idsOf(e, 'resolves').filter((id) => /^A-/.test(id))) {
    const assumption = aById.get(aId);
    if (!assumption) continue; // schema check owns dangling refs
    if (assumption.status !== 'open') continue;
    if (e.status === 'in-progress' || e.status === 'partial') {
      add('warn', `Spike ${e.id} is \`${e.status}\` and ${aId} is still \`open\`.`,
        `If a session established the answer, write it into ${aId}'s Resolution via /ship — an answer that exists only in the transcript is lost. If not, the spike is still owed.`);
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
// "Merged" means landed: the branch tip arrived through a merge, so it is off main's
// first-parent line. A branch just cut by worktree.mjs, with no commits of its own,
// sits ON that line, and `git branch --merged` counts it too, which read every fresh
// build as a finished one.
const firstParent = new Set((git('rev-list', '--first-parent', BASE) || '').split('\n').filter(Boolean));
const gitMerged = (git('branch', '--merged', BASE, '--format=%(refname:short) %(objectname)') || '')
  .split('\n').filter(Boolean).map((l) => l.split(' ')).filter(([b]) => b !== BASE);
const merged = gitMerged.filter(([, sha]) => !firstParent.has(sha)).map(([b]) => b);
const fresh = gitMerged.filter(([, sha]) => firstParent.has(sha)).map(([b]) => b);

for (const e of buildable.filter((x) => x.status === 'in-progress')) {
  const bug = BUGS.idPattern.test(e.id);
  const names = branchNames(e.id);
  const onUnmerged = [...unmerged, ...fresh].some((b) => names.test(b));
  const onMerged = merged.some((b) => names.test(b));
  if (onUnmerged) continue; // legitimately in flight
  if (onMerged) {
    add('warn', `${e.id} is \`in-progress\` but its branch is already merged into ${BASE}.`, bug
      ? `/land left it for the user, so its report did not clear it (D-7): show them /land's per-criterion report and ask whether it is fixed. Only /land marks a bug fixed without them; from here, \`fixed\` is their word, not yours.`
      : `If milestones remain, its \`partial\` flip was missed — run /ship on ${BASE}. If that was the last one, it awaits the user's acceptance: show them /land's per-criterion report and ask. \`shipped\` is their flip, never yours.`);
  } else {
    add('warn', `${e.id} is \`in-progress\` but no branch names it.`, bug
      ? 'Either the fix merged and /land left it for the user (its report did not clear it, D-7: ask them whether it is fixed), or this is an abandoned claim blocking another session from picking the bug up: clear it back to `open` via /ship. Resolve it — a stale claim is worse than no claim.'
      : 'Either the work merged and its flip is owed (`partial` via /ship, or `shipped` once the user accepts it — ask them), or this is an abandoned claim blocking another session from picking the entry up: clear it back to `proposed` via /ship. Resolve it — a stale claim is worse than no claim.');
  }
}

// ── 3b. Worktrees and the land lock left behind (P15 R3) ─────────────────────
// `land.mjs finish` removes an entry's worktree and releases the lock once it lands.
// A session that crashed between the merge and the finish, or gave up mid-build,
// leaves either one behind, and the next session would trip over it: a stale
// worktree pins its branch, and a held lock stalls every claim and landing.

const landScript = join(dirname(fileURLToPath(import.meta.url)), 'land.mjs');
let lock = null;
if (existsSync(landScript)) {
  try {
    lock = JSON.parse(execFileSync(process.execPath, [landScript, 'lock', 'status', '--json', '--base', BASE], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch { /* no lock, or unreadable: land.mjs reports that itself when used */ }
}

let wtPath = null;
for (const line of (git('worktree', 'list', '--porcelain') || '').split('\n')) {
  if (line.startsWith('worktree ')) { wtPath = line.slice(9); continue; }
  const m = line.match(/^branch refs\/heads\/(.+)$/);
  if (!m || m[1] === BASE) continue;
  const branch = m[1];
  const id = (branch.match(/^feat\/([pb]\d+)-/i) || [])[1]?.toUpperCase();
  // Between `merge` and `finish` the landing still holds the lock while /ship writes
  // its flips: merged, worktree present, and live. Not a leftover.
  const landing = lock?.owner === branch && lock.state === 'live';
  if (merged.includes(branch) && !landing) {
    add('warn', `Worktree ${wtPath} is for ${branch}, which is already merged into ${BASE}.`,
      `Its landing never finished. From the main checkout: node scripts/land.mjs finish ${branch} (take the lock first if it isn't held: node scripts/land.mjs lock take ${branch}).`);
  } else if (id) {
    const e = buildable.find((x) => x.id === id);
    const claimed = BUGS.idPattern.test(id) ? BUGS.claimed : BACKLOG.claimed;
    if (!e || !claimed.includes(e.status)) {
      add('warn', `Worktree ${wtPath} is building ${id} (${branch}), but ${id} is ${e ? `\`${e.status}\`` : 'not in its register'} — its claim is gone.`,
        `Either re-claim ${id} via /ship and carry on, or, if the work is abandoned, ask the user before removing the worktree and branch: it may hold unmerged work.`);
    }
  }
}

if (lock?.state === 'stale') {
  add('info', `The land lock is held by ${lock.owner} since ${lock.at}, which has finished or gone.`,
    'It is stale and the next `lock take` clears it automatically; nothing to do unless it recurs.');
} else if (lock?.state === 'ambiguous') {
  add('alert', `The land lock has been held by ${lock.owner} (${lock.worktree}) since ${lock.at}, and that branch is not merged.`,
    `Every claim and landing waits on it. Ask the user whether that landing is still running; if it crashed, release it: node scripts/land.mjs lock release ${lock.owner}`);
}

// ── 4. Resolutions and decisions nobody swept ────────────────────────────────
// A resolved assumption changes the state of every entry that named it, and nothing else in
// the loop notices. `refuted` is the case worth stopping over: those dependents may
// be void rather than unblocked.

// What each outcome did to its dependents, features and bugs both, is sweep.mjs's
// answer, shared with groom and /ship's sweep (P42). This section adds only when it is
// news: settled today, or the resolution's own file differs from the trunk.
const changed = (git('diff', BASE, '--name-only') || '').split('\n').filter(Boolean);
for (const x of [...assumptions, ...decisions]) {
  const r = settledDependents(x, buildable);
  if (!r || !r.dependents.length || !isRecent(x, changed, today)) continue;
  const verb = ASSUMPTIONS.idPattern.test(x.id) ? 'resolved' : 'decided';
  const ids = r.dependents.map((d) => `${d.id} (${d.status})`).join(', ');
  add(r.kind === 'void' ? 'alert' : r.kind === 're-point' ? 'warn' : 'info',
    `${x.id} is \`${x.status}\`${r.date === today ? ` (${verb} today)` : ''} and ${r.dependents.length} entr(y/ies) depend on it: ${ids}.`,
    `${sweepAdvice(r)}${r.kind === 'void' ? ' Deep pass: /triage groom.' : ''}`);
}

// ── 5. Choices waiting on the user ───────────────────────────────────────────
// Not findings: an open decision is not something a session left dangling, and an
// audit that can never come back clean teaches people to skip it. Listed apart, so
// the questions only the user can unblock reach them at the start of every session.

const waitingOnUser = decisions
  .filter((d) => d.status === 'open' && (d.header.waiting_on ?? '').split(/,\s*/).includes('user'))
  .map((d) => {
    const held = backlog.filter((e) => idsOf(e, 'depends_on').includes(d.id)).map((e) => e.id);
    const also = idsOf(d, 'waiting_on');
    return { id: d.id, title: d.header.title ?? '', alsoWaitingOn: also, holds: held };
  });
const waitingLines = waitingOnUser.map((w) =>
  `  ${w.id} — ${w.title}` +
    (w.alsoWaitingOn.length ? ` (also waiting on ${w.alsoWaitingOn.join(', ')})` : '') +
    (w.holds.length ? ` — holds back ${w.holds.join(', ')}` : ''));
const waitingBlock = waitingOnUser.length
  ? `\nWaiting on the user — choices only they can make (docs/decisions/); raise them:\n${waitingLines.join('\n')}\n`
  : '';

// ── 6. What's ahead (P19) ────────────────────────────────────────────────────
// Not findings either: the forward view, so a session opens knowing what to pick up
// and what is about to block, not only what was left dangling. Rendered from P11's
// graph on the trunk, the one dependency source, walked with trunk-graph's graphIndex;
// the queue file, which the graph does not carry, is the only other input. It lands in
// every session's context, so it stays a few lines: IDs, not paragraphs. And it is
// optional: a forward view that fails must never cost the findings above.

const ahead = (() => {
  try {
    const { graph, failed, warning } = trunkGraph({ root: ROOT, base: BASE, git });
    if (failed) return { failed };
    const { meta, blockersOf, downstream } = graphIndex(graph);
    const queueText = git('show', `${BASE}:${BACKLOG.queue}`);
    const queued = queueText === null ? [] : parseQueue(queueText).ids;
    const features = graph.entries.filter((e) => e.open && BACKLOG.idPattern.test(e.id));

    // A ready bug goes before the queue. Which one is next.mjs's answer, asked rather
    // than re-derived, so this line can never disagree with what /implement picks.
    // Optional like the rest: if next.mjs can't answer, the queue lines still stand.
    let bugFirst = null;
    const nr = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'next.mjs'), '--json', '--base', BASE], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    });
    try {
      const pick = JSON.parse(nr.stdout).next;
      if (pick?.from === 'bugs') bugFirst = { id: pick.id, title: meta.get(pick.id)?.title ?? '', severity: pick.severity ?? null };
    } catch { /* no answer: name the queue only */ }

    // The queue's head as next.mjs reads it: the first queued entry nobody has claimed.
    // The queue may hold an entry below its own unshipped dependency, so a held head says so.
    const head = queued.find((id) => meta.get(id)?.status !== 'in-progress') ?? null;
    const claimedAhead = head ? queued.slice(0, queued.indexOf(head)) : queued;
    const readyUnqueued = features
      .filter((e) => e.status !== 'in-progress' && !queued.includes(e.id) && !blockersOf(e.id).length)
      .map((e) => e.id);

    // Near the queue: queued, or held only by open assumptions and decisions — no
    // feature to build first. An open assumption counts every such entry it holds,
    // directly or through another; one held by two is counted under both.
    // An A-n or D-n with no entry (B9) is nothing the owner can settle: it is a bad reference.
    // Only an open one: a moved or superseded blocker is re-pointed, not settled (B10).
    const settleable = (id) => meta.get(id)?.status === 'open' && (ASSUMPTIONS.idPattern.test(id) || DECISIONS.idPattern.test(id));
    const near = new Set(features
      .filter((e) => queued.includes(e.id) || (blockersOf(e.id).length && blockersOf(e.id).every(settleable)))
      .map((e) => e.id));
    const order = new Map(graph.entries.map((e, n) => [e.id, n]));
    const byOrder = (a, b) => order.get(a) - order.get(b);
    const assumptionsAhead = graph.entries
      .filter((e) => e.open && ASSUMPTIONS.idPattern.test(e.id))
      .map((e) => ({ id: e.id, title: e.title, holds: downstream(e.id).filter((i) => near.has(i)).sort(byOrder) }))
      .filter((a) => a.holds.length)
      .sort((a, b) => b.holds.length - a.holds.length || byOrder(a.id, b.id));

    return {
      bugFirst,
      nextUp: head ? {
        id: head, title: meta.get(head)?.title ?? '', waitsOn: blockersOf(head),
        noEntry: blockersOf(head).filter((id) => !meta.has(id)),
      } : null,
      claimedAhead, readyUnqueued, assumptions: assumptionsAhead, ...(warning && { warning }),
    };
  } catch (e) {
    return { failed: `could not read what is ahead: ${e.message}` };
  }
})();

const SHOWN = 3; // assumption lines, at most: the section must stay short
const aheadLines = (() => {
  if (ahead.failed) return [`Ahead: unreadable — ${ahead.failed}`];
  const out = [`Ahead (from the dependency graph on ${BASE}):`];
  if (ahead.warning) out.push(`  (${ahead.warning})`);
  const skip = ahead.claimedAhead.length ? ` (after claimed ${ahead.claimedAhead.join(', ')})` : '';
  // A ready bug is what comes next, so it takes the "next up" label and the queue head
  // follows it: a session skimming for "next up" must land on the bug.
  const bug = ahead.bugFirst;
  if (bug) out.push(`  next up: ${bug.id} — ${bug.title} (${bug.severity ?? 'unrated'} bug; every ready bug goes before the queue)`);
  const label = bug ? 'then the queue' : 'next up';
  // A blocker with no entry is a header to fix, not something to build first: say so.
  const named = (id) => (ahead.nextUp.noEntry.includes(id) ? `${id} (no entry)` : id);
  const held = ahead.nextUp?.waitsOn.length ? ` — waits on ${ahead.nextUp.waitsOn.map(named).join(', ')}` : '';
  out.push(ahead.nextUp
    ? `  ${label}: ${ahead.nextUp.id} — ${ahead.nextUp.title}${skip}${held}`
    : `  ${label}: nothing unclaimed in ${BACKLOG.queue}${skip}`);
  out.push(`  ready, not queued: ${ahead.readyUnqueued.join(', ') || 'none'}`);
  if (!ahead.assumptions.length) out.push('  open assumptions holding near-queue work: none');
  for (const a of ahead.assumptions.slice(0, SHOWN)) out.push(`  ${a.id} holds ${a.holds.join(', ')} — ${a.title}`);
  if (ahead.assumptions.length > SHOWN) out.push(`  … and ${ahead.assumptions.length - SHOWN} more open assumption(s) holding near-queue work`);
  return out;
})();
const aheadBlock = `\n${aheadLines.join('\n')}`;

// ── Report ───────────────────────────────────────────────────────────────────

if (asJson) {
  console.log(JSON.stringify({ base: BASE, findings, waitingOnUser, ahead }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

const RANK = { alert: 0, warn: 1, info: 2 };
const LABEL = { alert: 'ALERT', warn: 'CHECK', info: 'note ' };
findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

if (findings.length === 0) {
  console.log(`session-audit: clean (base ${BASE}) — statuses match reality, tree committed.${waitingBlock}${aheadBlock}`);
  process.exit(0);
}
console.log(`session-audit: ${findings.length} item(s) left dangling — resolve before starting new work (base ${BASE})\n`);
for (const f of findings) console.log(`  [${LABEL[f.severity]}] ${f.what}\n           → ${f.action}\n`);
if (waitingBlock) console.log(waitingBlock.trimStart());
console.log(aheadLines.join('\n'));
process.exit(1);
