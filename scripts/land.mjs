// land — the git half of landing a branch, so no session improvises it (P15 R2).
//
// A landing used to be prose: /land merged, and on a conflict it stopped and showed
// you. With sessions running in parallel, conflicts are the normal case (A-8 found the
// hub files collide about half the time), so the loop resolves them itself, and every
// step that code can decide is decided here:
//
//   lock take|release|status <owner>   one repo-wide lock for claims and landings, a
//                                      file in the git common dir every worktree sees
//   rebase                             in the branch's worktree, under the lock: onto
//                                      local main; on a conflict, record each region
//   continue                           check the session's resolution, then go on
//   merge <branch> [--suite <cmd>]     in the main checkout: --no-ff merge, suite, and
//         [--adhoc <what>]             main put back if the suite is red. An `adhoc/`
//         [--relates <ID,…>]           branch (P33) must say what it is: the merge
//                                      carries `Ad-hoc:` and `Relates:` trailers
//   finish <branch>                    remove worktree, branch, record and lock, after
//                                      moving the worktree's eval runs to this checkout
//   report <branch> [--json]           the conflicts resolved, for /land's report
//
// An ad-hoc branch has no entry, so nothing in the registers records that it happened.
// The `Ad-hoc:` trailer is that record, which is why the merge refuses to run without
// it; a `Relates:` ID that names nothing would be a record pointing nowhere.
//
// The resolution itself is judgement, so it stays with the session. What the script
// holds it to is the took-one-side check: a conflicted region resolved to exactly one
// side's text kept one session's work and dropped the other's. That stops for the
// user (exit 4). A blend passes; the suite and the report cover it.
//
// A one-sided region can be right (both entries made the same fix; one supersedes the
// other), so the stop is a yes/no question, not a pile of conflict regions (D-4, P39):
//   continue --why <file>          the session's case, one `## <file> region <n>` section
//                                  per one-sided region, each with `Why:` and `Suggest:`.
//                                  Without a case for each, continue refuses (exit 1) and
//                                  names the regions; with one, it stops (exit 4) showing
//                                  each region's sides, the side kept, why and the
//                                  suggestion, and keeps the case in the landing record.
//   continue --owner "<words>"     the user said yes to everything that stop showed. It
//                                  goes on only if the resolution is still exactly what
//                                  they saw; their words and the case go in the report.
// A no needs nothing new: the session resolves the region again and runs continue.
//
// Where each step runs is enforced: rebase/continue in a linked worktree (the session
// is isolated there, A-11), merge/finish in the main checkout (after ExitWorktree).
// Nothing here reaches into a checkout it isn't running in.
//
// Exit: 0 done | 1 refused or failed (message says why) | 2 could not run |
//       3 conflicts for the session to resolve | 4 stop for the user

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, rmSync, readdirSync, renameSync, cpSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { buildableRegister, registerOf } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { gitIn } from './git.mjs';
import { landingRecordPath, readLandingRecord } from './landing.mjs';

const STALE_MINUTES = 30;

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] ?? null : null;
  return v?.startsWith('--') ? null : v; // `--adhoc --suite x` has no value, not "--suite"
};
const asJson = argv.includes('--json');
const pos = argv.filter((a, i) => !a.startsWith('--') && !['--wait', '--suite', '--base', '--adhoc', '--relates', '--why', '--owner'].includes(argv[i - 1]));

const die = (code, msg) => { (code === 0 ? console.log : console.error)(`land: ${msg}`); process.exit(code); };

const git = gitIn();
const ok = (...args) => git(...args) !== null;

const top = git('rev-parse', '--show-toplevel');
if (top === null) die(2, `not a git repository, or git refused it.${git.error() ? ` git: ${git.firstError()}` : ''}`);
const gitDir = resolve(top, git('rev-parse', '--git-dir'));
const common = resolve(top, git('rev-parse', '--git-common-dir'));
const inLinkedWorktree = gitDir !== common;

const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const { trunk: BASE, error: baseError } = trunkFromArgv(argv, branches);
if (baseError) die(2, baseError);

