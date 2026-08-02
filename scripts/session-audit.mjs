// session-audit — the decidable half of /checkpoint.
//
// /checkpoint's job is "may this session end?", and its checks split cleanly in two:
//
//   COMPUTING THE FINDING  — is any status dishonest, is anything dangling, did an
//                            assumption resolve without its dependents being swept.
//                            All decidable from git + the docs. That's this script.
//
//   DECIDING THE RESPONSE  — is that in-progress entry abandoned or just paused, is
//                            this untracked file worth committing, what goes in the
//                            baton. Judgement. That stays in the skill.
//
// Splitting them this way matters for a reason specific to this suite: every check
// below is a search whose *empty result* the session is about to promote to a durable
// HANDOFF line. A model running five greps and eyeballing them will occasionally
// mis-read one, and the failure is silent by construction (LESSONS L1). A script
// re-runs identically every time and cannot decide it already knows the answer.
//
// Exit: 0 nothing dangling | 1 findings to resolve | 2 could not audit (not a repo, &c.)
//
// Usage: node scripts/session-audit.mjs [--base <branch>] [--json]

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
// indexOf returns -1 when absent, and argv[-1 + 1] is argv[0] — which silently made
// the next flag the branch name. Guard the lookup rather than the arithmetic.
const baseIdx = argv.indexOf('--base');
const baseArg = baseIdx >= 0 ? argv[baseIdx + 1] : null;

const BACKLOG = 'docs/product/BACKLOG.md';
const DECISIONS = 'docs/OPEN_DECISIONS.md';
const HANDOFF = '.claude/HANDOFF.md';

const findings = [];
const add = (severity, what, action) => findings.push({ severity, what, action });

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
};

if (git('rev-parse --git-dir') === null) {
  console.error('session-audit: not a git repository — nothing to audit.');
  process.exit(2);
}

// The integration branch. Guessing wrong would make every merge-state check lie, so
// this resolves against branches that actually exist rather than assuming `main`.
const branches = (git(`for-each-ref --format='%(refname:short)' refs/heads`) || '').split('\n').filter(Boolean);
const BASE = baseArg || ['main', 'master', 'trunk'].find((b) => branches.includes(b)) || null;
if (!BASE) {
  console.error(
    `session-audit: no integration branch found (looked for main/master/trunk among: ${branches.join(', ') || 'none'}).\n` +
      `Pass --base <branch>.`,
  );
  process.exit(2);
}

// ── Shallow doc read ─────────────────────────────────────────────────────────
// Deliberately minimal: ID, status, and two fields. This is NOT the schema
// authority — backlog-schema-check.mjs is, and it fails loudly if the format moves.
// Keeping this parser dumb means a format change breaks the checker (loud) rather
// than quietly changing what the audit reports (silent).

function entries(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return [];
  const out = [];
  let cur = null;
  let inFence = false;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { if (cur) cur.body.push(line); continue; }
    const h = line.match(/^###\s+(\S+)\s+/);
    if (h) { if (cur) out.push(cur); cur = { id: h[1], title: line, body: [] }; }
    else if (cur) cur.body.push(line);
  }
  if (cur) out.push(cur);
  for (const e of out) {
    e.status = e.body.find((l) => /\*\*Status:\*\*/.test(l))?.match(/\*\*Status:\*\*\s*`?([a-z-]+)`?/i)?.[1]?.toLowerCase() ?? null;
    e.field = (label) => {
      const i = e.body.findIndex((l) => new RegExp(`\\*\\*${label}:\\*\\*`).test(l));
      if (i < 0) return '';
      let s = e.body[i];
      for (let j = i + 1; j < e.body.length && /^\s+\S/.test(e.body[j]); j++) s += ' ' + e.body[j];
      return s;
    };
  }
  return out;
}

const backlog = entries(BACKLOG);
const decisions = entries(DECISIONS);
const odById = new Map(decisions.map((d) => [d.id, d]));
const today = new Date().toISOString().slice(0, 10);

// ── 1. Working tree ──────────────────────────────────────────────────────────

