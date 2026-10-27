// close-report prints the close report's skeleton from the trunk's entry (P43).
//
// Each case commits registers on main and runs the real script, asserting the exit code
// and that what it quotes is the entry's own text.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { P, B, project, gitInit, run, out, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

function repo(state) {
  const dir = project({ nextUp: [], ...state });
  gitInit(dir);
  return dir;
}
const report = (dir, ...args) => run('close-report.mjs', args, { cwd: dir });
/** The quoted criteria, in order. */
const quoted = (stdout) => [...stdout.matchAll(/^- "(.*)"$/gm)].map((m) => m[1]);

describe('a feature: each Accept criterion, word for word, one per criterion', () => {
  test('every criterion is quoted, in order, with a verdict slot under each', () => {
    const accept = ['the thing is visible in the UI.', 'doing it twice is idempotent.', 'a third, with `code` and "quotes".'];
    const r = report(repo({ backlog: [P('P1', { accept })] }), 'P1');
    assert.equal(r.code, 0, out(r));
    assert.deepEqual(quoted(r.stdout), accept);
    assert.equal(r.stdout.match(/<OBSERVED \| NOT OBSERVED \| NOT EXERCISED>/g).length, 3);
    assert.match(r.stdout, /^<review\.mjs's plain-output `review:` line, and each `eval:` line it printed>$/m);
    assert.match(r.stdout, /^<`preflight: agreed`/m);
  });

  test('an unfilled slot is never read as the line it holds the place of', () => {
    const r = report(repo({ backlog: [P('P1')] }), 'P1');
    assert.doesNotMatch(r.stdout, /^(preflight|review):/m);
  });

  test('a lazy wrap and a paragraph after a blank line stay with the criterion; a trailing paragraph does not', () => {
    const accept = ['one, wrapped\nlazily.', 'two.\n\n  more of two.'];
    const dir = repo({ backlog: [P('P1', { accept, notes: null })] });
    writeFileSync(join(dir, 'docs/backlog/P1.md'), `${readFileSync(join(dir, 'docs/backlog/P1.md'), 'utf8').trimEnd()}\n\nnot a criterion.\n`);
    execSync('git commit -qam para', { cwd: dir });
    const r = report(dir, 'P1');
    assert.deepEqual(quoted(r.stdout), ['one, wrapped lazily.', 'two. more of two.']);
  });

  test('a criterion wrapped over indented lines is joined on one line, words unchanged', () => {
    const accept = ['the skeleton\'s criteria match the entry\'s Accept bullets word for word, one per\n  criterion.', 'two.'];
    const r = report(repo({ backlog: [P('P1', { accept })] }), 'P1');
    assert.deepEqual(quoted(r.stdout), ['the skeleton\'s criteria match the entry\'s Accept bullets word for word, one per criterion.', 'two.']);
  });

  test('it reads the trunk, not the checked-out branch', () => {
    const dir = repo({ backlog: [P('P1', { accept: ['on main.', 'also main.'] })] });
    execSync('git checkout -q -b feat/p1', { cwd: dir });
    writeFileSync(join(dir, 'docs/backlog/P1.md'), 'not an entry\n');
    execSync('git commit -qam branch', { cwd: dir });
    const r = report(dir, 'P1');
    assert.equal(r.code, 0, out(r));
    assert.deepEqual(quoted(r.stdout), ['on main.', 'also main.']);
  });
});

describe('a bug: its Repro and Expected, not Accept', () => {
  test('both sections are printed verbatim, each with a verdict slot', () => {
    const repro = '1. run `x --y`.\n2. it prints "nope".';
    const r = report(repo({ bugs: [B('B1', { repro, expected: 'it prints "yes".' })] }), 'B1');
    assert.equal(r.code, 0, out(r));
    assert.ok(r.stdout.includes('  1. run `x --y`.\n  2. it prints "nope".\n  <OBSERVED | NOT OBSERVED> to still break.'), r.stdout);
    assert.ok(r.stdout.includes('Expected:\n  it prints "yes".\n  <OBSERVED | NOT OBSERVED>.'), r.stdout);
    assert.doesNotMatch(r.stdout, /Accept/);
  });

  test('a bug with no Expected says so rather than inventing one', () => {
    const r = report(repo({ bugs: [B('B1')] }), 'B1');
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /^Expected: none in the entry\.$/m);
  });
});

