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
//   resolve <A-n> verified|refuted|moot --from <file>
//                        an assumption is settled (R2): `resolved:` today and the file's
//                        `## Resolution`. Anyone who hits it settles it, so no --owner.
//                        Not one a spike settles: the schema check wants the spike's
//                        `shipped` and the Resolution in one commit, which stays by hand.
//   decide <D-n> --owner "<their word>" --leads-to <P#|—> --from <file>
//                        the owner took a decision (R2): `decided:` today, `leads_to:`,
//                        `waiting_on:` dropped, and the file's `## Decided`, `## Why` and
//                        `## Reopen if`. Refused without --owner: only they decide.
//   file <P|B|A|D> --owner "<their approval>" --from <draft>
//                        file an approved /triage draft as a new entry (R3). The script
//                        takes the next free ID in that register, under the lock, and
//                        writes `id:`, the opening status and today's date; the draft
//                        gives the rest of the header and the body, which is copied
//                        verbatim (Accept and Repro are the owner's and the reporter's
//                        words). Refused without --owner: a draft is filed once approved.
//                        One draft per call: a draft naming another new entry waits for
//                        its real ID. Experiments are /research's.
//
// --from is a Markdown file holding exactly the sections named, each with a body, so
// a several-line answer goes in whole. For `file` it is the whole draft: a `---` header
// of the keys the drafter chose, then the sections. `moved` and `superseded` stay hand edits: each
// also changes other entries. After a resolution or a decision, the sweep
// (groom.mjs --for) prints the entries that depend on it.
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
//     the queue land in one commit (a resolution or a decision can unblock a queued
//     entry); a claim never changes the queue (an `in-progress` entry stays a queue
//     candidate).
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
import { join, resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKLOG, BUGS, ASSUMPTIONS, DECISIONS, buildableRegister, parseEntry, unmetDependencies, describeUnmet, dependencyAdvice, parseManualOrder,
  today as localToday,
} from './entries.mjs';
import { gitIn } from './git.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { generateQueue, loadAll } from './queue.mjs';
import { entryOfBranch, mergedBranch } from './landing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const VALUED = ['--wait', '--trailer', '--base', '--owner', '--branch', '--from', '--leads-to'];
const asJson = argv.includes('--json');
// The third word is a claim's milestone, or a resolution's verdict.
const [cmd, rawId, third, ...surplus] = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const milestone = cmd === 'resolve' ? undefined : third;
// `file` names a register; its entry's ID is allocated once the lock is held.
const INTAKE = { P: BACKLOG, B: BUGS, A: ASSUMPTIONS, D: DECISIONS };
const LETTER = cmd === 'file' ? rawId?.toUpperCase().replace(/-$/, '') ?? null : null;
let ID = cmd === 'file' ? null : rawId?.toUpperCase() ?? null;
// What a message calls the entry before it has an ID.
const NAME = () => ID ?? `a new ${LETTER}`;

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
  `       node scripts/ship.mjs resolve <A-n> verified|refuted|moot --from <file> ${COMMON}`,
  `       node scripts/ship.mjs decide <D-n> --owner "<their word>" --leads-to <P#|—> --from <file> ${COMMON}`,
  `       node scripts/ship.mjs file <P|B|A|D> --owner "<their approval>" --from <draft> ${COMMON}`,
].join('\n');
if (!['claim', 'shipped', 'fixed', 'reject', 'resolve', 'decide', 'file'].includes(cmd) || !rawId || surplus.length) done(2, 'error', usage);
const SETTLES = { resolve: ASSUMPTIONS, decide: DECISIONS }[cmd];
const REG = cmd === 'file' ? INTAKE[LETTER] ?? null
  : SETTLES ? (SETTLES.idPattern.test(ID) ? SETTLES : null) : buildableRegister(ID);