const LOCK = join(common, 'loop-land.lock');
const RECORDS = join(common, 'loop-land');
const recordPath = (branch) => landingRecordPath(common, branch);
const readRecord = (branch) => readLandingRecord(common, branch);
const writeRecord = (rec) => { mkdirSync(RECORDS, { recursive: true }); writeFileSync(recordPath(rec.branch), JSON.stringify(rec, null, 2)); };

const worktreeOf = (branch) => {
  let path = null;
  for (const line of (git('worktree', 'list', '--porcelain') || '').split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice(9);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
};
const currentBranch = () => git('symbolic-ref', '--quiet', '--short', 'HEAD')
  // Mid-rebase HEAD is detached; the branch being rebased is recorded here.
  ?? (existsSync(join(gitDir, 'rebase-merge', 'head-name'))
    ? readFileSync(join(gitDir, 'rebase-merge', 'head-name'), 'utf8').trim().replace(/^refs\/heads\//, '')
    : null);

// ── The lock ─────────────────────────────────────────────────────────────────

const readLock = () => { try { return JSON.parse(readFileSync(LOCK, 'utf8')); } catch { return null; } };

/**
 * live | stale | ambiguous. A pid would be useless: every step here is a process that
 * exits at once, so the owner is judged by what it owns instead.
 *   - a branch owner that is gone, or merged with its worktree already removed, has
 *     finished or been abandoned → stale. (Merged but worktree still present is a
 *     landing between `merge` and `finish`: /ship is writing its flips. Live.)
 *   - anything older than STALE_MINUTES otherwise could be a crashed landing or a slow
 *     one, and only a person can tell → ambiguous.
 */
function judge(l) {
  // A `claim:` or `ship:` owner is a write on main, not a branch: only its age can say.
  if (!/^(claim|ship):/.test(l.owner)) {
    if (!branches.includes(l.owner)) return 'stale';
    if (ok('merge-base', '--is-ancestor', l.owner, BASE) && !worktreeOf(l.owner)) return 'stale';
  }
  return Date.now() - Date.parse(l.at) > STALE_MINUTES * 60_000 ? 'ambiguous' : 'live';
}

function tryTake(owner) {
  const body = JSON.stringify({ owner, worktree: top, at: new Date().toISOString() });
  try { writeFileSync(LOCK, body, { flag: 'wx' }); return { got: true }; } catch (e) {
    if (e.code !== 'EEXIST') die(2, `could not write ${LOCK}: ${e.message}`);
  }
  const l = readLock();
  if (!l) return { got: false, why: 'unreadable' }; // mid-write by another process; retry
  if (l.owner === owner) return { got: true, again: true };
  const state = judge(l);
  if (state === 'stale') {
    try { unlinkSync(LOCK); } catch { /* another taker cleared it first */ }
    const again = tryTake(owner);
    if (again.got) again.cleared = l;
    return again;
  }
  return { got: false, held: l, state };
}

async function lockCmd(sub, owner) {
  if (sub === 'status') {
    const l = readLock();
    if (asJson) { console.log(JSON.stringify(l ? { ...l, state: judge(l) } : null)); process.exit(0); }
    die(0, l ? `held by ${l.owner} (${l.worktree}) since ${l.at} — ${judge(l)}` : 'free');
  }
  if (!owner) die(2, `usage: land.mjs lock ${sub} <owner>`);
  if (sub === 'release') {
    const l = readLock();
    if (!l) die(1, `the lock is not held — nothing for ${owner} to release.`);
    if (l.owner !== owner) die(1, `the lock is held by ${l.owner}, not ${owner}; only its owner releases it.`);
    unlinkSync(LOCK);
    die(0, `released by ${owner}.`);
  }
  if (sub !== 'take') die(2, 'usage: land.mjs lock take|release|status [<owner>] [--wait <seconds>]');
  const until = Date.now() + Number(opt('--wait') ?? 0) * 1000;
  for (;;) {
    const r = tryTake(owner);
    if (r.got) {
      die(0, r.again ? `${owner} already holds the lock.`
        : `taken by ${owner}${r.cleared ? ` (cleared a stale lock left by ${r.cleared.owner} since ${r.cleared.at})` : ''}.`);
    }
    if (r.state === 'ambiguous') {
      die(1, `the lock has been held by ${r.held.owner} (${r.held.worktree}) since ${r.held.at}, over ${STALE_MINUTES} minutes, and that branch is not merged. It may be a crashed landing or a slow one — ask the user. Clearing it is \`node scripts/land.mjs lock release ${r.held.owner}\`.`);
    }
    if (Date.now() >= until) {
      die(1, r.held ? `held by ${r.held.owner} (${r.held.worktree}) since ${r.held.at}. Retry with --wait <seconds>.` : 'the lock file is unreadable; retry.');
    }
    await new Promise((res) => setTimeout(res, 250));
  }
}

const requireLock = (branch) => {
  const l = readLock();
  if (!l || l.owner !== branch) {
    die(1, `${branch} does not hold the land lock${l ? ` (${l.owner} does)` : ''}. Take it first: node scripts/land.mjs lock take ${branch} --wait 600`);
  }
};

// ── Conflicts ────────────────────────────────────────────────────────────────

const CONTEXT = 2;

/**
 * The conflicted regions of a file in diff3 style. During a rebase, the `<<<<<<<` side
 * is the new main (with any of this branch's commits already replayed), and the
 * `>>>>>>>` side is the commit being replayed — this branch.
 */
function parseRegions(text) {
  const lines = text.split('\n');
  const regions = [];
  let i = 0;
  let lastEnd = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) { i++; continue; }
    const start = i;
    const main = [], base = [], branch = [];
    let part = main;
    for (i++; i < lines.length && !lines[i].startsWith('>>>>>>>'); i++) {
      if (lines[i].startsWith('|||||||')) part = base;
      else if (lines[i].startsWith('=======')) part = branch;
      else part.push(lines[i]);
    }
    const end = i;
    const pre = lines.slice(Math.max(lastEnd, start - CONTEXT), start);
    const post = [];
    for (let k = end + 1; k < lines.length && post.length < CONTEXT && !lines[k].startsWith('<<<<<<<'); k++) post.push(lines[k]);
    regions.push({ pre, main, base, branch, post, atEof: end + 1 >= lines.length || (end + 1 === lines.length - 1 && lines[end + 1] === '') });
    lastEnd = end + 1;
    i = end + 1;
  }
  return regions;
}

