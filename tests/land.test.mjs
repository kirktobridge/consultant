// The landing machinery (P15 R2): the lock, the rebase-and-resolve loop, the
// took-one-side check, and the merge — each driven in a real throwaway repo with real
// linked worktrees, the way a session would drive it.
//
// The guard behaviour that decides which commands a worktree session may issue is the
// harness's, not ours (A-11); everything else is git and is tested here.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, run, out, script, tempDir, cleanupAll, gitInit } from './helpers/fixture.mjs';

after(cleanupAll);

const SUITE_OK = `"${process.execPath}" -e "process.exit(0)"`;
const SUITE_RED = `"${process.execPath}" -e "process.exit(1)"`;

const land = (cwd, ...args) => run('land.mjs', args, { cwd });
const git1 = (cwd, cmd) => execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lockFile = (main) => join(git1(main, 'rev-parse --path-format=absolute --git-common-dir'), 'loop-land.lock');

/**
 * A main checkout holding a ten-line file, plus `n` entry branches, each in its own
 * worktree under .claude/worktrees/ — the layout scripts/worktree.mjs makes.
 */
function repo(names = ['p1-one']) {
  const main = tempDir();
  writeFileSync(join(main, '.gitignore'), '.claude/worktrees/\n');
  writeFileSync(join(main, 'f.txt'), Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  const g = gitInit(main);
  const wts = {};
  for (const n of names) {
    const wt = join(main, '.claude', 'worktrees', n);
    g.sh(`git worktree add -q -b feat/${n} "${wt}" main`);
    wts[n] = wt;
  }
  return { main, wts, ...g };
}

/** Rewrite line `n` (1-based) of f.txt in `dir` and commit. */
function editLine(dir, n, text, msg = `edit line ${n}`) {
  const p = join(dir, 'f.txt');
  const lines = readFileSync(p, 'utf8').split('\n');
  lines[n - 1] = text;
  writeFileSync(p, lines.join('\n'));
  execSync(`git commit -qam "${msg}"`, { cwd: dir, stdio: 'ignore' });
}

/** Land `branch` from `wt` into main the way the skills do, minus the session. */
function landed(main, wt, branch, suite = SUITE_OK) {
  assert.equal(land(wt, 'lock', 'take', branch).code, 0);
  assert.equal(land(wt, 'rebase').code, 0);
  const m = land(main, 'merge', branch, '--suite', suite);
  assert.equal(m.code, 0, out(m));
  assert.equal(land(main, 'finish', branch).code, 0);
}

/** Another entry lands a change to line `n` on main, through a merge commit. */
function otherLands(r, name, n, text) {
  const wt = join(r.main, '.claude', 'worktrees', name);
  r.sh(`git worktree add -q -b feat/${name} "${wt}" main`);
  editLine(wt, n, text, `other entry edits line ${n}`);
  landed(r.main, wt, `feat/${name}`);
}

/** Put the file into the shape `fn(lines)` returns, in place. */
function resolveTo(wt, fn) {
  const p = join(wt, 'f.txt');
  writeFileSync(p, fn(readFileSync(p, 'utf8').split('\n')).join('\n'));
}
/** Replace the whole diff3 conflict block with `replacement` lines. */
const replaceConflict = (replacement) => (lines) => {
  const s = lines.findIndex((l) => l.startsWith('<<<<<<<'));
  const e = lines.findIndex((l) => l.startsWith('>>>>>>>'));
  return [...lines.slice(0, s), ...replacement, ...lines.slice(e + 1)];
};

// ── The lock ─────────────────────────────────────────────────────────────────

describe('the land lock: one landing or claim at a time (P15 R2)', () => {
  test('taking it records its owner, worktree and time; another owner is refused, naming the holder', () => {
    const { main, wts } = repo();
    const r = land(wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    assert.equal(r.code, 0, out(r));
    const l = JSON.parse(readFileSync(lockFile(main), 'utf8'));
    assert.equal(l.owner, 'feat/p1-one');
    assert.equal(l.worktree, wts['p1-one']);
    assert.ok(Date.now() - Date.parse(l.at) < 60_000);
    const other = land(main, 'lock', 'take', 'claim:P2');
    assert.equal(other.code, 1, out(other));
    assert.match(other.stderr, /held by feat\/p1-one/);
  });

  test('the owner taking it again is not refused', () => {
    const { wts } = repo();
    land(wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    assert.equal(land(wts['p1-one'], 'lock', 'take', 'feat/p1-one').code, 0);
  });

  test('only the owner may release it', () => {
    const { main, wts } = repo();
    land(wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    assert.equal(land(main, 'lock', 'release', 'claim:P2').code, 1);
    assert.ok(existsSync(lockFile(main)));
    assert.equal(land(main, 'lock', 'release', 'feat/p1-one').code, 0);
    assert.ok(!existsSync(lockFile(main)));
  });

  test('a lock whose owner branch is gone is stale, and is cleared', () => {
    const { main, sh } = repo([]);
    sh('git branch feat/p9-gone');
    land(main, 'lock', 'take', 'feat/p9-gone');
    sh('git branch -D feat/p9-gone');
    const r = land(main, 'lock', 'take', 'claim:P2');
    assert.equal(r.code, 0, out(r));
    assert.match(out(r), /stale/);
    assert.equal(JSON.parse(readFileSync(lockFile(main), 'utf8')).owner, 'claim:P2');
  });

  test('a lock whose owner branch is already merged is stale, and is cleared', () => {
    const { main, sh } = repo([]);
    sh('git branch feat/p9-done');
    land(main, 'lock', 'take', 'feat/p9-done'); // feat/p9-done == main: merged
    assert.equal(land(main, 'lock', 'take', 'claim:P2').code, 0);
  });

  test('an old lock whose owner is still unmerged is ambiguous: refused, untouched, and it asks', () => {
    const { main, wts } = repo();
    editLine(wts['p1-one'], 1, 'unmerged work');
    land(wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    const l = JSON.parse(readFileSync(lockFile(main), 'utf8'));
    l.at = new Date(Date.now() - 31 * 60_000).toISOString();
    writeFileSync(lockFile(main), JSON.stringify(l));
    const r = land(main, 'lock', 'take', 'claim:P2');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /ask the user/i);
    assert.equal(JSON.parse(readFileSync(lockFile(main), 'utf8')).owner, 'feat/p1-one');
  });

  test('a waiting take gets the lock once the holder releases it', async () => {
    const { main, wts } = repo();
    land(wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    const waiting = new Promise((resolve) => {
      const c = spawn(process.execPath, [script('land.mjs'), 'lock', 'take', 'claim:P2', '--wait', '20'], { cwd: main });
      c.on('exit', resolve);
    });
    await new Promise((r) => setTimeout(r, 800));
    land(main, 'lock', 'release', 'feat/p1-one');
    assert.equal(await waiting, 0);
  });

  test('five racing takes: exactly one wins', async () => {
    const { main } = repo([]);
    const codes = await Promise.all([1, 2, 3, 4, 5].map((i) => new Promise((resolve) => {
      const c = spawn(process.execPath, [script('land.mjs'), 'lock', 'take', `claim:P${i}`, '--wait', '0'], { cwd: main });
      c.on('exit', resolve);
    })));
    assert.equal(codes.filter((c) => c === 0).length, 1, `exit codes: ${codes}`);
  });
});

// ── Rebase and resolve ───────────────────────────────────────────────────────

describe('rebase onto the new main, in the worktree, under the lock (P15 R2)', () => {
  test('a branch with no overlap rebases cleanly onto the moved main', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 9, 'mine');
    otherLands(r, 'p2-two', 1, 'theirs');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    const x = land(r.wts['p1-one'], 'rebase');
    assert.equal(x.code, 0, out(x));
    r.sh('git merge-base --is-ancestor main feat/p1-one');
  });

  test('without the lock, rebase is refused', () => {
    const r = repo();
    const x = land(r.wts['p1-one'], 'rebase');
    assert.equal(x.code, 1, out(x));
    assert.match(x.stderr, /lock/);
  });

  test('from the main checkout, rebase is refused — it runs in the worktree', () => {
    const r = repo();
    land(r.main, 'lock', 'take', 'main');
    const x = land(r.main, 'rebase');
    assert.equal(x.code, 1, out(x));
    assert.match(x.stderr, /worktree/);
  });

  test('a conflict stops with exit 3, showing both sides and the entry that landed the other', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 5, 'five, by this branch');
    otherLands(r, 'p2-two', 5, 'five, by the other entry');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    const x = land(r.wts['p1-one'], 'rebase');
    assert.equal(x.code, 3, out(x));
    assert.match(x.stdout, /f\.txt/);
    assert.match(x.stdout, /five, by this branch/);
    assert.match(x.stdout, /five, by the other entry/);
    assert.match(x.stdout, /P2 .*docs\/backlog\/P2\.md/);
  });

  test('a blended resolution passes the check, the rebase completes, and the record keeps it', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 5, 'five, by this branch');
    otherLands(r, 'p2-two', 5, 'five, by the other entry');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    land(r.wts['p1-one'], 'rebase');
    resolveTo(r.wts['p1-one'], replaceConflict(['five, by the other entry and this branch']));
    const c = land(r.wts['p1-one'], 'continue');
    assert.equal(c.code, 0, out(c));
    r.sh('git merge-base --is-ancestor main feat/p1-one');
    const rep = JSON.parse(land(r.main, 'report', 'feat/p1-one', '--json').stdout);
    assert.equal(rep.conflicts.length, 1);
    assert.deepEqual(rep.conflicts[0].resolved, ['five, by the other entry and this branch']);
    assert.deepEqual(rep.conflicts[0].main, ['five, by the other entry']);
    assert.deepEqual(rep.conflicts[0].branch, ['five, by this branch']);
  });

  test('a resolution identical to the main side is flagged (exit 4) and the rebase is left for the user', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 5, 'five, by this branch');
    otherLands(r, 'p2-two', 5, 'five, by the other entry');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    land(r.wts['p1-one'], 'rebase');
    resolveTo(r.wts['p1-one'], replaceConflict(['five, by the other entry']));
    const c = land(r.wts['p1-one'], 'continue');
    assert.equal(c.code, 4, out(c));
    assert.match(c.stderr, /kept only the main side/);
    assert.ok(existsSync(join(git1(r.wts['p1-one'], 'rev-parse --path-format=absolute --git-dir'), 'rebase-merge')));
  });

  test('a resolution identical to this branch\'s side is flagged too', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 5, 'five, by this branch');
    otherLands(r, 'p2-two', 5, 'five, by the other entry');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    land(r.wts['p1-one'], 'rebase');
    resolveTo(r.wts['p1-one'], replaceConflict(['five, by this branch']));
    const c = land(r.wts['p1-one'], 'continue');
    assert.equal(c.code, 4, out(c));
    assert.match(c.stderr, /kept only this branch's side/);
  });

  test('conflict markers left in the file are refused, not committed', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 5, 'five, by this branch');
    otherLands(r, 'p2-two', 5, 'five, by the other entry');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    land(r.wts['p1-one'], 'rebase');
    const c = land(r.wts['p1-one'], 'continue');
    assert.equal(c.code, 1, out(c));
    assert.match(c.stderr, /markers/);
  });

  test('a branch whose two commits both conflict stops twice, then completes', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 2, 'two, by this branch');
    editLine(r.wts['p1-one'], 8, 'eight, by this branch');
    const o = join(r.main, '.claude', 'worktrees', 'p2-two');
    r.sh(`git worktree add -q -b feat/p2-two "${o}" main`);
    editLine(o, 2, 'two, by the other entry');
    editLine(o, 8, 'eight, by the other entry');
    landed(r.main, o, 'feat/p2-two');
    const wt = r.wts['p1-one'];
    land(wt, 'lock', 'take', 'feat/p1-one');
    assert.equal(land(wt, 'rebase').code, 3);
    resolveTo(wt, replaceConflict(['two, both']));
    assert.equal(land(wt, 'continue').code, 3);
    resolveTo(wt, replaceConflict(['eight, both']));
    const c = land(wt, 'continue');
    assert.equal(c.code, 0, out(c));
    assert.equal(JSON.parse(land(r.main, 'report', 'feat/p1-one', '--json').stdout).conflicts.length, 2);
  });

  test('a conflict with no markers to resolve (modify/delete) stops for the user', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 5, 'five, by this branch');
    const o = join(r.main, '.claude', 'worktrees', 'p2-two');
    r.sh(`git worktree add -q -b feat/p2-two "${o}" main`);
    execSync('git rm -q f.txt && git commit -qm "delete f"', { cwd: o, stdio: 'ignore' });
    landed(r.main, o, 'feat/p2-two');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    const x = land(r.wts['p1-one'], 'rebase');
    assert.equal(x.code, 4, out(x));
    assert.match(x.stderr, /f\.txt/);
  });
});

