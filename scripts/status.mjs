// status — where the project stands, addressed to the product owner (P7).
//
// The audit and the history speak to the next session: what was left dangling, which
// commit did what. This answers the owner's question instead — what is waiting on me,
// what is being built and since when, what can start, and what is stuck on what — so
// they never have to open a markdown file to find out.
//
// It composes; it keeps nothing. Everything is derived on each run from three sources:
//
//   - P11's graph JSON (`backlog-schema-check.mjs --graph --json`), the one contract for
//     what blocks what. Read from the integration branch, not the checked-out copy, for
//     the claim gate's reason: a worktree's registers are as old as its branch. So the
//     registers are copied out of git into a temporary directory and the graph runs
//     there.
//   - git, for what the registers cannot say: each claim's branch and worktree, when it
//     was claimed, and whether its branch has already landed (an `in-progress` entry
//     whose merge is on main is awaiting the owner's acceptance — /land never flips
//     `shipped`).
//   - the session audit, for loose ends in this checkout.
//
// Out: storage of any kind. Running it leaves every tracked file unchanged; the HTML
// page goes to an ignored path and is stamped with the commit it was built from, so a
// stale page says how stale it is.
//
// Exit: 0 report printed | 2 could not run (not a repo, no integration branch, graph failed)
//
// Usage: node scripts/status.mjs [--base <branch>] [--json] [--html [<file>]]
//        --html with no file writes .claude/status.html (gitignored)

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BACKLOG, BUGS, parseQueue, loadRegister } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { landings } from './landing.mjs';
import { trunkGraph, graphIndex, catBlobs } from './trunk-graph.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const asJson = argv.includes('--json');
const htmlOut = argv.includes('--html') ? resolve(ROOT, flag('--html') ?? '.claude/status.html') : null;

// Same git invocation as session-audit, for the reasons given there.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
let lastError = '';
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
    }).trim();
  } catch (e) {
    lastError = String(e.stderr ?? e.message ?? '').trim();
    return null;
  }
};
const lines = (s) => (s || '').split('\n').filter(Boolean);
const stop = (msg) => { console.error(`status: ${msg}`); process.exit(2); };

if (git('rev-parse', '--git-dir') === null) stop(`not a git repository, or git refused it.${lastError ? ` git: ${lastError.split('\n')[0]}` : ''}`);
const branches = lines(git('for-each-ref', '--format=%(refname:short)', 'refs/heads'));
const { trunk: BASE, error: baseError } = trunkFromArgv(argv, branches);
if (baseError) stop(baseError);

const [baseSha, baseDate] = git('log', '-1', '--format=%H %cI', BASE).split(' ');
const now = new Date();

// ── The graph, as it is on the integration branch ────────────────────────────

// trunk-graph.mjs copies the registers out of git and runs P11's graph there.
const blobs = (specs) => catBlobs(ROOT, specs);
// The graph carries no severity, and bugs are ranked by it (next.mjs's order).
const headers = new Map();
const { graph, failed } = trunkGraph({
  root: ROOT, base: BASE, git,
  onTree: (dir) => { for (const e of loadRegister(dir, BUGS).entries) if (e.id) headers.set(e.id, e.header); },
});
if (failed) stop(failed);

// What still holds an entry back is /implement's DEPENDS GATE — see graphIndex.
const { meta, live, blockersOf, downstream } = graphIndex(graph);
const proseOf = (id) => graph.prose.filter((p) => p.id === id).map((p) => p.text);
const isBuildable = (e) => BACKLOG.idPattern.test(e.id) || BUGS.idPattern.test(e.id);

/**
 * What a blocked entry comes down to: each blocker it transitively waits on that is not
 * itself blocked, plus any that waits on the owner even though it is — that one is
 * theirs to settle whatever else it waits on.
 */