const seqAt = (lines, at, seq) => seq.every((s, k) => lines[at + k] === s);
const find = (lines, from, seq) => {
  if (!seq.length) return from;
  for (let at = from; at + seq.length <= lines.length; at++) if (seqAt(lines, at, seq)) return at;
  return -1;
};
const norm = (ls) => ls.map((l) => l.replace(/\s+$/, '')).join('\n').trim();

/** What each recorded region became in the resolved file; null where it can't be found. */
function resolvedRegions(text, regions) {
  const lines = text.split('\n');
  let cursor = 0;
  return regions.map((r) => {
    const p = find(lines, cursor, r.pre);
    if (p < 0) return null;
    const from = p + r.pre.length;
    let to;
    if (r.post.length) { to = find(lines, from, r.post); if (to < 0) return null; }
    else to = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
    cursor = to;
    return lines.slice(from, to);
  });
}

// The merges on main since this branch's old base that changed `file`. A path-limited
// `git log --merges` would simplify those merges away (each is TREESAME to one parent),
// so each first-parent merge is diffed against its first parent instead.
const otherEntries = (rec, file) =>
  (git('log', '--merges', '--first-parent', '--format=%h %s', `${rec.oldBase}..${BASE}`) || '').split('\n').filter(Boolean)
    .filter((l) => (git('diff', '--name-only', `${l.split(' ')[0]}^1`, l.split(' ')[0], '--', file) || '') !== '')
    .map((l) => {
      const id = (l.match(/feat\/([pb]\d+)-/i) || [])[1]?.toUpperCase();
      return { merge: l, id: id || null, entry: id ? `${buildableRegister(id).dir}/${id}.md` : null };
    });

