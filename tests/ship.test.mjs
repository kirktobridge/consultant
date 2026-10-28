// ship.mjs claim (P55 R0): a claim is one checked commit on the trunk, under the land
// lock, or nothing at all. Every case is a real repo and a real subprocess, because the
// exit codes, the wording and what is left in the tree are the interface.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { P, B, A, D, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles } from './helpers/fixture.mjs';
import { today as localToday } from '../scripts/entries.mjs';

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

  // A crash, not a refusal: the edit throws after the lock is taken. Root ignores the
  // file mode, so there is no crash to cause there.
  test('a crash after the lock is taken still releases it', { skip: process.getuid?.() === 0 }, () => {
    const { dir } = repo();
    const rel = join(dir, 'docs/backlog/P1.md');
    chmodSync(rel, 0o444); // git tracks only the x bit: the tree stays clean
    const r = ship(dir, 'claim', 'P1');
    const j = ship(dir, 'claim', 'P1', '--json');
    chmodSync(rel, 0o644);
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /crashed, and nothing was committed: Error: EACCES/);
    assert.doesNotMatch(r.stderr, /Putting the entry back failed/, 'nothing was written, so nothing is put back');
    assert.ok(!existsSync(lockFile(dir)), 'the lock is released');
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'proposed');
    assert.equal(sh(dir, 'git status --porcelain'), '');
    assert.equal(JSON.parse(j.stdout).action, 'error', 'a --json caller still gets its object');
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

// ── Terminal flips (P55 R1) ──────────────────────────────────────────────────

const today = localToday();
const headerOf = (dir, rel, key) => new RegExp(`^${key}: (.*)$`, 'm').exec(readFileSync(join(dir, rel), 'utf8'))?.[1] ?? null;
const filesOf = (dir) => sh(dir, 'git show --name-only --format= HEAD').split('\n').sort();
const noLock = (dir) => assert.ok(!existsSync(lockFile(dir)), 'the lock is released');
const refusedFlip = (dir, r, why) => {
  assert.equal(r.code, 1, out(r));
  assert.match(r.stderr, why);
  assert.equal(sh(dir, 'git status --porcelain'), '', 'the tree is as it was');
  noLock(dir);
};
/** Merge `branch` (one empty commit saying `message`) into main as land.mjs does; the merge's short sha. */
const mergeBranch = (dir, branch, message) => {
  sh(dir, `git checkout -q -b ${branch}`);
  execSync('git commit -q --allow-empty -F -', { cwd: dir, input: message });
  sh(dir, 'git checkout -q main');
  sh(dir, `git merge -q --no-ff -m "Merge branch '${branch}'" ${branch}`);
  return sh(dir, 'git rev-parse --short HEAD');
};

describe('ship.mjs shipped: the owner accepts a feature in one commit (P55 R1)', () => {
  test('the entry, the recorded order and the queue land together, green', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2'), P('P3')], manualOrder: ['P3', 'P1', 'P2'] });
    const before = commits(dir);
    const r = ship(dir, 'shipped', 'P1', '--owner', 'all criteria observed', '--trailer', 'Co-Authored-By: X <x@example.com>');
    assert.equal(r.code, 0, out(r));
    assert.equal(commits(dir), before + 1);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'shipped');
    assert.equal(headerOf(dir, 'docs/backlog/P1.md', 'shipped'), today);
    assert.match(readFileSync(join(dir, 'docs/backlog/P1.md'), 'utf8'), new RegExp(`## Notes\\n\\nShipped ${today} on the owner's word: all criteria observed\\n$`));
    assert.equal(readFileSync(join(dir, 'docs/backlog/MANUAL-ORDER.md'), 'utf8'), '# Recorded order\n\n1. P3\n2. P2\n');
    assert.deepEqual(filesOf(dir), ['docs/backlog/MANUAL-ORDER.md', 'docs/backlog/P1.md', 'docs/backlog/QUEUE.md']);
    assert.equal(sh(dir, 'git log -1 --format=%s'), 'docs: P1 shipped (P1)');
    assert.match(sh(dir, 'git log -1 --format=%B'), /Co-Authored-By: X <x@example.com>$/);
    assert.equal(run('backlog-schema-check.mjs', ['--all'], { cwd: dir }).code, 0);
    assert.equal(sh(dir, 'git status --porcelain'), '');
    noLock(dir);
  });

  test('the note names the merge that landed the branch', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')] });
    const sha = mergeBranch(dir, 'feat/p1-x', 'feat: x (P1)');
    assert.equal(ship(dir, 'shipped', 'P1', '--owner', 'ok').code, 0);
    assert.match(readFileSync(join(dir, 'docs/backlog/P1.md'), 'utf8'), new RegExp(`Shipped ${today} on the owner's word \\(merge ${sha}\\): ok`));
  });

  test('without the owner\'s flag it is refused before anything is touched', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    refusedFlip(dir, ship(dir, 'shipped', 'P1'), /P1 is not shipped without the owner's word/);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'in-progress');
  });

  test('an entry not awaiting acceptance is refused', () => {
    const { dir } = repo({ backlog: [P('P1')] });
    refusedFlip(dir, ship(dir, 'shipped', 'P1', '--owner', 'ok'), /P1 is `proposed` on main, not `in-progress`/);
  });

  test('a dependent left presumptively stale turns the check red: every file is put back', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2', { dependsOn: ['P1'] })], manualOrder: ['P1', 'P2'] });
    const manual = readFileSync(join(dir, 'docs/backlog/MANUAL-ORDER.md'), 'utf8');
    const r = ship(dir, 'shipped', 'P1', '--owner', 'ok');
    refusedFlip(dir, r, /schema check is red with P1 shipped, so nothing was committed[\s\S]*P2 .*depends on P1, which landed .*presumptively stale/);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'in-progress');
    assert.equal(readFileSync(join(dir, 'docs/backlog/MANUAL-ORDER.md'), 'utf8'), manual);
  });
});