const rootsOf = (id) => {
  const roots = new Set();
  const seen = new Set([id]);
  const walk = (i) => {
    for (const b of blockersOf(i)) {
      if (seen.has(b)) continue;
      seen.add(b);
      // A closed blocker (an abandoned feature) is a root: what it once waited on is moot.
      if (!live(b) || !blockersOf(b).length || proseOf(b).includes('user')) roots.add(b);
      if (live(b)) walk(b);
    }
  };
  walk(id);
  return [...roots];
};

// ── Git: claims, branches, worktrees, landings ───────────────────────────────

const { branchOf, claimedAt, landedAt } = landings(git, BASE, { branches, blobs });
const worktrees = new Map();
let wt = null;
for (const l of lines(git('worktree', 'list', '--porcelain'))) {
  if (l.startsWith('worktree ')) wt = l.slice(9);
  const m = l.match(/^branch refs\/heads\/(.+)$/);
  if (m) worktrees.set(m[1], wt);
}
const firstParent = new Set(lines(git('rev-list', '--first-parent', BASE)));

const days = (iso) => {
  const n = Math.floor((now - new Date(iso)) / 86400_000);
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
};
const short = (iso) => (iso ? iso.slice(0, 10) : null);
const rel = (p) => (p ? relative(ROOT, p) || '.' : null);

// ── The report ───────────────────────────────────────────────────────────────

const report = {
  base: BASE, commit: baseSha, committed: baseDate, generated: now.toISOString(),
  waitingOnYou: [], inFlight: [], ready: [], blocked: [], looseEnds: [],
};
const open = graph.entries.filter((e) => e.open);

for (const e of open.filter((x) => isBuildable(x) && x.status === 'in-progress')) {
  const claim = claimedAt(e.id);
  const since = claim?.at ?? null;
  const branch = branchOf(e.id, claim);
  const landed = landedAt(e.id, claim);
  const branchTip = branch ? git('rev-parse', branch) : null;
  if (landed) {
    report.waitingOnYou.push({
      kind: 'acceptance', id: e.id, title: e.title, since: landed,
      why: `landed ${short(landed)} (${days(landed)}); awaiting your acceptance against its Accept criteria`,
      see: `npm run history ${e.id}`,
    });
  } else {
    const last = branch && !firstParent.has(branchTip) ? git('log', '-1', '--format=%cI', branch) : null;
    report.inFlight.push({
      id: e.id, title: e.title, branch, worktree: rel(worktrees.get(branch) ?? null),
      since, lastCommit: last,
    });
  }
}

for (const e of open.filter((x) => proseOf(x.id).includes('user'))) {
  const holds = downstream(e.id);
  report.waitingOnYou.push({
    kind: 'decision', id: e.id, title: e.title, holds,
    why: `a choice only you can make${holds.length ? `; holds back ${holds.join(', ')}` : ''}`,
    see: `docs/decisions/${e.id}.md`,
  });
}

let queued = [];
const queueText = git('show', `${BASE}:${BACKLOG.queue}`);
if (queueText !== null) queued = parseQueue(queueText).ids;
const ready = open.filter((e) => isBuildable(e) && e.status !== 'in-progress' && !blockersOf(e.id).length && !proseOf(e.id).length);
// next.mjs's order: every bug before the queue, most severe first, then the oldest
// report, then the lowest number; then the queue; then the rest, most-unblocking first.
const isBug = (e) => BUGS.idPattern.test(e.id);
const sev = (e) => { const i = BUGS.severity.indexOf(headers.get(e.id)?.severity); return i < 0 ? BUGS.severity.length : i; };
const rank = (e) => (isBug(e) ? -1 : queued.includes(e.id) ? queued.indexOf(e.id) : queued.length);
const order = (a, b) => rank(a) - rank(b)
  || (isBug(a) && isBug(b)
    ? sev(a) - sev(b) || String(headers.get(a.id)?.reported ?? '').localeCompare(String(headers.get(b.id)?.reported ?? '')) || Number(a.id.slice(1)) - Number(b.id.slice(1))
    : downstream(b.id).length - downstream(a.id).length);