/** Record this rebase step's conflicts; exit 3 for the session, or 4 if it can't resolve them. */
function stopAtConflicts(rec) {
  const files = (git('diff', '--name-only', '--diff-filter=U') || '').split('\n').filter(Boolean);
  const step = { commit: git('rev-parse', '--short', 'REBASE_HEAD'), subject: git('log', '-1', '--format=%s', 'REBASE_HEAD'), files: [] };
  const unmarkable = [];
  for (const file of files) {
    const p = join(top, file);
    const text = existsSync(p) ? readFileSync(p, 'utf8') : null;
    const regions = text ? parseRegions(text) : [];
    if (!regions.length) { unmarkable.push(file); continue; }
    step.files.push({ file, regions, others: otherEntries(rec, file) });
  }
  rec.pending = step;
  writeRecord(rec);
  if (unmarkable.length) {
    die(4, `conflict with nothing to merge line by line (one side deleted or renamed it, or it is binary): ${unmarkable.join(', ')}. That is a choice between the two entries — ask the user. The rebase is left in progress; \`git rebase --abort\` undoes it.`);
  }
  const out = [`land: conflicts replaying ${step.commit} "${step.subject}". Resolve each region in the file (Edit), then: node scripts/land.mjs continue`];
  for (const f of step.files) {
    out.push(`\n  ${f.file}`);
    for (const o of f.others) out.push(`    landed by: ${o.merge}${o.id ? ` → ${o.id} (${o.entry})` : ''}`);
    f.regions.forEach((r, n) => {
      out.push(`    region ${n + 1}:`, '    main (the other entry) has:', show(r.main), '    this branch has:', show(r.branch), '    before either:', show(r.base));
    });
  }
  out.push('\nRead the other entry\'s merge commit and backlog file before resolving: resolve so both entries\' intent survives.');
  console.log(out.join('\n'));
  process.exit(3);
}

function afterRebase(rec, result) {
  if (result !== null) {
    rec.pending = null;
    rec.newBase = git('rev-parse', '--short', BASE);
    // Where the rebase left the branch: a commit after it is a report made after any
    // conflict resolution, which close-report --clears needs to see (D-7).
    rec.rebasedTip = git('rev-parse', 'HEAD');
    writeRecord(rec);
    const n = rec.conflicts.length;
    die(0, `${rec.branch} is rebased onto ${BASE} (${rec.newBase})${n ? `, with ${n} conflict region(s) resolved — run the suite, then re-verify (see /implement)` : ', no conflicts'}.`);
  }
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) stopAtConflicts(rec);
  die(1, `rebase failed: ${git.firstError()}`);
}

function rebaseCmd() {
  if (!inLinkedWorktree) die(1, 'rebase runs in the branch\'s own worktree, not the main checkout.');
  const branch = currentBranch();
  if (!branch) die(1, 'HEAD is detached; check out the entry\'s branch.');
  requireLock(branch);
  if (git('status', '--porcelain')) die(1, 'the worktree has uncommitted changes; commit them first.');
  // A rebase again after a failed landing keeps the earlier resolutions: close-report
  // --clears must still see that a conflict was resolved since the report (D-7).
  const rec = { branch, oldBase: git('merge-base', 'HEAD', BASE), newBase: null, conflicts: readRecord(branch)?.conflicts ?? [], pending: null };
  writeRecord(rec);
  afterRebase(rec, git('-c', 'merge.conflictStyle=diff3', 'rebase', BASE));
}

/**
 * The session's case for each one-sided region, from a `--why` file: `## <file> region <n>`
 * sections, each holding a `Why:` and a `Suggest:` (either may run on over lines).
 */
function readCases(path) {
  let text;
  try { text = readFileSync(resolve(path), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch (e) { die(1, `--why: cannot read ${path} (${e.code ?? e.message}).`); }
  const cases = new Map();
  let at = null;
  let field = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    // A case often quotes the conflicted lines; inside a fence, a `## ` line is text.
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || /^\s*(```|~~~)/.test(line)) { if (at && field) cases.get(at)[field] += `\n${line}`; continue; }
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (cases.has(h[1])) die(1, `--why: ${path} has \`## ${h[1]}\` twice.`);
      cases.set(at = h[1], { why: '', suggest: '' });
      field = null;
      continue;
    }
    const m = /^(Why|Suggest):\s*(.*)$/.exec(line);
    if (at && m) { field = m[1].toLowerCase(); cases.get(at)[field] = m[2]; } else if (at && field) cases.get(at)[field] += `\n${line}`;
  }
  for (const c of cases.values()) { c.why = c.why.trim(); c.suggest = c.suggest.trim(); }
  return cases;
}

