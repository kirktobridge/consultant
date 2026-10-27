// ship.mjs claim (P55 R0): a claim is one checked commit on the trunk, under the land
// lock, or nothing at all. Every case is a real repo and a real subprocess, because the
// exit codes, the wording and what is left in the tree are the interface.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { P, B, A, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles } from './helpers/fixture.mjs';

after(cleanupAll);

function repo(state = {}) {
  const dir = tempDir();
  writeFiles(dir, renderFiles(state));
  return { dir, ...gitInit(dir) };
}

const ship = (dir, ...args) => run('ship.mjs', args, { cwd: dir });
const land = (dir, ...args) => run('land.mjs', args, { cwd: dir });
const sh = (dir, c) => execSync(c, { cwd: dir, encoding: 'utf8' }).trim();
const statusOf = (dir, rel) => /^status: (.*)$/m.exec(readFileSync(join(dir, rel), 'utf8'))[1];
const lockFile = (dir) => join(dir, '.git', 'loop-land.lock');
const commits = (dir) => Number(sh(dir, 'git rev-list --count HEAD'));

describe('ship.mjs claim makes the claim commit (P55 R0)', () => {
  test('a proposed feature is claimed in one commit that touches only its entry', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2')] });
    const r = ship(dir, 'claim', 'p1', '--trailer', 'Co-Authored-By: Someone <x@example.com>');
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /P1 claimed on main/);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'in-progress');
    assert.equal(sh(dir, 'git show --name-only --format= HEAD'), 'docs/backlog/P1.md');
    assert.equal(sh(dir, 'git log -1 --format=%B'), 'docs: claim P1 (P1)\n\nCo-Authored-By: Someone <x@example.com>');
    assert.equal(sh(dir, 'git status --porcelain'), '');
    assert.ok(!existsSync(lockFile(dir)), 'the lock is released');
  });

  test('an open bug is claimed the same way', () => {
    const { dir } = repo({ bugs: [B('B1')] });
    const r = ship(dir, 'claim', 'B1');
    assert.equal(r.code, 0, out(r));
    assert.equal(statusOf(dir, 'docs/bugs/B1.md'), 'in-progress');
    assert.equal(sh(dir, 'git log -1 --format=%B'), 'docs: claim B1 (B1)');
  });

  test('a partial feature is claimed again for its next milestone, which the subject names', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'partial' })] });
    const r = ship(dir, 'claim', 'P1', 'r1');
    assert.equal(r.code, 0, out(r));
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'in-progress');
    assert.equal(sh(dir, 'git log -1 --format=%s'), 'docs: claim P1 R1 (P1)');
  });

  test('a stale lock cleared on the way is reported', () => {
    const { dir } = repo();
    land(dir, 'lock', 'take', 'feat/p9-gone'); // a branch that doesn't exist: stale
    const r = ship(dir, 'claim', 'P1');
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /The land lock: cleared a stale lock left by feat\/p9-gone/);
  });

  test('a lock this claim already held is left held', () => {
    const { dir } = repo();
    assert.equal(land(dir, 'lock', 'take', 'claim:P1').code, 0);
    assert.equal(ship(dir, 'claim', 'P1').code, 0);
    assert.equal(JSON.parse(readFileSync(lockFile(dir), 'utf8')).owner, 'claim:P1');
  });
});