describe('nothing to report against exits 2, saying which, with no skeleton', () => {
  const refuses = (r, why) => {
    assert.equal(r.code, 2, out(r));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, why);
  };

  test('an ID with no entry on the trunk', () => {
    refuses(report(repo({ backlog: [P('P1')] }), 'P9'), /P9 has no entry on main/);
  });

  test('an ID that is not a P# or B#', () => {
    refuses(report(repo({ backlog: [P('P1')] }), 'A-1'), /"A-1" is not a buildable id/);
    refuses(report(repo({ backlog: [P('P1')] })), /"" is not a buildable id/);
  });

  test('an entry with no Accept section', () => {
    refuses(report(repo({ backlog: [P('P1', { accept: null })] }), 'P1'), /P1 on main: it has no ## Accept section/);
  });

  test('an Accept section with no bullets', () => {
    refuses(report(repo({ backlog: [P('P1', { accept: [] })] }), 'P1'), /P1 on main: its ## Accept has no criteria/);
  });

  test('an entry that does not parse names the parse error, not a missing Accept', () => {
    const dir = repo({ backlog: [P('P1')] });
    writeFileSync(join(dir, 'docs/backlog/P1.md'), readFileSync(join(dir, 'docs/backlog/P1.md'), 'utf8').replace(/\n---\n/, '\n'));
    execSync('git commit -qam broken', { cwd: dir });
    refuses(report(dir, 'P1'), /docs\/backlog\/P1\.md on main does not parse/);
  });

  test('a bug with no Repro', () => {
    refuses(report(repo({ bugs: [B('B1', { repro: null })] }), 'B1'), /B1 on main: it has no ## Repro section/);
  });
});

// ── --check (P44) ────────────────────────────────────────────────────────────

/** A repo whose main holds P1 with `accept`, and a branch whose one commit says `message`. */
function landing(accept, message, { branch = 'feat/p1-x' } = {}) {
  const dir = repo({ backlog: [P('P1', { accept })] });
  execSync(`git checkout -q -b ${branch}`, { cwd: dir });
  commit(dir, message);
  execSync('git checkout -q main', { cwd: dir });
  return dir;
}
/** An empty commit on the checked-out branch, its message passed by file so nothing is quoted. */
function commit(dir, message) {
  writeFileSync(join(dir, '.git', 'MSG'), message);
  execSync('git commit -q --allow-empty -F .git/MSG', { cwd: dir });
}
const check = (dir, ...args) => run('close-report.mjs', ['--check', 'P1', ...args], { cwd: dir });
const ACCEPT = ['the thing is visible in the UI.', 'doing it twice is idempotent and leaves `git status` unchanged.'];
const QUOTED = 'feat: x (P1)\n\n- "the thing is visible in the UI." OBSERVED.\n- "doing it twice is idempotent and leaves `git status` unchanged." OBSERVED.\n';

describe('--check warns on a criterion the report does not quote word for word with a verdict', () => {
  test('a reworded criterion is named as ALTERED, with what the report has instead', () => {
    const msg = 'feat: x (P1)\n\nAccept:\n- "the thing is visible in the UI."\n  OBSERVED. seen.\n- "doing it twice is idempotent and leaves the status unchanged."\n  OBSERVED. ran it twice.\n';
    const r = check(landing(ACCEPT, msg));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /^ {2}ok {10}"the thing is visible in the UI\."$/m);
    assert.match(r.stdout, /^ {2}ALTERED {5}"doing it twice is idempotent and leaves `git status` unchanged\."$/m);
    assert.match(r.stdout, /the report has: "doing it twice is idempotent and leaves the status unchanged\."/);
    assert.match(r.stdout, /^warnings: 1 /m);
  });

  test('a quote that runs on past the criterion is ALTERED, not a missing verdict', () => {
    const msg = 'feat: x (P1)\n\n1. "the thing is visible in the UI, on Linux only." OBSERVED.\n2. "doing it twice is idempotent and leaves `git status` unchanged." OBSERVED.\n';
    const r = check(landing(ACCEPT, msg));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /ALTERED {5}"the thing is visible in the UI\."/);
    assert.match(r.stdout, /the report has: "the thing is visible in the UI, on Linux only\."/);
  });

  test('a newer report that rewords a criterion is not covered by an older one that quoted it', () => {
    const dir = landing(ACCEPT, QUOTED);
    execSync('git checkout -q feat/p1-x', { cwd: dir });
    commit(dir, QUOTED.replace('feat: x', 'chore: re-verified').replace('leaves `git status` unchanged', 'leaves the git status unchanged'));
    execSync('git checkout -q main', { cwd: dir });
    const r = check(dir);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /ALTERED {5}"doing it twice/);
  });

  test('a criterion left out is MISSING; one quoted under an unfilled slot has NO VERDICT', () => {
    const msg = 'feat: x (P1)\n\nAccept:\n- "the thing is visible in the UI."\n  <OBSERVED | NOT OBSERVED | NOT EXERCISED>. <evidence>\n';
    const r = check(landing(ACCEPT, msg));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /NO VERDICT {2}"the thing is visible/);
    assert.match(r.stdout, /MISSING {5}"doing it twice/);
    assert.match(r.stdout, /^warnings: 2 /m);
  });
});

describe('--check is quiet when every criterion is quoted with a verdict', () => {
  test('the skeleton\'s own layout, filled in, warns about nothing', () => {
    const msg = 'feat: x (P1)\n\nAccept:\n- "the thing is visible in the UI."\n  OBSERVED. seen.\n- "doing it twice is idempotent and leaves `git status` unchanged."\n  NOT EXERCISED — R1 owns it.\n';
    const r = check(landing(ACCEPT, msg));
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /no warnings: every criterion is quoted word for word with a verdict/);
  });

  test('line wrapping and indentation differences alone don\'t warn', () => {
    const msg = 'feat: x (P1)\n\nAccept:\n- "the thing is visible\n      in the UI."\n  **Observed.** seen.\n- "doing it twice is\n  idempotent and leaves `git status`\n  unchanged."\n      not observed: it changed.\n';
    const r = check(landing(ACCEPT, msg));
    assert.equal(r.code, 0, out(r));
  });

  test('a criterion quoted again with a verdict in a later commit counts', () => {
    const dir = landing(ACCEPT, 'feat: x (P1)\n\n- "the thing is visible in the UI."\n- "doing it twice is idempotent and leaves `git status` unchanged."\n');
    assert.equal(check(dir).code, 1);
    execSync('git checkout -q feat/p1-x', { cwd: dir });
    commit(dir, QUOTED.replace('feat: x', 'chore: re-verified'));
    execSync('git checkout -q main', { cwd: dir });
    const r = check(dir);
    assert.equal(r.code, 0, out(r));
  });
});

