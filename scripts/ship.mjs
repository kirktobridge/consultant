// ship — the tracked docs' writes as one checked commit each (P55).
//
// /ship's edits were hand edits: change a header line, run the check, commit, release
// the lock. Any step could be skipped or half-done, and a claim left uncommitted, or
// committed past a red check, reads as a claim to every other session. So each change
// becomes one command that either commits a green change or leaves the tree as it was.
//
//   claim <P#|B#> [R#]   flip a feature or bug to `in-progress` on the trunk (R0). A
//                        milestone only names itself in the subject.
//   shipped <P#> --owner "<note>"
//                        the owner accepted a landed feature (R1): `status: shipped`, a
//                        `shipped:` date, and their note. Refused without --owner, since
//                        `shipped` is their verdict, never the loop's.
//   fixed <B#> --owner "<note>" | --clears [--branch <b>]
//                        a landed bug is fixed (R1): on the owner's word, or when
//                        close-report --clears says its report clears it (D-7).
//   reject <P#|B#> --owner "<what failed>"
//                        the owner rejected a landing (R1): it stays `in-progress`, with
//                        today appended to `rejected:` and their note. A bug /land marked
//                        `fixed` is reopened the same way.
//
// The terminal commands land beside the old /ship, as claim did: callers switch to
// them after 2 clean real uses.
//
// Each command, in order:
//   - runs in the main checkout, on the trunk, with a clean tree. A write made on a
//     branch is invisible to other sessions, and a dirty tree is another task's state.
//   - holds the land lock as `claim:<ID>` or `ship:<ID>`, through land.mjs, so the
//     lock's staleness rules stay in one place. It releases only a lock it took, on
//     every exit — a lock left behind with no branch is never judged stale, so it would
//     block every landing.
//   - reads the entry from the trunk and refuses one in the wrong state, naming why. A
//     claim also refuses a direct dependency unmet; chains are left to the schema check.
//   - edits the entry. A terminal flip (`shipped`, `fixed`) also takes the ID off
//     MANUAL-ORDER.md. Every command but claim regenerates QUEUE.md, so the entry and
//     the queue land in one commit; a claim never changes the queue (an `in-progress`
//     entry stays a queue candidate).
//   - runs the schema check on the edited tree, and commits only when it is green: a
//     flip that leaves a dependent presumptively stale is refused, naming it, because
//     its `drafted:` moves only after a real re-read. The commit runs the repo's hooks.
//     If anything fails after the edit, every file is put back.
//
// Exit: 0 done | 1 refused (the message says why) | 2 could not run
//
// Usage: node scripts/ship.mjs <command> <ID> … [--wait <s>] [--trailer <line>] [--base <branch>] [--json]

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKLOG, BUGS, buildableRegister, parseEntry, unmetDependencies, describeUnmet, dependencyAdvice, parseManualOrder,
} from './entries.mjs';
import { gitIn } from './git.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { generateQueue, loadAll } from './queue.mjs';
import { entryOfBranch, mergedBranch } from './landing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const VALUED = ['--wait', '--trailer', '--base', '--owner', '--branch'];
const asJson = argv.includes('--json');
const [cmd, rawId, milestone, ...surplus] = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const ID = rawId?.toUpperCase() ?? null;

// Cleanup runs on every exit, a crash included: put the edits back unless they were
// committed, then release the lock if this run took it.
const cleanup = { edits: [], lock: null };
let lockNote = '';
// Each step on its own: a put-back that throws must not keep the lock held.
const tidy = () => {
  const { edits, lock } = cleanup;
  cleanup.edits = [];
  cleanup.lock = null;
  const note = (s) => { lockNote = [lockNote, s].filter(Boolean).join('\n'); };
  for (const putBack of edits.reverse()) {
    try { putBack(); } catch (e) { note(`Putting a file back failed (${e.message}): check it by hand.`); }
  }
  try { if (lock) note(lock()); } catch (e) { note(`Releasing the land lock failed (${e.message}).`); }
  if (lockNote && !reported) console.error(`ship: ${lockNote}`); // done() never ran to print it
};
let reported = false;
process.on('exit', tidy);
// A crash is reported like any other failure, so a --json caller still gets its object.
process.on('uncaughtException', (e) => done(2, 'error', `crashed, and nothing was committed: ${e.stack ?? e}`));