const show = (ls, pad = '      ') => (ls.length ? ls.map((l) => `${pad}${l}`).join('\n') : `${pad}(nothing)`);
const KEPT = { main: 'the main side; this branch\'s change there is dropped', branch: 'this branch\'s side; the other entry\'s change there is dropped' };

function continueCmd() {
  if (!inLinkedWorktree) die(1, 'continue runs in the branch\'s own worktree.');
  const branch = currentBranch();
  const rec = branch && readRecord(branch);
  if (!rec?.pending) die(1, 'no conflicted rebase step is recorded here. Start with: node scripts/land.mjs rebase');
  requireLock(branch);
  const whyPath = opt('--why');
  const owner = opt('--owner')?.trim() ?? null;
  if (argv.includes('--why') && !whyPath) die(2, '--why needs the file holding the case for each one-sided region.');
  if (argv.includes('--owner') && !owner) die(2, '--owner needs the user\'s words.');
  if (whyPath && owner) die(2, '--why makes the case and stops for the user; --owner is their yes, given after that stop. Not both at once.');
  // Their words go into the merge commit's message: a line break could forge a trailer.
  if (owner && /[\r\n]/.test(owner)) die(2, '--owner takes the user\'s words on one line; a line break would change the merge commit\'s trailers.');
  const lost = [];
  const oneSided = [];
  const settled = [];
  for (const f of rec.pending.files) {
    const text = readFileSync(join(top, f.file), 'utf8');
    if (/^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( |$)/m.test(text)) die(1, `${f.file} still has conflict markers; resolve every region first.`);
    resolvedRegions(text, f.regions).forEach((got, n) => {
      const r = f.regions[n];
      const where = `${f.file} region ${n + 1}`;
      if (got === null) { lost.push(`${where}: can't find it in the resolved file (its surrounding lines changed), so the check can't vouch for it`); return; }
      const g = norm(got);
      const differ = norm(r.main) !== norm(r.branch);
      const kept = differ && g === norm(r.main) ? 'main' : differ && g === norm(r.branch) ? 'branch' : null;
      const c = { file: f.file, commit: rec.pending.commit, main: r.main, branch: r.branch, base: r.base, resolved: got, others: f.others };
      if (kept) oneSided.push({ ...c, where, kept });
      else settled.push(c);
    });
  }
  if (lost.length) {
    die(4, `the check can't vouch for the resolution:\n  ${lost.join('\n  ')}\nStop and ask the user. The rebase is left in progress; fix the file and re-run continue, or \`git rebase --abort\`.`);
  }
  if (!oneSided.length && (whyPath || owner)) {
    die(1, `no region here is resolved to one side, so there is nothing for ${owner ? 'a yes' : 'a case'} to cover. Run continue without ${owner ? '--owner' : '--why'}.`);
  }
  if (oneSided.length && owner) {
    // The yes covers exactly what the stop showed: the same regions, resolved the same way.
    const asked = rec.pending.asked ?? [];
    const sameAs = (o) => asked.find((a) => a.where === o.where && norm(a.resolved) === norm(o.resolved));
    // Every region that differs from the stop, either way: changed or new since, or shown
    // then and no longer one-sided.
    const differs = [...oneSided.filter((o) => !sameAs(o)).map((o) => o.where),
      ...asked.filter((a) => !oneSided.some((o) => o.where === a.where)).map((a) => a.where)];
    if (!asked.length) die(1, 'the user was never shown this resolution, so their yes can\'t cover it. Run continue --why <file> to stop for them.');
    if (differs.length) {
      die(1, `the resolution is not what the user was shown (${[...new Set(differs)].join(', ')}), so their yes can't cover it. Run continue --why <file> with a case for each region still one-sided, to stop for them again.`);
    }
    for (const { where, ...o } of oneSided) {
      const a = sameAs({ where, ...o });
      settled.push({ ...o, why: a.why, suggest: a.suggest, owner });
    }
  } else if (oneSided.length) {
    const cases = whyPath ? readCases(whyPath) : new Map();
    const wanted = new Set(oneSided.map((o) => o.where));
    const missing = oneSided.filter((o) => !cases.get(o.where)?.why || !cases.get(o.where)?.suggest).map((o) => o.where);
    const stray = [...cases.keys()].filter((k) => !wanted.has(k));
    if (missing.length || stray.length) {
      die(1, [
        missing.length && `a one-sided resolution needs the case for it before it stops for the user:\n  ${oneSided.filter((o) => missing.includes(o.where)).map((o) => `${o.where}: kept only ${KEPT[o.kept]}`).join('\n  ')}`,
        stray.length && `--why has a case for ${stray.join(', ')}, which ${stray.length > 1 ? 'are not regions' : 'is not a region'} resolved to one side here`,
        `Write a \`## <file> region <n>\` section for each, with \`Why:\` (why dropping that side is right) and \`Suggest:\` (the answer you recommend), then: node scripts/land.mjs continue --why <file>`,
      ].filter(Boolean).join('\n'));
    }
    rec.pending.asked = oneSided.map((o) => ({ where: o.where, resolved: o.resolved, kept: o.kept, ...cases.get(o.where) }));
    writeRecord(rec);
    const out = [`the resolution keeps only one side in ${oneSided.length} region(s). This stops for the user (D-4): one yes covers every region below; a no names the regions it is for.`];
    for (const o of oneSided) {
      const c = cases.get(o.where);
      const other = o.others.map((x) => x.id || x.merge).join(', ') || BASE;
      out.push('', `  ${o.where} (replaying ${o.commit}; other side: ${other})`,
        '    main (the other entry) has:', show(o.main), '    this branch has:', show(o.branch),
        `    kept: ${KEPT[o.kept]}`,
        '    why:', show(c.why.split('\n')), '    suggested answer:', show(c.suggest.split('\n')));
    }
    out.push('', 'Yes → node scripts/land.mjs continue --owner "<their words>"',
      'No  → resolve the regions they named again (Edit), then node scripts/land.mjs continue (with --why, if any region is still one-sided)',
      'The rebase is left in progress; `git rebase --abort` undoes it.');
    die(4, out.join('\n'));
  }
  for (const f of rec.pending.files) if (!ok('add', '--', f.file)) die(1, `git add ${f.file} failed: ${git.firstError()}`);
  rec.conflicts.push(...settled);
  rec.pending = null;
  writeRecord(rec);
  afterRebase(rec, git('-c', 'core.editor=true', '-c', 'merge.conflictStyle=diff3', 'rebase', '--continue'));
}