describe('ship.mjs fixed: on the owner\'s word, or when the report clears it (P55 R1, D-7)', () => {
  const REPRO = '1. Run `tool --case --list`.\n2. It lists all 31 cases.';
  const EXPECTED = 'It refuses with usage, as a bare `--skill` does.';
  const report = (verdict = 'NOT OBSERVED') => `fix: x (B1)\n\nRepro, re-run:\n${REPRO.split('\n').map((l) => `  ${l}`).join('\n')}\n  ${verdict} to still break. It exits 2 now.\n\nExpected:\n  ${EXPECTED}\n  OBSERVED. Same usage message.\n`;
  /** B1 in progress, its branch merged as /land merges it, and the landing record still there. */
  const landed = (message) => {
    const { dir } = repo({ bugs: [B('B1', { status: 'in-progress', repro: REPRO, expected: EXPECTED })] });
    const sha = mergeBranch(dir, 'feat/b1-x', message);
    mkdirSync(join(dir, '.git', 'loop-land'), { recursive: true });
    writeFileSync(join(dir, '.git', 'loop-land', 'feat__b1-x.json'), JSON.stringify({ branch: 'feat/b1-x', conflicts: [], pending: null }));
    return { dir, sha };
  };

  test('--clears with a report that clears it writes D-7\'s note', () => {
    const { dir, sha } = landed(report());
    const r = ship(dir, 'fixed', 'B1', '--clears');
    assert.equal(r.code, 0, out(r));
    assert.equal(statusOf(dir, 'docs/bugs/B1.md'), 'fixed');
    assert.match(readFileSync(join(dir, 'docs/bugs/B1.md'), 'utf8'),
      new RegExp(`Fixed ${today} by /land under D-7: the report clears it \\(Repro not observed to still break, Expected observed\\); merge ${sha}\\.`));
    assert.equal(sh(dir, 'git log -1 --format=%s'), 'docs: B1 fixed (B1)');
    noLock(dir);
  });

  test('inside a landing, under the branch\'s own lock, it writes without taking the lock again', () => {
    const { dir } = landed(report());
    assert.equal(land(dir, 'lock', 'take', 'feat/b1-x').code, 0);
    const r = ship(dir, 'fixed', 'B1', '--clears', '--wait', '0');
    assert.equal(r.code, 0, out(r));
    assert.equal(statusOf(dir, 'docs/bugs/B1.md'), 'fixed');
    assert.equal(JSON.parse(readFileSync(lockFile(dir), 'utf8')).owner, 'feat/b1-x', 'the landing still holds its lock');
  });

  test('--clears with a report that does not clear it is refused, naming why', () => {
    const { dir } = landed(report('OBSERVED'));
    refusedFlip(dir, ship(dir, 'fixed', 'B1', '--clears'), /B1's report does not clear it, so it stays `in-progress`/);
    assert.equal(statusOf(dir, 'docs/bugs/B1.md'), 'in-progress');
  });

  test('on the owner\'s word', () => {
    const { dir } = repo({ bugs: [B('B1', { status: 'in-progress' })] });
    const r = ship(dir, 'fixed', 'B1', '--owner', 'checked by hand');
    assert.equal(r.code, 0, out(r));
    assert.equal(statusOf(dir, 'docs/bugs/B1.md'), 'fixed');
    assert.match(readFileSync(join(dir, 'docs/bugs/B1.md'), 'utf8'), new RegExp(`Fixed ${today} on the owner's word: checked by hand`));
  });

  test('with neither flag it is refused', () => {
    const { dir } = repo({ bugs: [B('B1', { status: 'in-progress' })] });
    refusedFlip(dir, ship(dir, 'fixed', 'B1'), /this call gave neither/);
  });

  test('the wrong word for the register, or both flags, cannot run', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })], bugs: [B('B1', { status: 'in-progress' })] });
    assert.equal(ship(dir, 'fixed', 'P1', '--owner', 'x').code, 2);
    assert.equal(ship(dir, 'shipped', 'B1', '--owner', 'x').code, 2);
    assert.equal(ship(dir, 'fixed', 'B1', '--owner', 'x', '--clears').code, 2);
    assert.equal(ship(dir, 'shipped', 'P1', 'R1', '--owner', 'x').code, 2);
    assert.equal(ship(dir, 'shipped', 'P1', '--owner').code, 2);
    assert.equal(sh(dir, 'git status --porcelain'), '');
  });
});