// ── Merge and finish ─────────────────────────────────────────────────────────

describe('merge from the main checkout, then clean up (P15 R2)', () => {
  test('a branch not rebased onto the current main is refused', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 9, 'mine');
    otherLands(r, 'p2-two', 1, 'theirs');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    const m = land(r.main, 'merge', 'feat/p1-one', '--suite', SUITE_OK);
    assert.equal(m.code, 1, out(m));
    assert.match(m.stderr, /rebase/);
  });

  test('a merge without the branch holding the lock is refused', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 9, 'mine');
    const m = land(r.main, 'merge', 'feat/p1-one', '--suite', SUITE_OK);
    assert.equal(m.code, 1, out(m));
    assert.match(m.stderr, /lock/);
  });

  test('a green merge is a --no-ff merge commit on main, carrying the conflict report', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 5, 'five, by this branch');
    otherLands(r, 'p2-two', 5, 'five, by the other entry');
    const wt = r.wts['p1-one'];
    land(wt, 'lock', 'take', 'feat/p1-one');
    land(wt, 'rebase');
    resolveTo(wt, replaceConflict(['five, both']));
    land(wt, 'continue');
    const m = land(r.main, 'merge', 'feat/p1-one', '--suite', SUITE_OK);
    assert.equal(m.code, 0, out(m));
    assert.equal(git1(r.main, 'rev-list --count --merges main'), '2');
    const msg = git1(r.main, 'log -1 --format=%B main');
    assert.match(msg, /^Merge branch 'feat\/p1-one'/);
    assert.match(msg, /Conflicts resolved: 1[\s\S]*f\.txt/);
  });

  test('a red suite after the merge puts main back where it was', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 9, 'mine');
    land(r.wts['p1-one'], 'lock', 'take', 'feat/p1-one');
    land(r.wts['p1-one'], 'rebase');
    const before = git1(r.main, 'rev-parse main');
    const m = land(r.main, 'merge', 'feat/p1-one', '--suite', SUITE_RED);
    assert.equal(m.code, 1, out(m));
    assert.equal(git1(r.main, 'rev-parse main'), before);
    assert.equal(git1(r.main, 'status --porcelain'), '');
  });

  test('finish removes the worktree, the branch, the record and the lock', () => {
    const r = repo();
    editLine(r.wts['p1-one'], 9, 'mine');
    landed(r.main, r.wts['p1-one'], 'feat/p1-one');
    assert.doesNotMatch(git1(r.main, 'worktree list'), /p1-one/);
    assert.equal(git1(r.main, 'branch --list feat/p1-one'), '');
    assert.ok(!existsSync(lockFile(r.main)));
    assert.equal(land(r.main, 'report', 'feat/p1-one').code, 1);
  });
});

