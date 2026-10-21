// Every script that takes `--base <branch>` refuses one that names nothing (B1).
//
// session-audit took `--base mian` on trust and reported the repo clean against a
// branch it never read. The rule is trunk.mjs's trunkFromArgv; this suite finds the
// scripts that read `--base` (or call trunkFromArgv) from their source, so a new one
// can't skip the rule by not being listed.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, P, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles } from './helpers/fixture.mjs';

after(cleanupAll);

// The arguments each script needs to reach its trunk resolution.
const ARGS = {
  'claims.mjs': [],
  'commit-ids.mjs': ['--history'],
  'history.mjs': ['P1'],
  'land.mjs': ['lock', 'status'],
  'next.mjs': [],
  'session-audit.mjs': [],
  'status.mjs': [],
  'trunk.mjs': [],
  'worktree.mjs': ['start', 'P1'],
};
/** Takes `--base <ref>` — any commit, a tag included — by design. Its own tests hold it. */
const EXEMPT = { 'review.mjs': 'any commit is a valid base' };

const takesBase = readdirSync(join(REPO, 'scripts'))
  .filter((f) => f.endsWith('.mjs') && /["'`]--base["'`]|trunkFromArgv\(/.test(readFileSync(join(REPO, 'scripts', f), 'utf8')))
  .sort();

function repo(base = 'main') {
  const dir = tempDir();
  writeFiles(dir, renderFiles({ backlog: [P('P1', { status: 'in-progress' })] }));
  gitInit(dir, base);
  return dir;
}

describe('a --base that names nothing stops the script (B1)', () => {
  test('the scripts found are the ones listed — the discovery is not silently empty', () => {
    assert.ok(takesBase.includes('session-audit.mjs'), `discovery found: ${takesBase.join(', ')}`);
    assert.deepEqual(takesBase.filter((f) => !(f in EXEMPT)), Object.keys(ARGS).sort(),
      'a script reads --base but is not listed here: add it to ARGS (or EXEMPT, saying why)');
  });

  test('the repro: session-audit --base mian no longer reports clean', () => {
    const r = run('session-audit.mjs', ['--base', 'mian'], { cwd: repo() });
    assert.equal(r.code, 2, out(r));
    assert.doesNotMatch(r.stdout, /clean/);
    assert.match(r.stderr, /--base mian is not a local branch/);
    assert.match(r.stderr, /Pass --base <branch>/);
  });

  for (const script of Object.keys(ARGS)) {
    test(`${script}: an unknown --base exits 2 and says how to name the trunk`, () => {
      const r = run(script, [...ARGS[script], '--base', 'mian'], { cwd: repo() });
      assert.equal(r.code, 2, out(r));
      assert.match(r.stderr, /--base mian is not a local branch \(branches: main\)\. Pass --base <branch> to name it\./);
    });

    test(`${script}: a bare --base exits 2, never falls back to the default`, () => {
      // Last on the line, and followed by another flag: both are a --base with no value.
      for (const tail of [['--base'], ['--base', '--json']]) {
        const r = run(script, [...ARGS[script], ...tail], { cwd: repo() });
        assert.equal(r.code, 2, `${tail.join(' ')}\n${out(r)}`);
        // Under --json a script may report its error on stdout, as JSON; either stream counts.
        assert.match(out(r), /--base needs a branch\. Pass --base <branch> to name it\./);
      }
    });

    test(`${script}: --base naming a real branch is honoured`, () => {
      // `develop` is no default candidate, so only an honoured --base can resolve it:
      // the same clone without the flag must stop.
      const dir = repo('develop');
      const without = run(script, ARGS[script], { cwd: dir });
      assert.equal(without.code, 2, out(without));
      assert.match(without.stderr, /no integration branch found/);
      const r = run(script, [...ARGS[script], '--base', 'develop'], { cwd: dir });
      assert.notEqual(r.code, 2, out(r));
    });
  }
});