describe('ship.mjs dates a flip by the local calendar, not UTC (B13)', () => {
  // UTC+14 and UTC-12 never share a date with UTC at the same time of day, so at any
  // hour one of these two runs would write UTC's date if ship.mjs still did.
  for (const tz of ['Etc/GMT-14', 'Etc/GMT+12']) {
    test(`in ${tz}, shipped and the schema check both read that zone's date`, () => {
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')] });
      const r = run('ship.mjs', ['shipped', 'P1', '--owner', 'ok'], { cwd: dir, env: { TZ: tz } });
      assert.equal(r.code, 0, out(r));
      assert.equal(headerOf(dir, 'docs/backlog/P1.md', 'shipped'), local);
      assert.equal(run('backlog-schema-check.mjs', ['--all'], { cwd: dir, env: { TZ: tz } }).code, 0);
    });
  }
});

describe('ship.mjs reject: the owner rejects a landing (P55 R1)', () => {
  test('it stays in progress; each rejection appends today, even twice in a day', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    assert.equal(ship(dir, 'reject', 'P1', '--owner', 'the chime is too loud').code, 0);
    assert.equal(statusOf(dir, 'docs/backlog/P1.md'), 'in-progress');
    assert.equal(headerOf(dir, 'docs/backlog/P1.md', 'rejected'), today);
    assert.equal(sh(dir, 'git log -1 --format=%s'), 'docs: P1 rejected (P1)');
    const r = ship(dir, 'reject', 'P1', '--owner', 'still too loud');
    assert.equal(r.code, 0, out(r));
    assert.equal(headerOf(dir, 'docs/backlog/P1.md', 'rejected'), `${today}, ${today}`);
    const text = readFileSync(join(dir, 'docs/backlog/P1.md'), 'utf8');
    assert.match(text, new RegExp(`Rejected ${today} on the owner's word: the chime is too loud\\n\\nRejected ${today} on the owner's word: still too loud\\n$`));
    noLock(dir);
  });

  test('a bug /land marked fixed is reopened', () => {
    const { dir } = repo({ bugs: [B('B1', { status: 'fixed' })] });
    const r = ship(dir, 'reject', 'B1', '--owner', 'it still lists every case');
    assert.equal(r.code, 0, out(r));
    assert.equal(statusOf(dir, 'docs/bugs/B1.md'), 'in-progress');
    assert.equal(headerOf(dir, 'docs/bugs/B1.md', 'rejected'), today);
    assert.equal(sh(dir, 'git log -1 --format=%s'), 'docs: B1 reopened (B1)');
  });

  test('a queue file this run creates is committed with the entry', () => {
    const { dir, commitAll } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')] });
    sh(dir, 'git rm -q docs/backlog/QUEUE.md');
    commitAll('no queue yet');
    const r = ship(dir, 'reject', 'P1', '--owner', 'x');
    assert.equal(r.code, 0, out(r));
    assert.deepEqual(filesOf(dir), ['docs/backlog/P1.md', 'docs/backlog/QUEUE.md']);
    assert.equal(sh(dir, 'git status --porcelain'), '');
  });

  test('a note with a line break cannot run: it could forge a section', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    assert.equal(ship(dir, 'reject', 'P1', '--owner', 'ok\n## Accept').code, 2);
    assert.equal(sh(dir, 'git status --porcelain'), '');
  });

  test('without the owner\'s words, or on an entry not landed, it is refused', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')] });
    refusedFlip(dir, ship(dir, 'reject', 'P1'), /a rejection is the owner's verdict/);
    refusedFlip(dir, ship(dir, 'reject', 'P2', '--owner', 'x'), /P2 is `proposed` on main: only a landing awaiting acceptance/);
  });
});