const done = (code, action, msg, extra = {}) => {
  reported = true;
  tidy();
  if (lockNote) msg += `\n${lockNote}`;
  if (asJson) console.log(JSON.stringify({ id: ID, action, message: msg, ...extra }));
  else (code === 0 ? console.log : console.error)(`ship: ${msg}`);
  process.exit(code);
};

const COMMON = '[--wait <s>] [--trailer <line>] [--base <branch>] [--json]';
const usage = [
  `usage: node scripts/ship.mjs claim <P#|B#> [R#] ${COMMON}`,
  `       node scripts/ship.mjs shipped <P#> --owner "<note>" ${COMMON}`,
  `       node scripts/ship.mjs fixed <B#> (--owner "<note>" | --clears [--branch <branch>]) ${COMMON}`,
  `       node scripts/ship.mjs reject <P#|B#> --owner "<what failed>" ${COMMON}`,
].join('\n');
if (!['claim', 'shipped', 'fixed', 'reject'].includes(cmd) || !ID || surplus.length) done(2, 'error', usage);
const REG = buildableRegister(ID);
if (!REG) done(2, 'error', `"${rawId}" is not a buildable id (P# or B#).\n${usage}`);
const MILESTONE = milestone?.toUpperCase() ?? null;
if (MILESTONE && cmd !== 'claim') done(2, 'error', `only a claim takes a milestone, not ${cmd}.\n${usage}`);
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
const owner = opt('--owner');
if (owner !== null && !owner.trim()) done(2, 'error', '--owner needs the owner\'s note, not an empty one.');
// The note becomes one line of the entry: a line break could forge a heading.
if (owner !== null && /[\r\n]/.test(owner)) done(2, 'error', '--owner takes a one-line note; a line break would change the entry\'s sections.');
const clears = argv.includes('--clears');
const branchArg = opt('--branch');

// What each command may be given, checked before anything is read or locked.
if (cmd === 'claim' && (owner !== null || clears || branchArg)) done(2, 'error', `a claim takes no --owner, --clears or --branch.\n${usage}`);
if (cmd === 'shipped' && REG !== BACKLOG) done(2, 'error', `only a feature is shipped; a bug is \`fixed\`.\n${usage}`);
if (cmd === 'fixed' && REG !== BUGS) done(2, 'error', `only a bug is fixed; a feature is \`shipped\`.\n${usage}`);
if (cmd === 'fixed' && owner !== null && clears) done(2, 'error', `fixed takes --owner or --clears, not both: say whose word it is.\n${usage}`);
if (cmd !== 'fixed' && (clears || branchArg)) done(2, 'error', `only fixed takes --clears or --branch.\n${usage}`);
if (cmd === 'shipped' && owner === null) {
  done(1, 'refused', `${ID} is not shipped without the owner's word: \`shipped\` is their verdict on the Accept criteria. Pass it as --owner "<which criteria they accepted, on what>".`);
}
if (cmd === 'fixed' && owner === null && !clears) {
  done(1, 'refused', `${ID} is fixed on the owner's word (--owner "<note>") or when its landing report clears it (--clears, D-7); this call gave neither.`);
}
if (cmd === 'reject' && owner === null) {
  done(1, 'refused', `a rejection is the owner's verdict: pass what failed, in their words, as --owner "<what failed>".`);
}

const git = gitIn();

const top = git('rev-parse', '--show-toplevel');
if (top === null) done(2, 'error', `not a git repository, or git refused it.${git.error() ? ` git: ${git.firstError()}` : ''}`);
const gitDir = resolve(top, git('rev-parse', '--git-dir'));
if (gitDir !== resolve(top, git('rev-parse', '--git-common-dir'))) {
  done(1, 'refused', `this is a linked worktree (${top}). The tracked docs are written in the main checkout, on the trunk, so every session sees them.`);
}
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const { trunk: BASE, error: baseError } = trunkFromArgv(argv, branches);
if (baseError) done(2, 'error', baseError);
const head = git('symbolic-ref', '--quiet', '--short', 'HEAD');
if (head !== BASE) done(1, 'refused', `the main checkout is on ${head ?? 'a detached HEAD'}, not ${BASE}. A write made off the trunk is invisible to other sessions.`);

