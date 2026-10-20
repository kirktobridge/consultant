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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REGISTERS, BACKLOG, BUGS, parseEntry, parseQueue, loadRegister, dependencyMet } from './entries.mjs';

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
const BASE = flag('--base') || ['main', 'master', 'trunk'].find((b) => branches.includes(b)) || null;
if (!BASE || !branches.includes(BASE)) stop(`no integration branch found (looked for ${flag('--base') || 'main/master/trunk'} among: ${branches.join(', ') || 'none'}). Pass --base <branch>.`);

const [baseSha, baseDate] = git('log', '-1', '--format=%H %cI', BASE).split(' ');
const now = new Date();

// ── The graph, as it is on the integration branch ────────────────────────────

/**
 * Many blobs in one git call: each spec (`<rev>:<path>`) comes back as its text, or null
 * when it does not exist. One process however large the registers or a history grows.
 */
const blobs = (specs) => {
  if (!specs.length) return [];
  let buf;
  try {
    buf = execFileSync('git', ['-c', 'safe.directory=*', ...WIN, 'cat-file', '--batch'], {
      cwd: ROOT, input: specs.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 << 20,
    });
  } catch { return specs.map(() => null); }
  const out = [];
  let at = 0;
  for (let n = 0; n < specs.length; n++) {
    const nl = buf.indexOf(10, at);
    const head = buf.subarray(at, nl).toString('utf8');
    const m = head.match(/ blob (\d+)$/);
    if (!m) { out.push(null); at = nl + 1; continue; }
    const size = Number(m[1]);
    out.push(buf.subarray(nl + 1, nl + 1 + size).toString('utf8'));
    at = nl + 1 + size + 1;
  }
  return out;
};

const tmp = mkdtempSync(join(tmpdir(), 'status-'));
let graph = null;
let failed = null;
const headers = new Map();
try {
  const files = lines(git('ls-tree', '-r', '--name-only', BASE, '--', ...REGISTERS.map((r) => r.dir)));
  blobs(files.map((f) => `${BASE}:${f}`)).forEach((text, n) => {
    mkdirSync(dirname(join(tmp, files[n])), { recursive: true });
    writeFileSync(join(tmp, files[n]), text ?? '');
  });
  // The graph carries no severity, and bugs are ranked by it (next.mjs's order).
  for (const e of loadRegister(tmp, BUGS).entries) if (e.id) headers.set(e.id, e.header);
  const r = spawnSync(process.execPath, [join(HERE, 'backlog-schema-check.mjs'), '--graph', '--json'], {
    cwd: tmp, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
  });
  try { graph = JSON.parse(r.stdout); } catch { failed = `the graph did not run on ${BASE}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`; }
  if (graph && graph.version !== 1) failed = `graph version ${graph.version} is not one this report reads (1)`;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (failed) stop(failed);

const meta = new Map(graph.entries.map((e) => [e.id, e]));
const live = (id) => meta.get(id)?.open === true;
// What still holds an entry back is /implement's DEPENDS GATE (dependencyMet), not the
// graph's `open` flag: an abandoned `P#` is closed, and it never ships, so whatever rests
// on it stays blocked. `field` is a label, never matched on: each repo names its own headers.
const holds = (from) => !dependencyMet(from, meta.get(from)?.status ?? null);
const blockersOf = (id) => [...new Set(graph.edges.filter((x) => x.to === id && holds(x.from)).map((x) => x.from))];
const unblocksOf = (id) => [...new Set(graph.edges.filter((x) => x.from === id && live(x.to)).map((x) => x.to))];
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
const downstream = (id) => {
  const seen = new Set();
  const todo = unblocksOf(id);
  while (todo.length) { const j = todo.pop(); if (!seen.has(j) && j !== id) { seen.add(j); todo.push(...unblocksOf(j)); } }
  return [...seen];
};

// ── Git: claims, branches, worktrees, landings ───────────────────────────────

const fileOf = (id) => `${(BACKLOG.idPattern.test(id) ? BACKLOG : BUGS).dir}/${id}.md`;
// When the current claim began: the oldest commit of the unbroken run, newest first, in
// which the entry's status is `in-progress`. An earlier milestone's claim is a different
// run. First-parent only: a merged branch's own commits carry its older copy of the entry.
const claimedAt = (id) => {
  const file = fileOf(id);
  const log = lines(git('log', '--first-parent', '--format=%H %cI', BASE, '--', file)).map((l) => l.split(' '));
  const texts = blobs(log.map(([sha]) => `${sha}:${file}`));
  let at = null;
  for (let n = 0; n < log.length; n++) {
    if (parseEntry(texts[n] ?? '', { status: 'word' }).header.status !== 'in-progress') break;
    at = log[n][1];
  }
  return at;
};

// An entry's branch is worktree.mjs's `feat/<id>-<slug>`; `adhoc/…` work has no entry.
const names = (id) => new RegExp(`^feat/${id}-`, 'i');
const worktrees = new Map();
let wt = null;
for (const l of lines(git('worktree', 'list', '--porcelain'))) {
  if (l.startsWith('worktree ')) wt = l.slice(9);
  const m = l.match(/^branch refs\/heads\/(.+)$/);
  if (m) worktrees.set(m[1], wt);
}
// Landings are merges on main's first-parent line; the branch may be deleted by then, so
// the merge commit's subject (`Merge branch 'feat/p7-…'`) is what names it.
const landings = lines(git('log', '--first-parent', '--merges', '--format=%cI%x09%s', BASE)).map((l) => l.split('\t'));
const mergedBranch = (subject) => (subject.match(/^Merge branch '([^']+)'/i) || subject.match(/^merge (\S+)/i) || [])[1] ?? '';
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
  const since = claimedAt(e.id);
  const branch = branches.find((b) => b !== BASE && names(e.id).test(b)) ?? null;
  const landed = landings.find(([date, s]) => names(e.id).test(mergedBranch(s)) && (!since || new Date(date) >= new Date(since)));
  const branchTip = branch ? git('rev-parse', branch) : null;
  if (landed && (!branch || git('merge-base', '--is-ancestor', branch, BASE) !== null)) {
    report.waitingOnYou.push({
      kind: 'acceptance', id: e.id, title: e.title, since: landed[0],
      why: `landed ${short(landed[0])} (${days(landed[0])}); awaiting your acceptance against its Accept criteria`,
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

const KIND = { product: 'feature', bugs: 'bug', assumptions: 'assumption', decisions: 'decision' };
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