// ── Resolutions and decisions (P55 R2) ───────────────────────────────────────

const RESOLUTION = '## Resolution\n\nThe probe ran on 2026-10-27:\n\n- it held twice.\n';
const DECISION = '## Decided\n\n(b).\n\n## Why\n\nThe owner chose it.\n\n## Reopen if\n\nIt stops paying.\n';
/** A --from file outside the repo, as a caller writes it in a scratch directory. */
const fromFile = (text) => {
  const p = join(tempDir(), 'sections.md');
  writeFileSync(p, text);
  return p;
};

describe('ship.mjs resolve: an assumption is settled in one commit (P55 R2)', () => {
  test('the header, the Resolution and the queue land together, green; a re-read dependent owes no sweep', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2', { dependsOn: ['A-1'], drafted: today })], assumptions: [A('A-1')] });
    const before = commits(dir);
    const r = ship(dir, 'resolve', 'A-1', 'verified', '--from', fromFile(RESOLUTION), '--trailer', 'Co-Authored-By: X <x@example.com>');
    assert.equal(r.code, 0, out(r));
    assert.equal(commits(dir), before + 1);
    const text = readFileSync(join(dir, 'docs/assumptions/A-1.md'), 'utf8');
    assert.equal(statusOf(dir, 'docs/assumptions/A-1.md'), 'verified');
    assert.match(text, new RegExp(`^raised: 2026-08-01\\nresolved: ${today}\\n---$`, 'm'), 'the new key closes the header');
    assert.match(text, /\n\n## Resolution\n\nThe probe ran on 2026-10-27:\n\n- it held twice\.\n$/);
    assert.deepEqual(filesOf(dir), ['docs/assumptions/A-1.md', 'docs/backlog/QUEUE.md']);
    assert.match(readFileSync(join(dir, 'docs/backlog/QUEUE.md'), 'utf8'), /P2/, 'the unblocked entry reaches the queue');
    assert.equal(sh(dir, 'git log -1 --format=%B'), 'docs: A-1 verified (A-1)\n\nCo-Authored-By: X <x@example.com>');
    assert.match(r.stdout, /Sweep: no entry still owes it a sweep\./);
    assert.equal(run('backlog-schema-check.mjs', ['--all'], { cwd: dir }).code, 0);
    assert.equal(sh(dir, 'git status --porcelain'), '');
    noLock(dir);
  });

  test('a refutation names what already shipped on it, which may be void', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'shipped', shipped: '2026-08-02', dependsOn: ['A-1'] }), P('P2')], assumptions: [A('A-1')] });
    const r = ship(dir, 'resolve', 'A-1', 'refuted', '--from', fromFile(RESOLUTION), '--json');
    assert.equal(r.code, 0, out(r));
    const j = JSON.parse(r.stdout);
    assert.equal(j.action, 'refuted');
    assert.match(j.message, /may now be void/);
    assert.deepEqual(j.sweep.dependents.map((d) => d.id), ['P1']);
  });

  test('with no dependents the sweep says so', () => {
    const { dir } = repo({ assumptions: [A('A-1')] });
    const r = ship(dir, 'resolve', 'A-1', 'moot', '--from', fromFile(RESOLUTION));
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /Sweep: no entry still owes it a sweep\./);
  });

  test('a dependent left presumptively stale turns the check red: every file is put back', () => {
    const { dir } = repo({ backlog: [P('P1', { dependsOn: ['A-1'], drafted: '2026-08-01' })], assumptions: [A('A-1')] });
    refusedFlip(dir, ship(dir, 'resolve', 'A-1', 'verified', '--from', fromFile(RESOLUTION)), /schema check is red with A-1 verified, so nothing was committed[\s\S]*P1/);
    assert.equal(statusOf(dir, 'docs/assumptions/A-1.md'), 'open');
  });

  test('one an open spike settles is refused by the check: the spike\'s shipped flip must come with it', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress', resolves: 'A-1' }), P('P2')], assumptions: [A('A-1')] });
    refusedFlip(dir, ship(dir, 'resolve', 'A-1', 'verified', '--from', fromFile(RESOLUTION)), /open P1 resolves A-1, but A-1 is already `verified`/);
    assert.equal(statusOf(dir, 'docs/assumptions/A-1.md'), 'open');
  });

  test('a fenced `## ` line is text, in the --from file and in the entry; a BOM is not text', () => {
    const fenced = '﻿## Resolution\n\nIt held. The template:\n\n```\n## Accept\n## Resolution\n```\n';
    const { dir } = repo({ assumptions: [A('A-1', { howToVerify: 'quote it:\n\n```\n## Resolution\n```' })] });
    const r = ship(dir, 'resolve', 'A-1', 'verified', '--from', fromFile(fenced));
    assert.equal(r.code, 0, out(r));
    assert.match(readFileSync(join(dir, 'docs/assumptions/A-1.md'), 'utf8'), /\n## Resolution\n\nIt held\. The template:\n\n```\n## Accept\n## Resolution\n```\n$/);
  });

  test('a settled assumption is refused', () => {
    const { dir } = repo({ assumptions: [A('A-1', { status: 'verified', resolved: '2026-08-02', resolution: 'held.' })] });
    refusedFlip(dir, ship(dir, 'resolve', 'A-1', 'refuted', '--from', fromFile(RESOLUTION)), /A-1 is `verified` on main, not `open`/);
  });

  test('a --from file that is not exactly the sections is refused before anything is touched', () => {
    const { dir } = repo({ assumptions: [A('A-1')] });
    for (const [text, why] of [
      ['## Resolution\n\n', /missing or empty: Resolution/],
      ['## Resolution\n\nok\n\n## Accept\n\n- x\n', /not written by resolve: Accept/],
      ['found it\n\n## Resolution\n\nok\n', /text before its first heading/],
      ['## Resolution\n\na\n\n## Resolution\n\nb\n', /`## Resolution` twice/],
    ]) refusedFlip(dir, ship(dir, 'resolve', 'A-1', 'verified', '--from', fromFile(text)), why);
    assert.equal(statusOf(dir, 'docs/assumptions/A-1.md'), 'open');
  });

  test('an uncommitted --from file in the checkout is named as that; an ignored one is fine', () => {
    const { dir, commitAll } = repo({ assumptions: [A('A-1')] });
    writeFileSync(join(dir, '.gitignore'), 'scratch/\n');
    commitAll('ignore scratch');
    writeFileSync(join(dir, 'res.md'), RESOLUTION);
    const r = ship(dir, 'resolve', 'A-1', 'verified', '--from', join(dir, 'res.md'));
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /res\.md is uncommitted work in the main checkout/);
    sh(dir, 'rm res.md');
    mkdirSync(join(dir, 'scratch'));
    writeFileSync(join(dir, 'scratch', 'res.md'), RESOLUTION);
    assert.equal(ship(dir, 'resolve', 'A-1', 'verified', '--from', join(dir, 'scratch', 'res.md')).code, 0);
  });

  test('a bad verdict, a wrong id, or a missing --from cannot run', () => {
    const { dir } = repo({ assumptions: [A('A-1')], decisions: [D('D-1')] });
    assert.equal(ship(dir, 'resolve', 'A-1', 'moved', '--from', fromFile(RESOLUTION)).code, 2);
    assert.equal(ship(dir, 'resolve', 'A-1', '--from', fromFile(RESOLUTION)).code, 2);
    assert.equal(ship(dir, 'resolve', 'D-1', 'verified', '--from', fromFile(RESOLUTION)).code, 2);
    assert.equal(ship(dir, 'resolve', 'A-1', 'verified').code, 2);
    assert.equal(ship(dir, 'resolve', 'A-1', 'verified', '--from', fromFile(RESOLUTION), '--owner', 'x').code, 2);
    assert.equal(ship(dir, 'resolve', 'A-1', 'verified', '--from', fromFile(RESOLUTION), '--branch', 'feat/p1-x').code, 2);
    assert.equal(ship(dir, 'claim', 'P1', '--from', fromFile(RESOLUTION)).code, 2);
    assert.equal(sh(dir, 'git status --porcelain'), '');
  });
});