for (const e of ready.sort(order)) {
  const pos = queued.indexOf(e.id);
  report.ready.push({
    id: e.id, title: e.title, status: e.status, unblocks: downstream(e.id),
    queued: pos >= 0 ? pos + 1 : null, bug: isBug(e), severity: headers.get(e.id)?.severity ?? null,
  });
}

const describe = (id) => {
  const m = meta.get(id);
  const prose = proseOf(id);
  return { id, title: m.title, register: m.register, status: m.status, waitingOnYou: prose.includes('user') };
};
for (const e of open.filter((x) => isBuildable(x) && x.status !== 'in-progress' && blockersOf(x.id).length)) {
  report.blocked.push({
    id: e.id, title: e.title, status: e.status,
    waitsOn: blockersOf(e.id).map(describe),
    roots: rootsOf(e.id).map(describe),
  });
}

const audit = spawnSync(process.execPath, [join(HERE, 'session-audit.mjs'), '--json', '--base', BASE], {
  cwd: ROOT, encoding: 'utf8', env: process.env,
});
try { report.looseEnds = JSON.parse(audit.stdout).findings; } catch { report.looseEnds = [{ severity: 'warn', what: 'the session audit did not run', action: (audit.stderr || '').trim().split('\n')[0] }]; }

// ── Render ───────────────────────────────────────────────────────────────────

const KIND = { product: 'feature', bugs: 'bug', assumptions: 'assumption', decisions: 'decision', experiments: 'experiment' };
const why = (b) => `${b.id} (${KIND[b.register] ?? b.register}, ${b.status}${b.waitingOnYou ? ', waiting on you' : ''}): ${b.title}`;
const readyTags = (x) => [
  x.bug ? `${x.severity ?? 'unrated'} bug — picked up before the queue` : x.queued ? `queued #${x.queued}` : 'not queued',
  x.status !== 'proposed' && x.status !== 'open' ? x.status : null,
  x.unblocks.length ? `unblocks ${x.unblocks.join(', ')}` : null,
].filter(Boolean);