describe('--check: which branch, and what it cannot check', () => {
  test('the branch is found from worktree.mjs\'s naming, or named with --branch', () => {
    assert.match(check(landing(ACCEPT, QUOTED)).stdout, /feat\/p1-x against main's Accept, 1 commit\(s\) read/);
    const dir = landing(ACCEPT, QUOTED, { branch: 'mine' });
    assert.match(check(dir).stderr, /no local branch builds P1\. Name it with --branch/);
    assert.equal(check(dir, '--branch', 'mine').code, 0);
  });

  test('a branch with no commits beyond the trunk exits 2: there is no report to read', () => {
    const dir = repo({ backlog: [P('P1', { accept: ACCEPT })] });
    execSync('git branch feat/p1-x', { cwd: dir });
    const r = check(dir);
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /feat\/p1-x has no commits beyond main/);
  });

  test('a bug\'s branch that names nothing stops it', () => {
    const dir = bugLanding('fix: x (B1)');
    assert.equal(run('close-report.mjs', ['--check', 'B1', '--branch', 'typo'], { cwd: dir }).code, 2);
  });
});

// ── --check on a bug (P56) ───────────────────────────────────────────────────

const REPRO = '1. Run `tool --case --list`.\n2. It lists all 31 cases.';
const EXPECTED = 'It refuses with usage, as a bare `--skill` does.';
/** A repo whose main holds B1, and a branch whose one commit says `message`. */
function bugLanding(message, over = {}) {
  const dir = repo({ bugs: [B('B1', { repro: REPRO, expected: EXPECTED, ...over })] });
  execSync('git checkout -q -b feat/b1-x', { cwd: dir });
  commit(dir, message);
  execSync('git checkout -q main', { cwd: dir });
  return dir;
}
const checkBug = (dir) => run('close-report.mjs', ['--check', 'B1'], { cwd: dir });
/** The skeleton's layout, filled in: what /implement's close step writes for a bug. */
const filled = (repro = REPRO, expected = EXPECTED) => `fix: x (B1)\n\nRepro, re-run:\n${repro.split('\n').map((l) => `  ${l}`).join('\n')}\n  NOT OBSERVED to still break. It exits 2 now.\n\nExpected:\n  ${expected}\n  OBSERVED. Same usage message.\n\nreview: required\n`;