describe('ship.mjs decide: the owner\'s decision in one commit (P55 R2)', () => {
  test('the header, the three sections and the queue land together, green; the commit carries their word', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2', { dependsOn: ['D-1'], drafted: today })], decisions: [D('D-1')] });
    const r = ship(dir, 'decide', 'D-1', '--owner', 'go with (b)', '--leads-to', 'P2', '--from', fromFile(DECISION));
    assert.equal(r.code, 0, out(r));
    const text = readFileSync(join(dir, 'docs/decisions/D-1.md'), 'utf8');
    assert.equal(statusOf(dir, 'docs/decisions/D-1.md'), 'decided');
    assert.doesNotMatch(text, /^waiting_on:/m);
    assert.match(text, new RegExp(`^decided: ${today}\\nleads_to: P2\\n---$`, 'm'));
    assert.match(text, /\n## Decided\n\n\(b\)\.\n\n## Why\n\nThe owner chose it\.\n\n## Reopen if\n\nIt stops paying\.\n$/);
    assert.deepEqual(filesOf(dir), ['docs/backlog/QUEUE.md', 'docs/decisions/D-1.md']);
    assert.equal(sh(dir, 'git log -1 --format=%B'), 'docs: D-1 decided (D-1)\n\nOn the owner\'s word: go with (b)');
    assert.match(r.stdout, /Sweep: no entry still owes it a sweep\./);
    assert.equal(run('backlog-schema-check.mjs', ['--all'], { cwd: dir }).code, 0);
    noLock(dir);
  });

  test('— for a decision no change follows', () => {
    const { dir } = repo({ decisions: [D('D-1')] });
    const r = ship(dir, 'decide', 'D-1', '--owner', 'keep it', '--leads-to', '—', '--from', fromFile(DECISION));
    assert.equal(r.code, 0, out(r));
    assert.equal(headerOf(dir, 'docs/decisions/D-1.md', 'leads_to'), '—');
  });

  test('--leads-to is read in any case, as every id here is', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2')], decisions: [D('D-1')] });
    assert.equal(ship(dir, 'decide', 'd-1', '--owner', 'x', '--leads-to', 'p2', '--from', fromFile(DECISION)).code, 0);
    assert.equal(headerOf(dir, 'docs/decisions/D-1.md', 'leads_to'), 'P2');
  });

  test('a stray third word points at --leads-to, not at milestones', () => {
    const r = ship(repo({ decisions: [D('D-1')] }).dir, 'decide', 'D-1', 'P2', '--owner', 'x', '--from', fromFile(DECISION));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /goes in --leads-to/);
  });

  test('without the owner\'s word it is refused before anything is touched', () => {
    const { dir } = repo({ decisions: [D('D-1')] });
    refusedFlip(dir, ship(dir, 'decide', 'D-1', '--leads-to', '—', '--from', fromFile(DECISION)), /decided on the owner's word only/);
    assert.equal(statusOf(dir, 'docs/decisions/D-1.md'), 'open');
  });

  test('a decided decision is refused', () => {
    const { dir } = repo({ decisions: [D('D-1', { status: 'decided', decided: '2026-08-02', leadsTo: '—', waitingOn: null, choice: 'a', why: 'b', reopenIf: 'c' })] });
    refusedFlip(dir, ship(dir, 'decide', 'D-1', '--owner', 'x', '--leads-to', '—', '--from', fromFile(DECISION)), /D-1 is `decided` on main, not `open`/);
  });

  test('missing sections, or a bad or missing --leads-to, cannot be written', () => {
    const { dir } = repo({ decisions: [D('D-1')] });
    refusedFlip(dir, ship(dir, 'decide', 'D-1', '--owner', 'x', '--leads-to', '—', '--from', fromFile('## Decided\n\n(b).\n')), /missing or empty: Why, Reopen if/);
    assert.equal(ship(dir, 'decide', 'D-1', '--owner', 'x', '--from', fromFile(DECISION)).code, 2);
    assert.equal(ship(dir, 'decide', 'D-1', '--owner', 'x', '--leads-to', 'soon', '--from', fromFile(DECISION)).code, 2);
    assert.equal(ship(dir, 'decide', 'D-1', '--owner', 'x', '--leads-to', '—', '--branch', 'b', '--from', fromFile(DECISION)).code, 2);
    assert.equal(sh(dir, 'git status --porcelain'), '');
  });
});