// ── Merge, finish, report ────────────────────────────────────────────────────

function reportText(rec) {
  if (!rec?.conflicts.length) return '';
  const lines = [`Conflicts resolved: ${rec.conflicts.length}`];
  for (const c of rec.conflicts) {
    const o = c.others.map((x) => x.id || x.merge).join(', ') || BASE;
    lines.push(`- ${c.file} (replaying ${c.commit}; other side: ${o})`,
      `  ${`${BASE}:`.padEnd(10)}${c.main.join(' / ') || '(nothing)'}`,
      `  branch:   ${c.branch.join(' / ') || '(nothing)'}`,
      `  resolved: ${c.resolved.join(' / ') || '(nothing)'}`);
    // A one-sided region landed only on the user's yes (P39): the case they said yes to.
    if (c.kept) {
      lines.push(`  kept only ${c.kept === 'main' ? `${BASE}'s side` : 'the branch\'s side'}, on the user's yes: ${c.owner}`,
        `  why:      ${c.why.split('\n').join(' / ')}`,
        `  suggested: ${c.suggest.split('\n').join(' / ')}`);
    }
  }
  return lines.join('\n');
}

/** The `Ad-hoc:`/`Relates:` trailers an `adhoc/` branch's merge carries; '' for an entry's branch. */
function adhocTrailers(branch) {
  const what = (opt('--adhoc') ?? '').replace(/\s+/g, ' ').trim();
  const relates = (opt('--relates') ?? '').split(/[\s,]+/).filter(Boolean).map((id) => id.toUpperCase());
  if (!branch.startsWith('adhoc/')) {
    if (argv.includes('--adhoc') || argv.includes('--relates')) {
      die(1, `--adhoc and --relates are for adhoc/ branches. ${branch} lands as an entry, with its close report.`);
    }
    return '';
  }
  if (!what) die(1, `${branch} is ad-hoc, so its merge must say what it is: --adhoc "<what changed>". Nothing else records that it happened.`);
  if (argv.includes('--relates') && !relates.length) die(1, '--relates needs at least one ID.');
  const missing = relates.filter((id) => {
    const reg = registerOf(id);
    return !reg || !ok('cat-file', '-e', `${BASE}:${reg.dir}/${id}.md`);
  });
  if (missing.length) die(1, `--relates names ${missing.join(', ')}, which ${missing.length > 1 ? 'have' : 'has'} no entry in any register on ${BASE}.`);
  return `Ad-hoc: ${what}${relates.length ? `\nRelates: ${[...new Set(relates)].join(', ')}` : ''}`;
}

