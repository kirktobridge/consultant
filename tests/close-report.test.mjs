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
    assert.match(r.stdout, /^<review\.mjs's plain-output `review:` line>$/m);
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
