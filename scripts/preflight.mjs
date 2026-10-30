// preflight — /implement's step-1 gates, run by code beside the session's own (P41 R0).
//
// Step 1 is prose today: find the entry, check nobody claimed it, check what it rests
// on, name the milestone, spot a spike, and check every claim the entry makes about the
// code. Each of those but the last is decidable from the trunk, so this decides them.
// R0 only reports. The session still runs every gate by hand, and its close report says
// whether this agreed (`preflight: agreed`), so the agreement can be counted from git
// before R1 makes this the gate.
//
// The gates read the trunk through trunkGraph, the one reader that refuses to drop an
// entry it can't parse (P36) and counts a dependency on a missing ID as a blocker (B9).
//
//   claim      fails when the entry is `in-progress` on the trunk. The other claims are
//              listed: whether their shared assets overlap this Scope is judgement.
//              With --resume (P52) the owner has handed the claim back, so it passes
//              when the entry has exactly one `feat/` branch and that branch does not
//              hold the land lock (it would be landing). The owner's word is trusted,
//              not checked: nothing here can tell whose claim it is.
//   depends    fails on anything still holding the entry, direct or through another
//              entry, named down to its root, by graphIndex's DEPENDS GATE.
//   status     fails on an entry whose status is closed: nothing is left to build.
//   milestone  the R# milestones Scope names. Report-only: /implement confirms one.
//   spike      the `resolves:` assumption, whose Resolution is part of done.
//
// The premise table is one row per path or code symbol in backticks in Scope and
// Accept. It reads this checkout, not the trunk: in step 1 that is the main checkout,
// and the table says when HEAD is not the trunk. A path is checked against the tracked
// files (a bare file name matches one anywhere); a symbol is searched with grep-checked,
// which grades its own zero, over every tracked top-level folder but docs/, where the
// entry itself would match. A row reads found, VERIFIED absent, or NOT evidence: a check
// that could not run is never read as absent. A "found" row never clears a premise.
// It says the name exists, not that the entry's claim about it still holds.
//
// Exit: 0 every gate passed | 1 a gate failed (it is named, with what blocks it)
//       | 2 could not run (not a repo, no trunk, no such ID, the graph failed)
//
// Usage: node scripts/preflight.mjs <P#|B#> [R#] [--resume] [--base <branch>] [--json]

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildableRegister, loadRegister, idsOf } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { trunkGraph, graphIndex } from './trunk-graph.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const resume = argv.includes('--resume');
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--base');
const [ID, MILESTONE = null] = pos;
const usage = 'usage: node scripts/preflight.mjs <P#|B#> [R#] [--resume] [--base <branch>] [--json]';

// Same git invocation as status and claims, for the reasons given in session-audit.
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
const stop = (msg) => { console.error(`preflight: ${msg}`); process.exit(2); };

const REG = ID ? buildableRegister(ID) : null;
if (!REG) stop(`"${ID ?? ''}" is not a buildable id (P# or B#).\n${usage}`);
if (MILESTONE !== null && !/^R\d+$/.test(MILESTONE)) stop(`"${MILESTONE}" is not a milestone (R#).\n${usage}`);
if (git('rev-parse', '--git-dir') === null) stop(`not a git repository, or git refused it.${lastError ? ` git: ${lastError.split('\n')[0]}` : ''}`);
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const { trunk: BASE, error: baseError } = trunkFromArgv(argv, branches);
if (baseError) stop(baseError);

// The entry's body is read from the same copied tree the graph was built from.
let entry = null;
const { graph, failed } = trunkGraph({
  root: ROOT, base: BASE, git,
  onTree: (dir) => { entry = loadRegister(dir, REG).entries.find((e) => e.id === ID) ?? null; },
});
if (failed) stop(failed);
const { meta, live, blockersOf } = graphIndex(graph);
const me = meta.get(ID);
if (!me || !entry) stop(`${ID} has no entry on ${BASE}: an untriaged idea goes to /triage first.`);

// ── The gates ────────────────────────────────────────────────────────────────

const name = (id) => {
  const m = meta.get(id);
  return m ? `${id} (${m.status})` : `${id} (no entry)`;
};
/** What a blocker comes down to: each one it waits on that is not itself held. */
const rootsOf = (id) => {
  const roots = new Set();
  const seen = new Set([id]);
  const walk = (i) => {
    for (const b of blockersOf(i)) {
      if (seen.has(b)) continue;
      seen.add(b);
      if (!live(b) || !blockersOf(b).length) roots.add(b);
      else walk(b);
    }
  };
  walk(id);
  return [...roots];
};