const verb = { claim: 'claiming', shipped: 'shipping', fixed: 'fixing', reject: 'rejecting' }[cmd];
const refuseIfDirty = () => {
  const d = git('status', '--porcelain');
  if (d === null) done(2, 'error', `git status failed: ${git.firstError()}`);
  if (d) done(1, 'refused', `the main checkout has uncommitted changes:\n${d.split('\n').map((l) => `  ${l}`).join('\n')}\nCommit them as their own unit (or ask whose they are) before ${verb} ${ID}.`);
};
refuseIfDirty();

// The lock, through land.mjs: one implementation of who holds it and when it is stale.
const land = (...args) => spawnSync(process.execPath, [join(HERE, 'land.mjs'), ...args, '--base', BASE], { cwd: top, encoding: 'utf8' });
const OWNER = `${cmd === 'claim' ? 'claim' : 'ship'}:${ID}`;
const status = land('lock', 'status', '--json');
let holder = null;
try { holder = status.status === 0 ? JSON.parse(status.stdout || 'null')?.owner ?? null : null; } catch { /* unreadable: take it below */ }
// /land runs a terminal flip while the entry's own branch holds the lock, between
// `merge` and `finish`: that landing's lock covers this write, so it is not taken again.
const underLanding = cmd !== 'claim' && !!holder && (holder === branchArg || entryOfBranch(holder) === ID);
const heldBefore = holder === OWNER || underLanding;
let cleared = '';
if (!underLanding) {
  const took = land('lock', 'take', OWNER, '--wait', wait);
  if (took.status !== 0) {
    done(took.status === 1 ? 1 : 2, took.status === 1 ? 'refused' : 'error',
      `could not take the land lock. ${(took.stderr || took.stdout).trim().replace(/^land: /, '')}`);
  }
  // land.mjs says when taking the lock cleared a stale one; that is worth passing on.
  cleared = /\(cleared a stale lock[^)]*\)/.exec(took.stdout)?.[0] ?? '';
}
if (!heldBefore) {
  cleanup.lock = () => {
    const r = land('lock', 'release', OWNER);
    return r.status === 0 ? '' : `The land lock is still held by ${OWNER}: ${(r.stderr || r.stdout).trim()} Release it with \`node scripts/land.mjs lock release ${OWNER}\`.`;
  };
}

// Another session may have committed while this one waited for the lock.
refuseIfDirty();

// The entry, read from the trunk — never a stale copy.
const rel = `${REG.dir}/${ID}.md`;
const text = git('show', `${BASE}:${rel}`);
if (text === null) done(1, 'refused', `${ID} has no entry on ${BASE} — untriaged ideas go to /triage first.`);
const entry = parseEntry(text, REG.keys);
const was = entry.header.status;
if (!was) done(1, 'refused', `${rel} on ${BASE} has no readable \`status:\` header. Run npm run check:docs for what is wrong with it.`);

const today = new Date().toISOString().slice(0, 10);
// The merge that landed the entry's branch on the trunk, for the note: the newest one.
const mergeOf = () => {
  const log = git('log', '--first-parent', '--merges', '--format=%h%x09%s', BASE, '--') ?? '';
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, subject] = line.split('\t');
    const b = mergedBranch(subject);
    if (b && (branchArg ? b === branchArg : entryOfBranch(b) === ID)) return sha;
  }
  return null;
};