describe('--check on a bug grades its Repro and Expected (P56)', () => {
  test('the skeleton\'s layout, filled in, warns about nothing', () => {
    const r = checkBug(bugLanding(filled()));
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /feat\/b1-x against main's Repro and Expected, 1 commit\(s\) read/);
    assert.match(r.stdout, /^ {2}ok {10}Repro: "1\. Run `tool --case --list`\. …"$/m);
    assert.match(r.stdout, /^ {2}ok {10}Expected: "It refuses with usage/m);
    assert.match(r.stdout, /no warnings: every section is quoted word for word with a verdict/);
  });

  test('a reworded Repro is ALTERED, with what the report has under its heading', () => {
    const r = checkBug(bugLanding(filled(REPRO.replace('It lists all 31 cases.', 'It lists every case.'))));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /^ {2}ALTERED {5}Repro: /m);
    assert.match(r.stdout, /the report has: "1\. Run `tool --case --list`\. 2\. It lists every case\. NOT OBSERVED/);
    assert.match(r.stdout, /^ {2}ok {10}Expected: /m);
    assert.match(r.stdout, /^warnings: 1 — a section/m);
  });

  test('a dropped Expected is MISSING; a Repro with no verdict after it says so', () => {
    const msg = `fix: x (B1)\n\nRepro, re-run:\n${REPRO}\n  <OBSERVED | NOT OBSERVED> to still break. <evidence>\n`;
    const r = checkBug(bugLanding(msg));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /NO VERDICT {2}Repro: /);
    assert.match(r.stdout, /MISSING {5}Expected: /);
  });

  test('a bug with no Expected is checked on its Repro alone', () => {
    const r = checkBug(bugLanding(`fix: x (B1)\n\nRepro, re-run:\n  ${REPRO}\n  NOT OBSERVED to still break.\n`, { expected: null }));
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /against main's Repro, 1 commit/);
    assert.doesNotMatch(r.stdout, /Expected/);
  });

  test('a Repro of several paragraphs is read whole, and a change in its second is ALTERED', () => {
    const long = '1. Run `tool --case --list`.\n\nThe two cases it lists:\n\n2. It lists all 31 cases.';
    assert.equal(checkBug(bugLanding(filled(long), { repro: long })).code, 0);
    const r = checkBug(bugLanding(filled(long.replace('all 31', 'every')), { repro: long }));
    assert.match(r.stdout, /ALTERED {5}Repro: /);
    assert.match(r.stdout, /the report has: "1\. Run .* The two cases it lists: 2\. It lists every cases/);
  });

  test('a heading with its text on the same line is read; a repro step saying "Expected …" is not a heading', () => {
    const repro = '1. Run `tool --case --list`.\n  Expected exit 2, got 0.';
    const msg = `fix: x (B1)\n\nRepro, re-run:\n  1. Run \`tool --case --list\`.\n  Expected exit 2, got 0.\n  NOT OBSERVED to still break.\n\nExpected: It refuses with usage, as a bare \`--skill\` does not.\n  OBSERVED.\n`;
    const r = checkBug(bugLanding(msg, { repro }));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /^ {2}ok {10}Repro: /m);
    assert.match(r.stdout, /ALTERED {5}Expected: /);
    assert.match(r.stdout, /the report has: "It refuses with usage, as a bare `--skill` does not\. OBSERVED\."/);
  });

  test('a section that runs on past its text is ALTERED, not a missing verdict', () => {
    const r = checkBug(bugLanding(filled(REPRO.replace('31 cases.', '31 cases. Then it hangs.'))));
    assert.match(r.stdout, /ALTERED {5}Repro: /);
  });

  test('with no headings, a reworded section is still ALTERED, read from the whole report', () => {
    const r = checkBug(bugLanding(`fix: x (B1)\n\n1. Run \`tool --case --list\`. 2. It lists all thirty-one cases. NOT OBSERVED to still break.\nIt refuses with usage, as a bare \`--skill\` does. OBSERVED.\n`));
    assert.match(r.stdout, /ALTERED {5}Repro: /);
    assert.match(r.stdout, /^ {2}ok {10}Expected: /m);
  });

  test('a later commit that only shares words is not taken for the report', () => {
    const dir = bugLanding(filled());
    execSync('git checkout -q feat/b1-x', { cwd: dir });
    commit(dir, 'fix: tool --case --list refuses with usage like a bare --skill does (review)');
    execSync('git checkout -q main', { cwd: dir });
    const r = checkBug(dir);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /2 commit\(s\) read/);
  });

  test('a bug with no Repro has nothing to check against: exit 2', () => {
    const r = checkBug(bugLanding(filled(), { repro: null }));
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /B1 on main has no Repro to check a report against/);
  });

  test('a newer re-verified report that rewords the Repro is not covered by the older one', () => {
    const dir = bugLanding(filled());
    execSync('git checkout -q feat/b1-x', { cwd: dir });
    commit(dir, filled(REPRO.replace('all 31', 'all thirty-one')).replace('fix: x', 'chore: re-verified'));
    execSync('git checkout -q main', { cwd: dir });
    assert.match(checkBug(dir).stdout, /ALTERED {5}Repro: /);
  });
});