const gates = [];
const gate = (g, ok, say) => gates.push({ gate: g, ok, say });

const others = graph.entries
  .filter((e) => e.id !== ID && e.status === 'in-progress' && buildableRegister(e.id))
  .map((e) => e.id);
/** The branch a handed-back claim resumes on, or why it can't be resumed. */
function resumable() {
  // The same prefix worktree.mjs cuts and resumes: the `-` keeps P1 off P15's branch.
  const prefix = `feat/${ID.toLowerCase()}-`;
  const mine = branches.filter((b) => b.startsWith(prefix));
  if (!mine.length) return { why: `--resume, but ${ID} has no ${prefix}… branch: nothing to resume` };
  if (mine.length > 1) return { why: `--resume, but ${ID} has ${mine.length} branches (${mine.join(', ')}): which one is live is a judgement` };
  // land.mjs's lock file, in the git common dir every worktree shares.
  const common = git('rev-parse', '--git-common-dir');
  let lock = null;
  try { lock = JSON.parse(readFileSync(join(resolve(ROOT, common ?? '.git'), 'loop-land.lock'), 'utf8')); } catch { /* not held */ }
  if (lock?.owner === mine[0]) return { why: `--resume, but ${mine[0]} holds the land lock: that build is landing` };
  return { branch: mine[0] };
}
const resumed = me.status === 'in-progress' && resume ? resumable() : null;
gate('claim', me.status !== 'in-progress' || Boolean(resumed?.branch), me.status !== 'in-progress'
  ? `${ID} is not claimed${others.length ? `; claimed elsewhere: ${others.join(', ')} (check their shared assets against this Scope)` : ''}`
  : resumed?.branch ? `${ID} resumed on ${resumed.branch}: the owner handed the claim back (--resume)`
    : `${ID} is already in-progress on ${BASE}: another session or branch holds it${resumed ? `; ${resumed.why}` : ''}`);

const direct = blockersOf(ID);
const roots = rootsOf(ID).filter((r) => !direct.includes(r));
gate('depends', !direct.length, direct.length
  ? `waits on ${direct.map(name).join(', ')}${roots.length ? `, which rest on ${roots.map(name).join(', ')}` : ''}`
  : 'nothing it depends on is still open');

gate('status', me.open === true, me.open ? `${me.status}` : `${me.status}: closed, nothing is left to build`);

const scope = (entry.sections.get('Scope') ?? []).join('\n');
// "P12 R3" cites another entry's milestone; only a bare R# is this entry's.
const milestones = [...new Set(scope.match(/(?<![PB]\d+ )\bR\d+\b/g) ?? [])].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const milestoneSay = milestones.length
  ? `${milestones.join(', ')} in Scope — build one per invocation${MILESTONE ? `; this run: ${MILESTONE}${milestones.includes(MILESTONE) ? '' : ' (not named in Scope)'}` : '; confirm which'}`
  : `none in Scope${MILESTONE ? `; ${MILESTONE} was named but Scope has no milestones` : ''}`;
const resolves = idsOf(entry, 'resolves');
const spikeSay = resolves.length ? `resolves ${resolves.join(', ')} — writing its Resolution is part of done` : 'no';

// ── The premise table ────────────────────────────────────────────────────────

// The tracked files are the control for a path: a listing that came back is what makes
// an absence verified. git failing to list them makes every path NOT evidence.
const listed = git('ls-files');
const TRACKED = listed === null ? null : listed.split('\n').filter(Boolean);
const SEARCHED = [...new Set((TRACKED ?? []).filter((p) => p.includes('/')).map((p) => p.split('/')[0]))]
  .filter((d) => d !== 'docs' && existsSync(join(ROOT, d))).sort();
const esc = (s) => s.replace(/[-\\^$.*+?()[\]{}|/]/g, '\\$&');
const head = git('rev-parse', '--short', 'HEAD');