const status = git('status --porcelain') || '';
const dirty = status.split('\n').filter(Boolean);
if (dirty.length) {
  const untrackedCode = dirty
    .filter((l) => l.startsWith('??') && /\s(src|scripts|tests?)\//.test(l))
    .map((l) => l.slice(3));
  add('info', `${dirty.length} uncommitted change(s) in the working tree.`,
    'Group them into checkpoint commits — one per completed unit, code and docs separate.');
  if (untrackedCode.length) {
    add('warn', `Untracked file(s) under code directories: ${untrackedCode.join(', ')}.`,
      'These are usually a half-finished unit or a scratch file that escaped the scratchpad. Commit with their feature, or delete.');
  }
}

// ── 2. Spikes and the assumptions they owe ───────────────────────────────────
// The schema check fails a *shipped* spike whose OD is still open. That leaves the
// in-flight case, which is where the answer exists only in the session's head — and
// this is the last moment anyone will ask.

for (const e of backlog) {
  const odIds = [...e.field('Resolves').matchAll(/\bOD-\d+\b/g)].map((m) => m[0]);
  for (const odId of odIds) {
    const od = odById.get(odId);
    if (!od) continue; // schema check owns dangling refs
    if (od.status !== 'open') continue;
    if (e.status === 'in-progress' || e.status === 'partial') {
      add('warn', `Spike ${e.id} is \`${e.status}\` and ${odId} is still \`open\`.`,
        `If this session established the answer, write it into ${odId}'s **Resolution:** via /ship before ending — an answer that exists only in the transcript is lost. If not, say so in HANDOFF.`);
    }
  }
}

// ── 3. Claims that no longer match reality ───────────────────────────────────
// An `in-progress` entry means "a branch is building this right now". If no unmerged
// branch mentions it, that claim is either finished (needs its /ship flip) or
// abandoned (needs clearing) — and both look identical from the doc alone.

const unmerged = (git(`branch --no-merged ${BASE} --format='%(refname:short)'`) || '')
  .split('\n').filter(Boolean);
const merged = (git(`branch --merged ${BASE} --format='%(refname:short)'`) || '')
  .split('\n').filter(Boolean).filter((b) => b !== BASE);

for (const e of backlog.filter((x) => x.status === 'in-progress')) {
  const num = e.id.toLowerCase();
  const onUnmerged = unmerged.some((b) => b.toLowerCase().includes(num));
  const onMerged = merged.some((b) => b.toLowerCase().includes(num));
  if (onUnmerged) continue; // legitimately in flight
  if (onMerged) {
    add('warn', `${e.id} is \`in-progress\` but its branch is already merged into ${BASE}.`,
      `The terminal flip was missed — run /ship on ${BASE}.`);
  } else {
    add('warn', `${e.id} is \`in-progress\` but no branch names it.`,
      'Either the work merged without its flip, or this is an abandoned claim blocking another session from picking the entry up. Resolve it — a stale claim is worse than no claim.');
  }
}

// ── 4. Resolutions nobody swept ──────────────────────────────────────────────
// A resolved OD changes the state of every entry that named it, and nothing else in
// the loop notices. `refuted` is the case worth stopping over: those dependents may
// be void rather than unblocked.

for (const od of decisions) {
  if (od.status === 'open') continue;
  const res = od.field('Resolution');
  const resolvedToday = res.includes(today);
  const changedThisSession = (git(`diff ${BASE} --name-only`) || '').includes(DECISIONS);
  if (!resolvedToday && !changedThisSession) continue;
  const dependents = backlog.filter((e) => new RegExp(`\\b${od.id}\\b`).test(e.field('Depends on')));
  if (dependents.length === 0) continue;
  const ids = dependents.map((d) => `${d.id} (${d.status})`).join(', ');
  add(od.status === 'refuted' ? 'alert' : 'info',
    `${od.id} is \`${od.status}\`${resolvedToday ? ' (resolved today)' : ''} and ${dependents.length} entr(y/ies) depend on it: ${ids}.`,
    od.status === 'refuted'
      ? 'A refutation can VOID dependents rather than unblock them — re-read each against the new truth, and check whether anything already shipped on the false assumption. Deep pass: /triage groom.'
      : 'These are now unblocked and nothing else will notice. Consider promoting one into `## Next up` via /ship.');
}

// ── 5. Branches without a baton ──────────────────────────────────────────────

const handoffText = existsSync(join(ROOT, HANDOFF)) ? readFileSync(join(ROOT, HANDOFF), 'utf8') : '';
for (const b of unmerged) {
  if (!handoffText.includes(b)) {
    add('warn', `Branch \`${b}\` is unmerged and has no ${HANDOFF} section.`,
      'An unmerged branch nobody described is an unknown to the next session. Write its section, or say it is dead.');
  }
}
if (!handoffText && unmerged.length) {
  add('info', `${HANDOFF} does not exist yet.`, 'Create it — it is the next session\'s entry point.');
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
  console.log(`session-audit: clean (base ${BASE}) — statuses match reality, tree committed, no orphan branches.`);
  process.exit(0);
}
console.log(`session-audit: ${findings.length} item(s) to resolve before this session ends (base ${BASE})\n`);
for (const f of findings) console.log(`  [${LABEL[f.severity]}] ${f.what}\n           → ${f.action}\n`);
process.exit(1);