// ── --clears (P60, D-7) ──────────────────────────────────────────────────────

const clearsCheck = (dir, id = 'B1') => run('close-report.mjs', ['--clears', id], { cwd: dir });

describe('--clears decides whether a bug\'s report clears it (P60)', () => {
  test('the Repro not observed to still break and the Expected observed: it clears', () => {
    const r = clearsCheck(bugLanding(filled()));
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /^clears: the report quotes the Repro, not observed to still break, and the Expected, observed/m);
  });

  test('the Repro still breaking does not clear, and says so', () => {
    const r = clearsCheck(bugLanding(filled().replace('NOT OBSERVED to still break', 'OBSERVED to still break')));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /does not clear: its Repro is observed to still break, not "not observed"\. It stays in-progress: ask the owner/);
  });

  test('the Expected not observed does not clear', () => {
    const r = clearsCheck(bugLanding(filled().replace('OBSERVED. Same usage', 'NOT OBSERVED. Same usage')));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /its Expected is not observed, not "observed"/);
  });

  test('a report --check would warn about does not clear, even with the right verdicts', () => {
    const r = clearsCheck(bugLanding(filled(REPRO.replace('all 31', 'every'))));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /its Repro is ALTERED in the report/);
  });

  test('a bug with no Expected never clears: it goes to the owner', () => {
    const r = clearsCheck(bugLanding(`fix: x (B1)\n\nRepro, re-run:\n  ${REPRO}\n  NOT OBSERVED to still break.\n`, { expected: null }));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /it has no Expected, so nothing in it says what working looks like/);
  });

  test('after the merge, where /land\'s step 3 and /ship run it, it reads what the merge brought in', () => {
    const dir = bugLanding(filled());
    writeFileSync(join(dir, 'later.txt'), 'other work on main');
    execSync('git add -A && git commit -q -m "feat: other (P9)"', { cwd: dir });
    execSync('git merge -q --no-ff feat/b1-x -m "Merge branch feat/b1-x"', { cwd: dir });
    const r = clearsCheck(dir);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /feat\/b1-x against main, 1 commit\(s\) read/);
    assert.equal(checkBug(dir).code, 0, 'and --check too');
  });

  test('the last verdict on a section quoted twice is the one that counts', () => {
    const msg = `fix: x (B1)\n\n${REPRO} OBSERVED to still break, before the fix.\n${REPRO} NOT OBSERVED to still break, after it.\n${EXPECTED} OBSERVED.\n`;
    assert.equal(clearsCheck(bugLanding(msg)).code, 0);
    const flipped = `fix: x (B1)\n\n${REPRO} NOT OBSERVED to still break, on the first try.\n${REPRO} OBSERVED to still break, on a rerun.\n${EXPECTED} OBSERVED.\n`;
    assert.equal(clearsCheck(bugLanding(flipped)).code, 1);
  });

  test('a feature is refused: its shipped is the owner\'s', () => {
    const r = run('close-report.mjs', ['--clears', 'P1'], { cwd: landing(ACCEPT, QUOTED) });
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /--clears takes a bug \(B#\): P1 is a feature/);
  });
});