/** A path has a slash or a file extension, and nothing a template would hold. */
const EXT = /\.(mjs|cjs|js|ts|tsx|jsx|json|md|ya?ml|sh|py|html|css|txt|toml)$/i;
const isPath = (t) => !/[<>*#{}|()]/.test(t) && !t.startsWith('-') && !t.includes('..') && !t.startsWith('/')
  && (t.includes('/') ? /[\w-]+\/[\w./-]*[\w/]$/.test(t) : EXT.test(t));
/** A code symbol: camelCase, snake_case, `name()`, or a `--flag`. */
const isSymbol = (t) => /^--[a-z][\w-]*$/.test(t) || /^[A-Za-z_$][\w$]*\(\)$/.test(t)
  || /^[a-z]+[A-Z][\w$]*$/.test(t) || /^[a-z]+(_[a-z]+)+$/.test(t);

const checkPath = (p) => {
  if (TRACKED === null) return { verdict: 'NOT evidence', why: 'git could not list the tracked files' };
  const bare = !p.replace(/\/$/, '').includes('/');
  // Tracked and on disk: a tracked file deleted from this checkout is not here to build on.
  const hit = TRACKED.find((t) => (bare ? t.split('/').pop() === p : t === p || t.startsWith(p.endsWith('/') ? p : `${p}/`))
    && existsSync(join(ROOT, t))) ?? (existsSync(join(ROOT, p)) ? p : null);
  if (hit) return { verdict: 'found', ...(hit !== p && { why: hit }) };
  return { verdict: 'VERIFIED absent', why: `not among ${TRACKED.length} tracked files` };
};
const checkSymbol = (s) => {
  if (TRACKED === null) return { verdict: 'NOT evidence', why: 'git could not list the tracked files' };
  if (!SEARCHED.length) return { verdict: 'NOT evidence', why: 'no tracked folder to search outside docs/' };
  // A flag ends where a longer one would go on: `--new` is not `--new-flag`.
  const pattern = /^\w/.test(s) ? `\\b${esc(s.replace(/\(\)$/, ''))}\\b` : `${esc(s)}(?![\\w-])`;
  const r = spawnSync(process.execPath, [join(HERE, 'grep-checked.mjs'), '--quiet', '--control', '\\bimport\\b', pattern, ...SEARCHED], {
    cwd: ROOT, encoding: 'utf8',
  });
  if (r.status === 0) return { verdict: 'found' };
  if (r.status === 1) return { verdict: 'VERIFIED absent', why: `grep-checked over ${SEARCHED.join(', ')}` };
  return { verdict: 'NOT evidence', why: `grep-checked exit ${r.status ?? 'none'}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}` };
};

const text = ['Scope', 'Accept'].map((s) => (entry.sections.get(s) ?? []).join('\n')).join('\n');
const seen = new Set();
const premises = [];
for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
  // Every word of a span: a command names its script, a call names its function.
  for (const word of span.trim().split(/\s+/)) {
    const token = isPath(word) ? word : word.replace(/\((?!\)$).*$|[,;:]$/g, '');
    if (!token || seen.has(token)) continue;
    seen.add(token);
    if (isPath(token)) premises.push({ kind: 'path', name: token, ...checkPath(token) });
    else if (isSymbol(token)) premises.push({ kind: 'symbol', name: token, ...checkSymbol(token) });
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const failedGates = gates.filter((g) => !g.ok).map((g) => g.gate);
const commit = git('rev-parse', '--short', BASE);
const report = {
  id: ID, base: BASE, commit, head, milestone: MILESTONE, resumed: resumed?.branch ?? null,
  gates, milestones, resolves, premises,
  verdict: failedGates.length ? `blocked (${failedGates.join(', ')})` : 'ready',
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  const out = [`preflight ${ID}${MILESTONE ? ` ${MILESTONE}` : ''} on ${BASE} (${commit}):`];
  for (const g of gates) out.push(`  ${g.gate.padEnd(10)}${g.ok ? 'ok' : 'FAIL'} — ${g.say}`);
  out.push(`  ${'milestone'.padEnd(10)}${milestoneSay}`, `  ${'spike'.padEnd(10)}${spikeSay}`);
  const where = head === commit ? `this checkout, at ${BASE}` : `this checkout at ${head}, not ${BASE} (${commit}): run from the main checkout to read ${BASE}'s code`;
  out.push('', `premises (backticked paths and symbols in Scope and Accept, read from ${where}; "found" never clears a premise):`);
  if (!premises.length) out.push('  none named');
  for (const p of premises) out.push(`  ${p.verdict.padEnd(16)} ${p.name}${p.why ? `  (${p.why})` : ''}`);
  out.push('', `verdict: ${report.verdict}`);
  console.log(out.join('\n'));
}
process.exit(failedGates.length ? 1 : 0);