// ── The skills drive the script, in order ───────────────────────────────────

describe('the skills land through land.mjs (P15 R2)', () => {
  const skill = (n) => readFileSync(join(REPO, '.claude', 'skills', n, 'SKILL.md'), 'utf8');

  test('/implement takes the lock, rebases and continues in the worktree, then leaves and runs /land', () => {
    const t = skill('implement');
    const at = (s) => { const i = t.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };
    const order = [
      at('land.mjs lock take <branch>'), at('land.mjs rebase'), at('land.mjs continue'),
      at('**ExitWorktree** (`keep`'), at('then run\n     **/land**'),
    ];
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'steps out of order');
    assert.match(t, /lock take claim:<ID>/, 'the claim commit must take the lock too');
  });

  test('/land merges and finishes through the script, and never merges with raw git', () => {
    const t = skill('land');
    assert.match(t, /land\.mjs merge <branch>/);
    assert.match(t, /land\.mjs finish <branch>/);
    assert.doesNotMatch(t, /`git merge --no-ff/);
  });
});

// ── Accept 3 ─────────────────────────────────────────────────────────────────

describe('two sessions finishing at once land one after the other (P15 Accept 3)', () => {
  test('main shows both merges, and the suite was green after each, on exactly one more merge', async () => {
    const r = repo(['p1-one', 'p2-two']);
    editLine(r.wts['p1-one'], 2, 'two, by p1');
    editLine(r.wts['p2-two'], 8, 'eight, by p2');
    const log = join(r.main, '..', `${Date.now()}-suite.log`);
    // The suite stub records how many merges main had when it ran, and is slow enough
    // that an unserialised second landing would overlap it.
    const suite = `"${process.execPath}" -e "require('fs').appendFileSync('${log.replace(/\\/g, '/')}', require('child_process').execSync('git rev-list --count --merges HEAD').toString()); setTimeout(() => {}, 400)"`;
    const driver = join(r.main, '..', `${Date.now()}-driver.mjs`);
    writeFileSync(driver, `
      import { spawnSync } from 'node:child_process';
      const [main, wt, branch, suite] = process.argv.slice(2);
      const step = (cwd, ...a) => {
        const x = spawnSync(process.execPath, [${JSON.stringify(script('land.mjs'))}, ...a], { cwd, encoding: 'utf8' });
        if (x.status !== 0) { console.error(a.join(' '), x.status, x.stderr); process.exit(1); }
      };
      step(wt, 'lock', 'take', branch, '--wait', '60');
      step(wt, 'rebase');
      step(main, 'merge', branch, '--suite', suite);
      step(main, 'finish', branch);
    `);
    const go = (name) => new Promise((resolve) => {
      const c = spawn(process.execPath, [driver, r.main, r.wts[name], `feat/${name}`, suite], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('exit', (code) => resolve({ code, err }));
    });
    const results = await Promise.all([go('p1-one'), go('p2-two')]);
    for (const x of results) assert.equal(x.code, 0, x.err);
    assert.equal(git1(r.main, 'rev-list --count --merges main'), '2');
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['1', '2']);
    const f = readFileSync(join(r.main, 'f.txt'), 'utf8');
    assert.match(f, /two, by p1/);
    assert.match(f, /eight, by p2/);
  });
});