// ── What each command writes ────────────────────────────────────────────────
// `plan` is the header lines to set, the note for the body, and the commit's words.
let plan;
if (cmd === 'claim') {
  if (was === 'in-progress') done(1, 'refused', `${ID} is already claimed: it is \`in-progress\` on ${BASE}. A stale claim is cleared through /ship, never overridden.`);
  if (!REG.open.has(was)) done(1, 'refused', `${ID} is \`${was}\` on ${BASE}, which is closed. Reopening it is the owner's call, not a claim.`);
  const unmet = unmetDependencies(entry, (id, reg) => git('show', `${BASE}:${reg.dir}/${id}.md`));
  if (unmet.length) {
    done(1, 'refused', `${ID} depends on ${describeUnmet(unmet)} on ${BASE}. ${dependencyAdvice(unmet)}.`,
      { unmet: unmet.map(({ id, status: s }) => ({ id, status: s })) });
  }
  const what = MILESTONE ? `${ID} ${MILESTONE}` : ID;
  plan = { set: { status: 'in-progress' }, subject: `docs: claim ${what} (${ID})`, said: `${what} claimed`, action: 'claimed' };
} else if (cmd === 'shipped' || cmd === 'fixed') {
  const word = cmd;
  if (was !== 'in-progress') {
    done(1, 'refused', `${ID} is \`${was}\` on ${BASE}, not \`in-progress\`: only a landed build awaiting acceptance is ${word}.`);
  }
  const merge = mergeOf();
  let note;
  if (clears) {
    const args = ['--clears', ID, '--base', BASE, ...(branchArg ? ['--branch', branchArg] : [])];
    const r = spawnSync(process.execPath, [join(HERE, 'close-report.mjs'), ...args], { cwd: top, encoding: 'utf8' });
    const said = `${r.stdout}\n${r.stderr}`.trim();
    if (r.status === 1) done(1, 'refused', `${ID}'s report does not clear it, so it stays \`in-progress\` for the owner's word:\n${said}`);
    if (r.status !== 0) done(2, 'error', `close-report --clears could not decide, so ${ID} stays \`in-progress\`:\n${said}`);
    if (!merge) done(1, 'refused', `no merge of ${ID}'s branch on ${BASE}: --clears runs during /land, after \`land.mjs merge\`.`);
    note = `Fixed ${today} by /land under D-7: the report clears it (Repro not observed to still break, Expected observed); merge ${merge}.`;
  } else {
    note = `${word === 'shipped' ? 'Shipped' : 'Fixed'} ${today} on the owner's word${merge ? ` (merge ${merge})` : ''}: ${owner.trim()}`;
  }
  const set = { status: word, ...(word === 'shipped' ? { shipped: today } : {}) };
  plan = { set, note, terminal: true, subject: `docs: ${ID} ${word} (${ID})`, said: `${ID} ${word}`, action: word };
} else {
  const reopen = REG === BUGS && was === 'fixed';
  if (was !== 'in-progress' && !reopen) {
    done(1, 'refused', `${ID} is \`${was}\` on ${BASE}: only a landing awaiting acceptance (\`in-progress\`)${REG === BUGS ? ', or a bug marked `fixed`,' : ''} is rejected.`);
  }
  // Append, never replace: a second rejection the same day must still change the value.
  const rejected = [entry.header.rejected, today].filter(Boolean).join(', ');
  const note = `${reopen ? 'Reopened' : 'Rejected'} ${today} on the owner's word: ${owner.trim()}`;
  plan = {
    set: { status: 'in-progress', rejected }, note,
    subject: `docs: ${ID} ${reopen ? 'reopened' : 'rejected'} (${ID})`, said: `${ID} ${reopen ? 'reopened' : 'rejected'}`,
    action: reopen ? 'reopened' : 'rejected',
  };
}

// ── The edits, each one put back unless the commit lands ────────────────────
const written = [];
const write = (relPath, next) => {
  const p = join(top, relPath);
  const before = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (before === next) return;
  writeFileSync(p, next); // a write that throws changed nothing to put back
  cleanup.edits.push(() => (before === null ? unlinkSync(p) : writeFileSync(p, before)));
  written.push(relPath);
};