function text(r) {
  const out = [`status — ${r.base} @ ${r.commit.slice(0, 7)} (${short(r.committed)}), generated ${r.generated.slice(0, 16).replace('T', ' ')}Z`];
  const head = (title, n) => out.push('', `${title} (${n})${n ? '' : ': none'}`);
  head('Waiting on you', r.waitingOnYou.length);
  for (const w of r.waitingOnYou) out.push(`  ${w.id}  ${w.title}`, `        ${w.why} — ${w.see}`);
  head('In flight', r.inFlight.length);
  for (const f of r.inFlight) {
    out.push(`  ${f.id}  ${f.title}`,
      `        claimed ${f.since ? `${short(f.since)} (${days(f.since)})` : 'at an unknown time'}; ` +
        `branch ${f.branch ?? 'none'}; worktree ${f.worktree ?? 'none'}` +
        (f.lastCommit ? `; last commit ${days(f.lastCommit)}` : f.branch ? '; no commits yet' : ''));
  }
  head('Ready to start', r.ready.length);
  for (const x of r.ready) out.push(`  ${x.id}  ${x.title}  [${readyTags(x).join('; ')}]`);
  head('Blocked', r.blocked.length);
  for (const b of r.blocked) {
    out.push(`  ${b.id}  ${b.title}`);
    for (const w of b.waitsOn) out.push(`        waits on ${why(w)}`);
    const deeper = b.roots.filter((x) => !b.waitsOn.some((w) => w.id === x.id));
    for (const x of deeper) out.push(`        which rests on ${why(x)}`);
  }
  head('Loose ends in this checkout', r.looseEnds.length);
  for (const f of r.looseEnds) out.push(`  [${f.severity}] ${f.what}`);
  return out.join('\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function html(r) {
  const card = (id, title, body, cls = '') =>
    `<li class="card ${cls}"><div class="id">${esc(id)}</div><div><div class="title">${esc(title)}</div>${body}</div></li>`;
  const sub = (s) => `<div class="meta">${s}</div>`;
  const section = (title, items, empty) =>
    `<section><h2>${esc(title)} <span class="n">${items.length}</span></h2>` +
    (items.length ? `<ul>${items.join('')}</ul>` : `<p class="empty">${esc(empty)}</p>`) + '</section>';
  const chip = (b) => `<span class="chip ${esc(b.register)}">${esc(b.id)}</span> ${esc(KIND[b.register] ?? b.register)}, ${esc(b.status)}${b.waitingOnYou ? ' — <strong>waiting on you</strong>' : ''}: ${esc(b.title)}`;

  const waiting = r.waitingOnYou.map((w) => card(w.id, w.title, sub(`${esc(w.why)}<br><code>${esc(w.see)}</code>`), 'you'));
  const flight = r.inFlight.map((f) => card(f.id, f.title, sub(
    `claimed ${f.since ? `${esc(short(f.since))} (${esc(days(f.since))})` : 'at an unknown time'}` +
      (f.lastCommit ? `, last commit ${esc(days(f.lastCommit))}` : f.branch ? ', no commits yet' : '') +
      `<br>branch <code>${esc(f.branch ?? 'none')}</code><br>worktree <code>${esc(f.worktree ?? 'none')}</code>`)));
  const readyItems = r.ready.map((x) => card(x.id, x.title, sub(esc(readyTags(x).join(' · ')))));
  const blockedItems = r.blocked.map((b) => {
    const deeper = b.roots.filter((x) => !b.waitsOn.some((w) => w.id === x.id));
    return card(b.id, b.title,
      `<ul class="why">${b.waitsOn.map((w) => `<li>waits on ${chip(w)}</li>`).join('')}` +
        `${deeper.map((x) => `<li>which rests on ${chip(x)}</li>`).join('')}</ul>`, 'blocked');
  });
  const loose = r.looseEnds.map((f) => `<li class="card"><div class="id">${esc(f.severity)}</div><div>${esc(f.what)}</div></li>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project status</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--you:#b45309;--block:#b91c1c;--chip:#f5f5f4}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c;--you:#f59e0b;--block:#f87171;--chip:#44403c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}
.stamp{color:var(--muted);font-size:13px;margin:0 0 24px}h2{font-size:16px;margin:28px 0 8px}
.n{color:var(--muted);font-weight:400}ul{list-style:none;margin:0;padding:0}
.card{display:flex;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:0 0 8px}
.card.you{border-left:4px solid var(--you)}.card.blocked{border-left:4px solid var(--block)}
.id{font-weight:600;min-width:48px;font-variant-numeric:tabular-nums}.title{font-weight:500}
.meta,.why{color:var(--muted);font-size:13px}.why li{margin:2px 0}.empty{color:var(--muted)}
code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}.chip{background:var(--chip);border-radius:4px;padding:0 5px;font-weight:600;color:var(--fg)}
</style></head><body><main>
<h1>Project status</h1>
<p class="stamp">Built from <code>${esc(r.base)}</code> @ <code>${esc(r.commit.slice(0, 7))}</code> (committed ${esc(short(r.committed))}), generated ${esc(r.generated.slice(0, 16).replace('T', ' '))} UTC. Generated by <code>npm run status</code>; never edit by hand.</p>
${section('Waiting on you', waiting, 'Nothing is waiting on you.')}
${section('In flight', flight, 'Nothing is being built right now.')}
${section('Ready to start', readyItems, 'Nothing is ready to start.')}
${section('Blocked', blockedItems, 'Nothing is blocked.')}
${section('Loose ends in this checkout', loose, 'None — statuses match reality.')}
</main></body></html>
`;
}

if (asJson) console.log(JSON.stringify(report, null, 2));
else console.log(text(report));
if (htmlOut) {
  mkdirSync(dirname(htmlOut), { recursive: true });
  writeFileSync(htmlOut, html(report));
  console.error(`status: wrote ${pathToFileURL(htmlOut).href}`);
}
process.exit(0);