describe('ship.mjs claim refuses, names why, and leaves the tree as it was', () => {
  const refused = (dir, r, why) => {
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, why);
    assert.equal(sh(dir, 'git status --porcelain'), '');
    assert.ok(!existsSync(lockFile(dir)), 'the lock is released');
  };

  test('an entry already in progress', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    refused(dir, ship(dir, 'claim', 'P1'), /already claimed: it is `in-progress`/);
  });

  test('a closed entry', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'shipped', shipped: '2026-08-02' }), P('P2')] });
    refused(dir, ship(dir, 'claim', 'P1'), /`shipped` on main, which is closed/);
  });

  test('a header the trunk cannot parse (here CRLF) is unknown, not unclaimed', () => {
    const { dir, commitAll } = repo();
    const rel = 'docs/backlog/P1.md';
    writeFileSync(join(dir, rel), readFileSync(join(dir, rel), 'utf8').replace(/\n/g, '\r\n'));
    commitAll('crlf');
    refused(dir, ship(dir, 'claim', 'P1'), /no readable `status:` header\. Run npm run check:docs/);
  });

  test('no entry at all', () => {
    const { dir } = repo();
    refused(dir, ship(dir, 'claim', 'P9'), /P9 has no entry on main — untriaged ideas go to \/triage/);
  });

  test('an unmet dependency, named with its status', () => {
    const { dir } = repo({ backlog: [P('P1', { dependsOn: ['P2', 'A-1'] }), P('P2')], assumptions: [A('A-1')] });
    const before = commits(dir);
    refused(dir, ship(dir, 'claim', 'P1'), /P1 depends on P2 \(`proposed`\), A-1 \(`open`\) on main\. Build what it depends on first; an open assumption needs its Resolution\./);
    assert.equal(commits(dir), before);
  });

  test('a moved assumption: the refusal says to re-point, not to settle it (B10)', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'moved', resolved: '2026-08-02', movedTo: ['A-2'], resolution: 'moved.' }), A('A-2')],
    });
    const r = ship(dir, 'claim', 'P1');
    refused(dir, r, /re-point its `depends_on:` via \/ship: A-1 → A-2/i);
    assert.doesNotMatch(r.stderr, /needs its Resolution/);
  });

  test('a dirty tree, before the lock is even taken', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'stray.txt'), 'x');
    const r = ship(dir, 'claim', 'P1');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /uncommitted changes:\n {2}\?\? stray.txt/);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'proposed');
    assert.ok(!existsSync(lockFile(dir)));
  });

  test('the lock held by another owner', () => {
    const { dir } = repo();
    land(dir, 'lock', 'take', 'claim:P9');
    const r = ship(dir, 'claim', 'P1', '--wait', '0');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /could not take the land lock\. held by claim:P9/);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'proposed');
    assert.equal(JSON.parse(readFileSync(lockFile(dir), 'utf8')).owner, 'claim:P9', 'another owner\'s lock is not released');
  });

  test('a schema check that would be red after the claim: the file is put back', () => {
    const { dir, commitAll } = repo({ backlog: [P('P1'), P('P2')] });
    writeFileSync(join(dir, 'docs/backlog/QUEUE.md'), '# Queue\n\n1. P2 — hand-edited\n');
    commitAll('a queue the generator would not write');
    refused(dir, ship(dir, 'claim', 'P1'), /schema check is red with P1 claimed, so nothing was committed/);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'proposed');
  });

  test('a commit the hooks reject: the file is put back', () => {
    const { dir } = repo();
    const hook = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho suite red\nexit 1\n'); // on stdout, as many runners report
    chmodSync(hook, 0o755);
    refused(dir, ship(dir, 'claim', 'P1'), /the commit failed, so P1 is unclaimed[\s\S]*suite red/);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'proposed');
  });

  test('a checkout that is not on the trunk', () => {
    const { dir, checkout } = repo();
    checkout('feat/x', true);
    refused(dir, ship(dir, 'claim', 'P1'), /on feat\/x, not main/);
  });

  test('a linked worktree', () => {
    const { dir } = repo();
    const wt = join(dir, '.claude', 'worktrees', 'w');
    sh(dir, `git worktree add -q -b feat/w "${wt}"`);
    const r = ship(wt, 'claim', 'P1');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /linked worktree/);
  });

  test('an id that is not buildable, or no command, cannot run', () => {
    const { dir } = repo();
    assert.equal(ship(dir, 'claim', 'A-1').code, 2);
    assert.equal(ship(dir).code, 2);
    assert.equal(ship(dir, 'claim', 'P1', 'later').code, 2);
  });

  test('a bare --wait is an error, never the default wait', () => {
    const { dir } = repo();
    for (const tail of [['--wait'], ['--wait', '--json']]) {
      const r = ship(dir, 'claim', 'P1', ...tail);
      assert.equal(r.code, 2, out(r));
      assert.match(out(r), /--wait needs a value/);
    }
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'proposed');
  });

  test('--json reports a usage error as JSON', () => {
    const r = ship(repo().dir, 'claim', '--json');
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.stdout).action, 'error');
  });
});
