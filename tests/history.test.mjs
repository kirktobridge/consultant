// history — an entry's story read back out of git, against real repositories.
//
// The fixture replays the shape every entry goes through on its way through the loop:
// claim on main, build commit carrying the close report, --no-ff merge, landing note.
// What matters is the order and that the close report comes back whole — that is the
// part a reader would otherwise have had to go and find in `git log`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { project, gitInit, run, out, tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const history = (dir, args = []) => run('history.mjs', args, { cwd: dir });

/** A project whose P7 went claim → build → merge → land, plus noise around it. */
function lifecycle() {
  const dir = project();
  const g = gitInit(dir);
  const commit = (...msgs) => g.sh(`git commit -q --allow-empty ${msgs.map((m) => `-m "${m}"`).join(' ')}`);
  commit('docs: claim P7 in-progress');
  g.checkout('feat/p7-thing', true);
  commit(
    'feat: the thing (P7)',
    'Accept, per criterion:\n- \\"the thing is visible\\" OBSERVED.',
    'Co-Authored-By: Someone <x@example.com>',
  );
  g.checkout('main');
  g.sh(`git merge -q --no-ff feat/p7-thing -m "Merge branch 'feat/p7-thing' (P7)"`);
  commit('docs: P7 landed, awaiting acceptance');
  commit('docs: intake P70 (a different entry)');
  return { dir, g, commit };
}

describe('one entry', () => {
  test('claim, build commit with its close report, merge, and landing note, in order', () => {
    const { dir } = lifecycle();
    const r = history(dir, ['P7']);
    assert.equal(r.code, 0, out(r));
    const at = (s) => {
      const i = r.stdout.indexOf(s);
      assert.ok(i >= 0, `missing: ${s}\n${r.stdout}`);
      return i;
    };
    const order = [
      at('docs: claim P7 in-progress'),
      at('feat: the thing (P7)'),
      at('"the thing is visible" OBSERVED.'),
      at("[merge] Merge branch 'feat/p7-thing' (P7)"),
      at('docs: P7 landed'),
    ];
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `out of order:\n${r.stdout}`);
  });

  test('a longer ID that starts the same is not this entry', () => {
    const r = history(lifecycle().dir, ['P7']);
    assert.doesNotMatch(r.stdout, /P70/);
  });

  test('commit trailers are dropped — they are not part of the report', () => {
    assert.doesNotMatch(history(lifecycle().dir, ['P7']).stdout, /Co-Authored-By/);
  });

  test('the ID is case-insensitive on the command line', () => {
    assert.match(history(lifecycle().dir, ['p7']).stdout, /## P7 — 4 commit\(s\)/);
  });
});

describe('every entry', () => {
  test('with no ID, each entry gets its own section in ID order', () => {
    const r = history(lifecycle().dir);
    assert.equal(r.code, 0, out(r));
    assert.ok(r.stdout.indexOf('## P7 —') < r.stdout.indexOf('## P70 —'), r.stdout);
  });
});

describe('unmerged branches', () => {
  test('are listed with their latest commit message', () => {
    const { dir, g, commit } = lifecycle();
    g.checkout('feat/p9-half-done', true);
    commit('wip: half of the parser', 'Next: the error path; tests red on purpose.');
    g.checkout('main');
    const r = history(dir);
    assert.match(r.stdout, /## Unmerged into main — 1 branch\(es\)/);
    assert.match(r.stdout, /feat\/p9-half-done/);
    assert.match(r.stdout, /Next: the error path; tests red on purpose\./);
  });

  test('a merged branch is not listed as unmerged', () => {
    const { dir } = lifecycle();
    assert.match(history(dir).stdout, /## Unmerged into main — 0 branch\(es\)/);
  });

  test('asking for one entry shows only that entry\'s unmerged branch', () => {
    const { dir, g, commit } = lifecycle();
    g.checkout('feat/p9-half-done', true);
    commit('wip');
    g.checkout('main');
    g.checkout('feat/p8-other', true);
    commit('wip');
    g.checkout('main');
    const r = history(dir, ['P9']);
    assert.match(r.stdout, /feat\/p9-half-done/);
    assert.doesNotMatch(r.stdout, /feat\/p8-other/);
  });
});

describe('an empty answer is not a silent one (L3)', () => {
  test('an ID no commit names exits 1 and says how much it searched', () => {
    const r = history(lifecycle().dir, ['P42']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no commit subject names P42 \(scanned \d+ commit/);
  });

  test('a non-repo exits 2', () => {
    const r = history(tempDir());
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not a git repository/);
  });

  test('--base names the integration branch, and does not swallow the ID', () => {
    const r = history(lifecycle().dir, ['--base', 'main', 'P7']);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /## P7 — 4 commit\(s\)/);
  });
});