if (!REG) {
  done(2, 'error', cmd === 'file'
    ? `file takes the register to file into, P, B, A or D; got "${rawId}". (An experiment is filed by /research.)\n${usage}`
    : `"${rawId}" is not ${SETTLES ? `an ${SETTLES === ASSUMPTIONS ? 'assumption (A-n)' : 'decision (D-n)'}` : 'a buildable id (P# or B#)'}.\n${usage}`);
}
const VERDICTS = ['verified', 'refuted', 'moot'];
const verdict = cmd === 'resolve' ? third?.toLowerCase() : null;
if (cmd === 'resolve' && !VERDICTS.includes(verdict)) {
  done(2, 'error', `resolve needs the verdict, ${VERDICTS.join(', ')}; got ${third ?? 'nothing'}. (\`moved\` stays a hand edit: it repoints other entries.)\n${usage}`);
}
const MILESTONE = milestone?.toUpperCase() ?? null;
if (MILESTONE && cmd === 'decide') done(2, 'error', `decide takes no third word; the feature that carries the decision goes in --leads-to.\n${usage}`);
if (MILESTONE && cmd === 'file') done(2, 'error', `file takes no third word: the ID is allocated, and the draft holds the rest.\n${usage}`);
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
const fromArg = opt('--from');
const leadsTo = opt('--leads-to')?.trim().toUpperCase() ?? null;

// What each command may be given, checked before anything is read or locked.
if (cmd === 'claim' && (owner !== null || clears || branchArg)) done(2, 'error', `a claim takes no --owner, --clears or --branch.\n${usage}`);
if (!SETTLES && cmd !== 'file' && (fromArg !== null || leadsTo !== null)) done(2, 'error', `only resolve, decide and file take --from, and only decide --leads-to.\n${usage}`);
if (cmd === 'file' && (clears || branchArg || leadsTo !== null)) done(2, 'error', `file takes no --clears, --branch or --leads-to: the draft holds the header.\n${usage}`);
if (cmd === 'file' && fromArg === null) done(2, 'error', `file needs --from <draft>: the approved draft, header and sections.\n${usage}`);
if (cmd === 'file' && owner === null) {
  done(1, 'refused', `a draft is filed once the owner approves it: pass their approval as --owner "<their words>".`);
}
if (cmd === 'resolve' && (owner !== null || clears || leadsTo !== null || branchArg)) {
  done(2, 'error', `resolve takes no --owner, --clears, --leads-to or --branch: anyone who settles an assumption records it.\n${usage}`);
}
if (cmd === 'decide' && (clears || branchArg)) done(2, 'error', `decide takes no --clears or --branch.\n${usage}`);
if (SETTLES && fromArg === null) done(2, 'error', `${cmd} needs --from <file> holding the sections it writes.\n${usage}`);
// `—` is "no change follows"; anything else is the features that carry the decision.
if (cmd === 'decide' && leadsTo !== null && !/^(—|P\d+(, ?P\d+)*)$/.test(leadsTo)) {
  done(2, 'error', `--leads-to takes the P# that carries the decision, or — for none; got "${leadsTo}".`);
}
if (cmd === 'decide' && owner === null) {
  done(1, 'refused', `${ID} is decided on the owner's word only: recording a choice they did not make invents product direction. Pass it as --owner "<their words>".`);
}
if (cmd === 'decide' && leadsTo === null) done(2, 'error', `decide needs --leads-to <P#|—>: the decision's consequence gets an owner, or none.\n${usage}`);
if (cmd === 'shipped' && REG !== BACKLOG) done(2, 'error', `only a feature is shipped; a bug is \`fixed\`.\n${usage}`);
if (cmd === 'fixed' && REG !== BUGS) done(2, 'error', `only a bug is fixed; a feature is \`shipped\`.\n${usage}`);
if (cmd === 'fixed' && owner !== null && clears) done(2, 'error', `fixed takes --owner or --clears, not both: say whose word it is.\n${usage}`);
if (cmd !== 'fixed' && clears) done(2, 'error', `only fixed takes --clears.\n${usage}`);
if (cmd !== 'fixed' && branchArg) done(2, 'error', `only fixed takes --branch.\n${usage}`);
if (cmd === 'shipped' && owner === null) {
  done(1, 'refused', `${ID} is not shipped without the owner's word: \`shipped\` is their verdict on the Accept criteria. Pass it as --owner "<which criteria they accepted, on what>".`);
}
if (cmd === 'fixed' && owner === null && !clears) {
  done(1, 'refused', `${ID} is fixed on the owner's word (--owner "<note>") or when its landing report clears it (--clears, D-7); this call gave neither.`);
}
if (cmd === 'reject' && owner === null) {
  done(1, 'refused', `a rejection is the owner's verdict: pass what failed, in their words, as --owner "<what failed>".`);
}

// A `## ` line inside a code fence is text, not a heading, as parseEntry reads it.
const headingsOf = (lines) => {
  let fenced = false;
  return lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    return fenced ? null : /^##\s+(.+?)\s*$/.exec(l)?.[1] ?? null;
  });
};

