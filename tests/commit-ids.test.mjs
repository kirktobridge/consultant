// Every commit on an entry's branch names the entry (B7): the commit-msg hook refuses
// one that doesn't, and `npm test` checks what has already landed.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, out, tempDir, cleanupAll, gitInit, REPO } from './helpers/fixture.mjs';

after(cleanupAll);

const ids = (cwd, ...args) => run('commit-ids.mjs', args, { cwd });
/** A repo on `branch`, with a commit message file holding `msg`. */
function onBranch(branch, msg) {
  const dir = tempDir();
  const g = gitInit(dir);
  if (branch) g.checkout(branch, true);
  const file = join(dir, 'MSG');
  writeFileSync(file, `${msg}\n\n# Please enter the commit message\n`);
  return { dir, file, ...g };
}

describe('commit-ids --msg, the commit-msg hook (B7)', () => {
  test('on an entry\'s branch, a subject that does not name it is refused, and says how', () => {
    const { dir, file } = onBranch('feat/p1-thing', 'feat: add the thing');
    const r = ids(dir, '--msg', file);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /on feat\/p1-thing, a commit names P1 in its subject — e\.g\. "fix: add the thing \(P1\)"/);
    assert.match(r.stderr, /--no-verify/);
  });

  test('a subject that names it passes, in each tag shape the loop uses', () => {
    for (const [branch, msg] of [['feat/p1-thing', 'feat: thing (P1)'], ['feat/p5-x', 'feat: x (P5 R1)'], ['feat/b4-y', 'fix: y (P37, B4)']]) {
      const { dir, file } = onBranch(branch, msg);
      assert.equal(ids(dir, '--msg', file).code, 0, msg);
    }
  });

  test('a feat/ branch whose name is no entry ID is not held to one', () => {
    for (const branch of ['feat/http2-support', 'feat/v2-redesign', 'feat/oauth2-login']) {
      const { dir, file } = onBranch(branch, 'feat: something');
      assert.equal(ids(dir, '--msg', file).code, 0, branch);
    }
  });

  test('the hook blocks only on a verdict, never when the check could not run', () => {
    const { dir, sh } = onBranch('feat/p1-thing', 'x');
    const hook = (file) => spawnSync('sh', [join(REPO, '.claude/hooks/commit-msg'), file], { cwd: dir, encoding: 'utf8' });
    cpSync(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true });
    sh('git add -A');
    assert.equal(hook(join(dir, 'no-such-file')).status, 0, 'exit 2 (unreadable message) must not block');
    writeFileSync(join(dir, 'BAD'), 'feat: untagged\n');
    assert.equal(hook(join(dir, 'BAD')).status, 1);
  });

  test('another ID that contains this one is not a match', () => {
    const { dir, file } = onBranch('feat/p1-thing', 'feat: thing (P11)');
    assert.equal(ids(dir, '--msg', file).code, 1);
  });

  test('subjects git writes, other branches and a detached HEAD pass', () => {
    for (const msg of ['Merge branch \'main\' into feat/p1-thing', 'fixup! feat: thing (P1)', 'Revert "feat: thing"']) {
      const { dir, file } = onBranch('feat/p1-thing', msg);
      assert.equal(ids(dir, '--msg', file).code, 0, msg);
    }
    for (const branch of [null, 'adhoc/typo']) {
      const { dir, file } = onBranch(branch, 'fix: a typo');
      assert.equal(ids(dir, '--msg', file).code, 0, String(branch));
    }
    const { dir, file, sh } = onBranch('feat/p1-thing', 'wip');
    sh('git checkout -q --detach');
    assert.equal(ids(dir, '--msg', file).code, 0);
  });

  test('the committed hook refuses a real untagged commit and lets a tagged one through', () => {
    const dir = tempDir();
    cpSync(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true });
    // Only commit-msg (and the _chain it ends in): pre-commit would run a full suite here.
    const hooks = join(tempDir(), 'hooks');
    for (const h of ['commit-msg', '_chain']) cpSync(join(REPO, '.claude/hooks', h), join(hooks, h));
    const { sh, checkout } = gitInit(dir);
    checkout('feat/p1-thing', true);
    writeFileSync(join(dir, 'x.txt'), 'x');
    sh('git add x.txt');
    const commit = (m) => spawnSync('git', ['-c', `core.hooksPath=${hooks}`, 'commit', '-q', '-m', m], { cwd: dir, encoding: 'utf8' });
    const bad = commit('feat: thing');
    assert.notEqual(bad.status, 0, bad.stderr);
    assert.match(bad.stderr, /names P1 in its subject/);
    const good = commit('feat: thing (P1)');
    assert.equal(good.status, 0, good.stderr);
  });
});

describe('commit-ids --history, run by npm test (B7)', () => {
  /** A repo whose main merged feat/p1-thing, whose commits are `subjects`. */
  function landed(subjects) {
    const dir = tempDir();
    const g = gitInit(dir);
    g.checkout('feat/p1-thing', true);
    subjects.forEach((s, n) => { writeFileSync(join(dir, `f${n}.txt`), s); g.commitAll(s); });
    g.checkout('main');
    g.merge('feat/p1-thing');
    return dir;
  }

  test('a landed branch whose commits all name the entry passes', () => {
    const r = ids(landed(['feat: a (P1)', 'feat: b (P1 R2)']), '--history');
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /OK \(2 landed branch commit\(s\) on main name their entry\)/);
  });

  test('one that does not fails, naming the commit and the entry', () => {
    const r = ids(landed(['feat: a (P1)', 'feat: forgot the tag']), '--history');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /"feat: forgot the tag" — landed as P1/);
  });

  test('commits a branch merged in from another entry are that entry\'s, not this one\'s', () => {
    const dir = tempDir();
    const g = gitInit(dir);
    g.checkout('feat/p3-base', true);
    writeFileSync(join(dir, 'p3.txt'), 'p3');
    g.commitAll('feat: groundwork (P3)');
    g.checkout('main');
    g.checkout('feat/p2-on-top', true);
    g.sh('git merge -q --no-ff feat/p3-base -m "Merge branch \'feat/p3-base\' into feat/p2-on-top"');
    writeFileSync(join(dir, 'p2.txt'), 'p2');
    g.commitAll('feat: on top (P2)');
    g.checkout('main');
    g.merge('feat/p2-on-top');
    const r = ids(dir, '--history');
    assert.equal(r.code, 0, out(r));
  });

  test('with no local trunk (a CI checkout), it reads the remote\'s', () => {
    const dir = landed(['feat: a (P1)', 'feat: forgot the tag']);
    const sh =(c) => spawnSync('sh', ['-c', c], { cwd: dir, encoding: 'utf8' });
    sh('git update-ref refs/remotes/origin/main main && git checkout -q -b feat/p9-ci && git branch -D main');
    const r = ids(dir, '--history');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /"feat: forgot the tag" — landed as P1/);
    assert.equal(ids(dir, '--history', '--base', 'mian').code, 2, 'a --base that names nothing still stops');
  });

  test('outside a repo there is nothing to check, and it says so', () => {
    const r = ids(tempDir(), '--history');
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /not a git repository — nothing to check/);
  });

  test('a bad call exits 2', () => {
    assert.equal(ids(tempDir()).code, 2);
    assert.equal(ids(tempDir(), '--msg').code, 2);
  });
});