/** The entry's text with `set` applied to its header and `note` added to its Notes. */
function edited(source, set, note) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(eol);
  const end = lines.indexOf('---', 1);
  const statusAt = lines.findIndex((l, i) => i > 0 && i < end && /^status:/.test(l));
  if (lines[0] !== '---' || end < 0 || statusAt < 0) done(1, 'refused', `${rel} has no \`status:\` line in its header to flip.`);
  let after = statusAt;
  for (const [key, value] of Object.entries(set)) {
    const at = lines.findIndex((l, i) => i > 0 && i < lines.indexOf('---', 1) && l.startsWith(`${key}:`));
    if (at >= 0) lines[at] = `${key}: ${value}`;
    else lines.splice(++after, 0, `${key}: ${value}`); // a new key goes beside `status:`
  }
  if (!note) return lines.join(eol);
  // The note closes the Notes section: before the next heading after it, or at the end.
  const notesAt = lines.findIndex((l) => /^## Notes\s*$/.test(l));
  if (notesAt < 0) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', '## Notes', '', note, '');
    return lines.join(eol);
  }
  let stop = lines.findIndex((l, i) => i > notesAt && /^## /.test(l));
  if (stop < 0) stop = lines.length;
  let tail = stop;
  while (tail > notesAt + 1 && lines[tail - 1] === '') tail--;
  lines.splice(tail, 0, '', note);
  if (stop === lines.length - 2 && lines[lines.length - 1] !== '') lines.push('');
  return lines.join(eol);
}

write(rel, edited(readFileSync(join(top, rel), 'utf8'), plan.set, plan.note));

if (plan.terminal && REG === BACKLOG) {
  // A terminal entry leaves the owner's recorded order; the rest keep their order.
  const manualPath = join(top, BACKLOG.manualOrder);
  if (existsSync(manualPath)) {
    const manual = readFileSync(manualPath, 'utf8');
    const { ids } = parseManualOrder(manual.replace(/\r\n/g, '\n'));
    if (ids.includes(ID)) {
      const eol = manual.includes('\r\n') ? '\r\n' : '\n';
      let n = 0;
      const next = manual.split(eol).flatMap((l) => {
        const m = l.match(/^\d+\.\s+(\S+)\s*$/);
        if (!m || !BACKLOG.idPattern.test(m[1])) return [l];
        return m[1] === ID ? [] : [`${++n}. ${m[1]}`];
      }).join(eol);
      write(BACKLOG.manualOrder, next);
    }
  }
}

if (cmd !== 'claim') {
  const readOr = (p) => (existsSync(join(top, p)) ? readFileSync(join(top, p), 'utf8') : '');
  const gen = generateQueue(loadAll(top), { queueText: readOr(BACKLOG.queue), manualText: readOr(BACKLOG.manualOrder) });
  write(BACKLOG.queue, gen.text);
}

const check = spawnSync(process.execPath, [join(HERE, 'backlog-schema-check.mjs'), '--all'], {
  cwd: top, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: top },
});
if (check.status !== 0) {
  done(1, 'refused', `the schema check is red with ${plan.said}, so nothing was committed:\n${`${check.stdout}\n${check.stderr}`.trim()}`);
}

const message = `${plan.subject}${plan.note ? `\n\n${plan.note}` : ''}${trailer ? `\n\n${trailer}` : ''}`;
// Staged first, so a file this run created can be committed; unstaged again on failure,
// before the put-backs run (they run last-pushed first).
if (git('add', '--', ...written) === null) done(2, 'error', `git add failed, so nothing was committed: ${git.firstError()}`);
cleanup.edits.push(() => git('reset', '-q', '--', ...written));
if (git('commit', '-q', '-m', message, '--', ...written) === null) {
  done(1, 'refused', `the commit failed, so ${cmd === 'claim' ? `${ID} is unclaimed` : `${ID} is unchanged`} and the files are put back. git: ${git.error()}`);
}
cleanup.edits = [];
done(0, plan.action, `${plan.said} on ${BASE} (${git('rev-parse', '--short', 'HEAD')}).${written.length > 1 ? ` Also wrote ${written.slice(1).join(', ')}.` : ''}${cleared ? ` The land lock: ${cleared.slice(1, -1)}.` : ''}`, { commit: git('rev-parse', 'HEAD'), files: written });