// The sections --from holds, read before anything is locked: exactly the ones this
// command writes, each with a body, and nothing before the first. A stray heading
// would land in the entry as a section nobody checked.
const WANTS = { resolve: ['Resolution'], decide: ['Decided', 'Why', 'Reopen if'] }[cmd] ?? [];
const sections = new Map();
const fromPath = fromArg === null ? null : resolve(fromArg);
const readFrom = () => {
  try { return readFileSync(fromPath, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch (e) { return done(2, 'error', `--from: cannot read ${fromArg} (${e.code ?? e.message}).`); }
};

// The header keys a draft may carry: what the drafter chooses. `id:`, the opening
// status and the date are the script's to write; the closing keys come with a flip.
const DRAFT_KEYS = new Map([[BACKLOG, ['title', 'epic', 'plan', 'depends_on', 'resolves']], [BUGS, ['title', 'severity', 'depends_on']],
  [ASSUMPTIONS, ['title']], [DECISIONS, ['title', 'waiting_on']]]);
const draft = { header: new Map(), body: null };
if (fromPath && cmd === 'file') {
  const lines = readFrom().split('\n');
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close < 0) done(1, 'refused', `--from: ${fromArg} has no \`---\` header; a draft opens with one holding its title and the keys its drafter chose.`);
  const allowed = DRAFT_KEYS.get(REG);
  for (const line of lines.slice(1, close)) {
    if (!line.trim()) continue;
    const m = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!m) done(1, 'refused', `--from: ${fromArg} has a header line that is not \`key: value\`: "${line}".`);
    if (!allowed.includes(m[1])) {
      done(1, 'refused', `--from: ${fromArg} sets \`${m[1]}:\`, which a ${LETTER} draft does not carry (it may carry ${allowed.join(', ')}); \`id:\`, the status and the date are written here.`);
    }
    if (draft.header.has(m[1])) done(1, 'refused', `--from: ${fromArg} sets \`${m[1]}:\` twice.`);
    if (!m[2]) done(1, 'refused', `--from: ${fromArg} has an empty \`${m[1]}:\`.`);
    draft.header.set(m[1], m[2]);
  }
  if (!draft.header.has('title')) done(1, 'refused', `--from: ${fromArg} has no \`title:\`.`);
  const body = lines.slice(close + 1);
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const heads = headingsOf(body);
  if (!heads[0]) done(1, 'refused', `--from: ${fromArg} has ${body.length ? 'text before its first `## ` section' : 'no sections'}; the body is the draft's sections, copied as written.`);
  draft.body = `${body.join('\n')}\n`;
} else if (fromPath) {
  const lines = readFrom().split('\n');
  const heads = headingsOf(lines);
  let current = null;
  for (const [i, line] of lines.entries()) {
    if (heads[i]) {
      current = heads[i];
      if (sections.has(current)) done(1, 'refused', `--from: ${fromArg} has \`## ${current}\` twice.`);
      sections.set(current, []);
    } else if (current) sections.get(current).push(line);
    else if (line.trim()) done(1, 'refused', `--from: ${fromArg} has text before its first heading; it holds only ${WANTS.map((w) => `\`## ${w}\``).join(', ')}.`);
  }
  for (const [name, body] of sections) sections.set(name, body.join('\n').trim());
  const extra = [...sections.keys()].filter((s) => !WANTS.includes(s));
  const missing = WANTS.filter((w) => !sections.get(w));
  if (extra.length || missing.length) {
    done(1, 'refused', `--from: ${fromArg} must hold ${WANTS.map((w) => `\`## ${w}\``).join(', ')}, each with a body${missing.length ? `; missing or empty: ${missing.join(', ')}` : ''}${extra.length ? `; not written by ${cmd}: ${extra.join(', ')}` : ''}.`);
  }
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

// A --from file the checkout sees as a change would read as another task's state below;
// say what it is instead. An ignored or committed file is fine.
const fromRel = fromPath && relative(top, fromPath);
if (fromPath && fromRel !== '..' && !fromRel.startsWith(`..${sep}`) && !isAbsolute(fromRel) && git('status', '--porcelain', '--', fromRel)) {
  done(1, 'refused', `--from: ${fromArg} is uncommitted work in the main checkout; write it outside (a scratch directory).`);
}

const verb = { claim: 'claiming', shipped: 'shipping', fixed: 'fixing', reject: 'rejecting', resolve: 'resolving', decide: 'deciding', file: 'filing' }[cmd];
const refuseIfDirty = () => {
  const d = git('status', '--porcelain');
  if (d === null) done(2, 'error', `git status failed: ${git.firstError()}`);
  if (d) done(1, 'refused', `the main checkout has uncommitted changes:\n${d.split('\n').map((l) => `  ${l}`).join('\n')}\nCommit them as their own unit (or ask whose they are) before ${verb} ${NAME()}.`);
};
refuseIfDirty();

// The lock, through land.mjs: one implementation of who holds it and when it is stale.
// An intake has no ID yet, and two sessions filing into one register must not share an
// owner name: the second would read the first's lock as its own.
const land = (...args) => spawnSync(process.execPath, [join(HERE, 'land.mjs'), ...args, '--base', BASE], { cwd: top, encoding: 'utf8' });
const OWNER = cmd === 'file' ? `ship:file-${LETTER}-${process.pid}` : `${cmd === 'claim' ? 'claim' : 'ship'}:${ID}`;
const status = land('lock', 'status', '--json');
let holder = null;
try { holder = status.status === 0 ? JSON.parse(status.stdout || 'null')?.owner ?? null : null; } catch { /* unreadable: take it below */ }
// /land runs a terminal flip while the entry's own branch holds the lock, between
// `merge` and `finish`: that landing's lock covers this write, so it is not taken again.
const underLanding = cmd !== 'claim' && cmd !== 'file' && !!holder && (holder === branchArg || entryOfBranch(holder) === ID);
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

const today = localToday();
let rel;
let entry;
let was;
if (cmd === 'file') {
  // The next free ID: one past the highest the register holds on the trunk, read under
  // the lock so no other intake can take the same number.
  if (git('cat-file', '-e', `${BASE}:${REG.readme}`) === null) {
    done(1, 'refused', `${REG.dir} is not adopted on ${BASE} (no ${REG.readme}), so there is no register to file into.`);
  }
  const names = (git('ls-tree', '--name-only', `${BASE}:${REG.dir}`) ?? '').split('\n');
  const prefix = LETTER === 'A' || LETTER === 'D' ? `${LETTER}-` : LETTER;
  const taken = names.map((n) => n.replace(/\.md$/, '')).filter((n) => REG.idPattern.test(n)).map((n) => Number(n.slice(prefix.length)));
  ID = `${prefix}${Math.max(0, ...taken) + 1}`;
  rel = `${REG.dir}/${ID}.md`;
} else {
  // The entry, read from the trunk — never a stale copy.
  rel = `${REG.dir}/${ID}.md`;
  const text = git('show', `${BASE}:${rel}`);
  if (text === null) done(1, 'refused', `${ID} has no entry on ${BASE} — untriaged ideas go to /triage first.`);
  entry = parseEntry(text, REG.keys);
  was = entry.header.status;
  if (!was) done(1, 'refused', `${rel} on ${BASE} has no readable \`status:\` header. Run npm run check:docs for what is wrong with it.`);
}
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
if (cmd === 'file') {
  // The header in the register's own key order; the body exactly as drafted.
  const opening = REG === BACKLOG ? 'proposed' : 'open';
  const own = { id: ID, status: opening, [REG.dated]: today };
  const header = Object.keys(REG.keys).filter((k) => k in own || draft.header.has(k)).map((k) => `${k}: ${own[k] ?? draft.header.get(k)}`);
  plan = {
    text: ['---', ...header, '---', '', draft.body].join('\n'),
    subject: `docs: file ${ID} (${ID})`, body: `${draft.header.get('title')}\n\nFiled on the owner's approval: ${owner.trim()}`,
    said: `${ID} filed`, action: 'filed',
  };
} else if (cmd === 'claim') {
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
} else if (SETTLES) {
  if (was !== 'open') {
    done(1, 'refused', `${ID} is \`${was}\` on ${BASE}, not \`open\`: it was settled already. Reopening or replacing it is a hand edit through /ship.`);
  }
  const header = cmd === 'resolve'
    ? { status: verdict, resolved: today }
    : { status: 'decided', decided: today, leads_to: leadsTo };
  const said = cmd === 'resolve' ? `${ID} ${verdict}` : `${ID} decided`;
  plan = {
    set: header, keyAt: 'end', drop: cmd === 'decide' ? ['waiting_on'] : [], sections: WANTS.map((w) => [w, sections.get(w)]),
    subject: `docs: ${said} (${ID})`, said, action: cmd === 'resolve' ? verdict : 'decided',
    body: cmd === 'decide' ? `On the owner's word: ${owner.trim()}` : null,
  };
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

/**
 * The entry's text with `set` applied to its header, `drop` taken out of it, `sections`
 * appended, and `note` added to its Notes. A new key goes beside `status:`
 * (`keyAt: 'status'`, the backlog and bugs) or closes the header (`'end'`, the
 * assumptions and decisions, as their templates write it).
 */
function edited(source, { set, drop = [], sections = [], note = null, keyAt = 'status' }) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(eol);
  const end = () => lines.indexOf('---', 1);
  const inHeader = (key) => lines.findIndex((l, i) => i > 0 && i < end() && l.startsWith(`${key}:`));
  if (lines[0] !== '---' || end() < 0 || inHeader('status') < 0) done(1, 'refused', `${rel} has no \`status:\` line in its header to flip.`);
  for (const key of drop) { const at = inHeader(key); if (at >= 0) lines.splice(at, 1); }
  let after = inHeader('status');
  for (const [key, value] of Object.entries(set)) {
    const at = inHeader(key);
    if (at >= 0) lines[at] = `${key}: ${value}`;
    else lines.splice(keyAt === 'end' ? end() : ++after, 0, `${key}: ${value}`);
  }
  if (sections.length) {
    const heads = headingsOf(lines);
    const taken = sections.filter(([name]) => heads.includes(name)).map(([name]) => name);
    if (taken.length) done(1, 'refused', `${rel} already has ${taken.map((n) => `\`## ${n}\``).join(', ')}; edit it by hand rather than write a second.`);
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const [name, body] of sections) lines.push('', `## ${name}`, '', ...body.split('\n'));
    lines.push('');
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

write(rel, plan.text ?? edited(readFileSync(join(top, rel), 'utf8'), plan));

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

const message = [plan.subject, plan.note, plan.body, trailer].filter(Boolean).join('\n\n');
// Staged first, so a file this run created can be committed; unstaged again on failure,
// before the put-backs run (they run last-pushed first).
if (git('add', '--', ...written) === null) done(2, 'error', `git add failed, so nothing was committed: ${git.firstError()}`);
cleanup.edits.push(() => git('reset', '-q', '--', ...written));
if (git('commit', '-q', '-m', message, '--', ...written) === null) {
  done(1, 'refused', `the commit failed, so ${{ claim: `${ID} is unclaimed`, file: 'nothing was filed' }[cmd] ?? `${ID} is unchanged`} and the files are put back. git: ${git.error()}`);
}
cleanup.edits = [];

// The sweep, after the commit. An open dependent drafted before today was refused
// above as stale, so what it can still name is a shipped entry resting on a refuted
// assumption. It only reports; a failed sweep never undoes the commit.
let sweep = '';
let sweepJson;
if (SETTLES) {
  const g = spawnSync(process.execPath, [join(HERE, 'groom.mjs'), '--for', ID, '--json', '--base', BASE], {
    cwd: top, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: top },
  });
  try { sweepJson = g.status === 2 ? null : JSON.parse(g.stdout); } catch { sweepJson = null; }
  if (sweepJson === null || sweepJson === undefined) {
    sweep = `\nThe sweep never ran (groom.mjs --for ${ID} exit ${g.status}): run it by hand.${g.stderr ? ` ${g.stderr.trim()}` : ''}`;
  } else if (!sweepJson.dependents.length) {
    sweep = '\nSweep: no entry still owes it a sweep.';
  } else {
    const list = sweepJson.dependents.map((d) => `${d.id} (${d.status})`).join(', ');
    sweep = `\nSweep: ${list} depend${sweepJson.dependents.length === 1 ? 's' : ''} on it.${verdict === 'refuted' ? ' It was refuted: they may now be void, which is the case worth stopping over.' : ''}\n  → ${sweepJson.advice}`;
  }
}
done(0, plan.action, `${plan.said} on ${BASE} (${git('rev-parse', '--short', 'HEAD')}).${written.length > 1 ? ` Also wrote ${written.slice(1).join(', ')}.` : ''}${cleared ? ` The land lock: ${cleared.slice(1, -1)}.` : ''}${sweep}`,
  { commit: git('rev-parse', 'HEAD'), files: written, ...(SETTLES ? { sweep: sweepJson ? { dependents: sweepJson.dependents, advice: sweepJson.advice } : null } : {}) });