function mergeCmd(branch) {
  if (inLinkedWorktree) die(1, 'merge runs in the main checkout. Leave the worktree first (ExitWorktree keep).');
  if (!branches.includes(branch)) die(1, `no branch ${branch}.`);
  requireLock(branch);
  if (git('symbolic-ref', '--quiet', '--short', 'HEAD') !== BASE) die(1, `the main checkout is not on ${BASE}.`);
  const dirty = git('status', '--porcelain');
  if (dirty) die(1, `the main checkout has uncommitted changes — it is integration-only while sessions run:\n${dirty}`);
  if (!ok('merge-base', '--is-ancestor', BASE, branch)) {
    die(1, `${branch} is not rebased onto the current ${BASE}. From its worktree: node scripts/land.mjs rebase`);
  }
  const trailers = adhocTrailers(branch);
  const before = git('rev-parse', 'HEAD');
  const rep = reportText(readRecord(branch));
  const msg = `Merge branch '${branch}'${rep ? `\n\n${rep}` : ''}${trailers ? `\n\n${trailers}` : ''}`;
  if (!ok('merge', '--no-ff', '-m', msg, branch)) {
    git('merge', '--abort');
    die(1, `merge failed although ${branch} was rebased onto ${BASE} — something moved ${BASE} without the lock. ${git.firstError()}`);
  }
  const suite = opt('--suite') || 'npm test';
  let suiteOut;
  try {
    // NODE_TEST_CONTEXT makes a nested `node --test` report to a parent runner and exit
    // 0 whatever happened. Inherited by accident, it would turn a red suite green.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    suiteOut = execSync(suite, { cwd: top, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    git('reset', '--hard', before);
    // The node test runner marks each failing test with ✖ (and repeats them in its
    // summary). Matching "fail" instead picked up passing tests named for failures
    // and hid the real one. No ✖ at all: some other suite — show its last lines.
    const lines = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.split('\n');
    const failed = [...new Set(lines.filter((l) => l.includes('✖') && !/✖ failing tests:?$/.test(l.trim())).map((l) => l.trim()))];
    const tail = (failed.length ? failed : lines.filter((l) => l.trim()).slice(-15)).slice(0, 15).join('\n');
    die(1, `the suite is red on the merged result, so ${BASE} is back at ${before.slice(0, 7)}.\n${tail}`);
  }
  const next = trailers ? '' : '/ship\'s flips, then ';
  die(0, `merged ${branch} into ${BASE} (${git('rev-parse', '--short', 'HEAD')}); suite green (${suiteTotals(suiteOut)}). Next: ${next}node scripts/land.mjs finish ${branch}`);
}

/**
 * The node test runner's totals from a green suite's output, for /land's report (B2).
 * This run is the only one /land needs: a second `npm test` to read a count from can
 * have its output filtered by whatever wraps the shell, and once did. Reads the spec
 * reporter (`ℹ tests N`) and TAP (`# tests N`, the non-TTY default on older Node),
 * through colour codes and CRLF. Several runner summaries (one per `node --test`) are
 * summed; none at all is said plainly, never left as a silent gap.
 */
function suiteTotals(output) {
  const text = String(output ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  const sum = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 };
  let found = false;
  for (const m of text.matchAll(/^(?:ℹ|#) (tests|pass|fail|skipped|todo|cancelled) (\d+)\r?$/gm)) {
    sum[m[1]] += Number(m[2]);
    if (m[1] === 'tests') found = true;
  }
  if (!found) return 'no test totals in its output';
  // Skipped, todo and cancelled tests are the ones that make pass + fail fall short of
  // tests; name them when there are any, so the shortfall is never unexplained.
  const extra = ['skipped', 'todo', 'cancelled'].filter((k) => sum[k]).map((k) => `, ${sum[k]} ${k}`).join('');
  return `${sum.tests} tests, ${sum.pass} pass, ${sum.fail} fail${extra}`;
}

/**
 * Gitignored paths whose contents outlive the worktree they were made in.
 * `git worktree remove` refuses over untracked files but deletes ignored ones without
 * a word, and an eval run (evals/runs/, ignored on purpose) can't be recreated: its
 * replies came from subagents. One landing deleted a session's whole eval baseline.
 */
const KEPT_ON_FINISH = ['evals/runs'];

/**
 * Move each kept path's entries from worktree `wt` into this checkout. Never
 * overwrites: a name already here gets the branch appended. Returns the names kept.
 */
function keepIgnored(wt, branch) {
  const kept = [];
  for (const rel of KEPT_ON_FINISH) {
    const from = join(wt, rel);
    if (!existsSync(from)) continue;
    const to = join(top, rel);
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      let dest = join(to, name);
      for (let n = 1; existsSync(dest); n++) dest = join(to, `${name}-${branch.replace(/[^A-Za-z0-9._-]/g, '-')}${n > 1 ? `-${n}` : ''}`);
      try {
        renameSync(join(from, name), dest);
      } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        cpSync(join(from, name), dest, { recursive: true });
        rmSync(join(from, name), { recursive: true, force: true });
      }
      kept.push(basename(dest));
    }
  }
  return kept;
}

function finishCmd(branch) {
  if (inLinkedWorktree) die(1, 'finish runs in the main checkout.');
  requireLock(branch);
  if (!ok('merge-base', '--is-ancestor', branch, BASE)) die(1, `${branch} is not merged into ${BASE}; refusing to delete it.`);
  // Before the lock goes: a failure here leaves the lock, worktree and branch as they
  // were, so finish can simply run again.
  const wt = worktreeOf(branch);
  let kept = [];
  if (wt) {
    try { kept = keepIgnored(wt, branch); }
    catch (e) { die(1, `could not move ${wt}'s eval runs into this checkout (${e.message}); nothing removed, lock still held.`); }
  }
  const keptNote = kept.length ? ` Kept ${kept.length} eval run${kept.length === 1 ? '' : 's'} in evals/runs/: ${kept.join(', ')}.` : '';
  // Release FIRST, while the worktree still exists. Merged with its worktree gone is
  // what `judge` calls stale, so a lock still held during the teardown below could be
  // cleared and retaken by a waiting landing, and the unlink here would then delete
  // *that* landing's lock: its merge died with "does not hold the land lock". The
  // teardown touches only this branch and its worktree, never BASE, so it needs no lock.
  unlinkSync(LOCK);
  const left = `The lock is already released; finish the cleanup by hand.`;
  if (wt && !ok('worktree', 'remove', wt)) die(1, `could not remove ${wt}: ${git.firstError()}. ${left}`);
  if (!ok('branch', '-d', branch)) die(1, `could not delete ${branch}: ${git.firstError()}. ${left}`);
  rmSync(recordPath(branch), { force: true });
  die(0, `${branch} landed: lock released, worktree${wt ? '' : ' (none)'} and branch removed.${keptNote}`);
}

function reportCmd(branch) {
  const rec = readRecord(branch);
  if (!rec) die(1, `no landing record for ${branch}.`);
  if (asJson) { console.log(JSON.stringify(rec)); process.exit(0); }
  console.log(reportText(rec) || `${branch}: no conflicts.`);
  process.exit(0);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

const [cmd, a, b] = pos;
const usage = 'usage: land.mjs lock take|release|status <owner> [--wait s] | rebase | continue [--why file | --owner words] | merge <branch> [--suite cmd] [--adhoc what] [--relates IDs] | finish <branch> | report <branch> [--json]';
if (cmd === 'lock') await lockCmd(a, b);
else if (cmd === 'rebase') rebaseCmd();
else if (cmd === 'continue') continueCmd();
else if (cmd === 'merge' && a) mergeCmd(a);
else if (cmd === 'finish' && a) finishCmd(a);
else if (cmd === 'report' && a) reportCmd(a);
else die(2, usage);
