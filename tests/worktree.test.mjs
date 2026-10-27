// The hooks judge a worktree's files against that worktree (P16).
//
// In a worktree session the hooks still run from the checkout the session launched in
// (A-7, refuted by probe). A linked worktree under `.claude/worktrees/` is then just a
// subfolder of that checkout, so a folder pattern like `docs/dev_notes/` silently
// stopped matching the worktree's copy, and the PostToolUse checks validated main's
// docs instead of the branch's. Nothing failed — that is the whole problem — so every
// case here builds a real repo with a real linked worktree and asserts the block.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO, P, B, A, D, decidedD, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles,
} from './helpers/fixture.mjs';

after(cleanupAll);

/**
 * A git repo holding a copy of the guard, a valid backlog, and the real hook config,
 * plus a linked worktree where EnterWorktree puts one. Returns both checkout roots.
 */
function repoWithWorktree() {
  const main = tempDir();
  mkdirSync(join(main, '.claude'), { recursive: true });
  mkdirSync(join(main, 'scripts'), { recursive: true });
  for (const f of ['edit-guard.mjs', 'edit-blocklist', 'settings.json']) {
    cpSync(join(REPO, '.claude', f), join(main, '.claude', f));
  }
  // settings.json names these; without them verify-guards reports disarmed everywhere.
  // The schema check reads the registers through entries.mjs, so that comes too.
  for (const f of ['backlog-schema-check.mjs', 'entries.mjs', 'verify-guards.mjs']) {
    cpSync(join(REPO, 'scripts', f), join(main, 'scripts', f));
  }
  writeFiles(main, renderFiles({ backlog: [P('P1')] }));
  const { sh } = gitInit(main);
  const wt = join(main, '.claude', 'worktrees', 'w');
  sh(`git worktree add -q -b feat/w "${wt}"`);
  return { main, wt };
}

/** The guard copy living in `checkout`, as the hook runs it: from the main checkout. */
function guard(checkout, filePath, cwd) {
  const r = spawnSync(process.execPath, [join(checkout, '.claude', 'edit-guard.mjs')], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    cwd,
  });
  return { code: r.status ?? 1, stderr: r.stderr ?? '' };
}

const BLOCKED = 2;
const ALLOWED = 0;

describe('the edit-guard judges a path against the checkout that contains it', () => {
  test('a new file under a worktree\'s docs/dev_notes/ is blocked by the folder pattern', () => {
    const { main, wt } = repoWithWorktree();
    const r = guard(main, join(wt, 'docs', 'dev_notes', 'new.md'), wt);
    assert.equal(r.code, BLOCKED, r.stderr);
    assert.match(r.stderr, /matches pattern 'docs\/dev_notes\/'/);
  });

  test('…exactly as it is in the main checkout', () => {
    const { main } = repoWithWorktree();
    assert.equal(guard(main, join(main, 'docs', 'dev_notes', 'new.md'), main).code, BLOCKED);
  });

  test('a relative path from a session sitting in the worktree is judged there too', () => {
    const { main, wt } = repoWithWorktree();
    assert.equal(guard(main, 'docs/dev_notes/new.md', wt).code, BLOCKED);
  });

  test('the worktree\'s ordinary files are still permitted', () => {
    const { main, wt } = repoWithWorktree();
    assert.equal(guard(main, join(wt, 'docs', 'backlog', 'P1.md'), wt).code, ALLOWED);
  });

  test('a checkout of a different repository is not adopted as a root', () => {
    // An unrelated repo nested inside this one: its `docs/dev_notes/` is not ours to
    // protect, and before P16 it was judged relative to the outer checkout — keep that.
    const { main } = repoWithWorktree();
    const other = join(main, 'vendor', 'other');
    mkdirSync(other, { recursive: true });
    gitInit(other);
    assert.equal(guard(main, join(other, 'docs', 'dev_notes', 'x.md'), main).code, ALLOWED);
  });
});

describe('the PostToolUse checks run against the worktree the edit landed in', () => {
  // The hook runs with CLAUDE_PROJECT_DIR at the main checkout, as A-7 found it does.
  const hook = (scriptName, main, filePath) =>
    run(scriptName, [], {
      cwd: main,
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
    });

  test('an edit that breaks the worktree\'s backlog schema is flagged', () => {
    const { main, wt } = repoWithWorktree();
    const backlog = join(wt, 'docs', 'backlog', 'P1.md');
    writeFiles(wt, renderFiles({ backlog: [P('P1', { value: null })] }));
    const r = hook('backlog-schema-check.mjs', main, backlog);
    assert.equal(r.code, 2, `expected the worktree's broken backlog to be flagged:\n${out(r)}`);
  });

  test('…and main\'s own backlog, untouched, still passes — so it was the worktree checked', () => {
    const { main, wt } = repoWithWorktree();
    writeFiles(wt, renderFiles({ backlog: [P('P1', { value: null })] }));
    const mainBacklog = join(main, 'docs', 'backlog', 'P1.md');
    assert.equal(hook('backlog-schema-check.mjs', main, mainBacklog).code, 0);
  });

  test('disarming the worktree\'s settings.json is flagged', () => {
    const { main, wt } = repoWithWorktree();
    const settings = join(wt, '.claude', 'settings.json');
    assert.equal(hook('verify-guards.mjs', main, settings).code, 0, 'baseline must be armed');
    const s = JSON.parse(readFileSync(settings, 'utf8'));
    delete s.hooks.PreToolUse;
    writeFileSync(settings, JSON.stringify(s, null, 2));
    const r = hook('verify-guards.mjs', main, settings);
    assert.equal(r.code, 2, `expected the worktree's disarmed settings to be flagged:\n${out(r)}`);
  });
});

// ── P15 R1: /implement provisions its own worktree ──────────────────────────
//
// scripts/worktree.mjs decides what the skill's prose used to leave to the user. Each
// refusal below is a way a session would otherwise branch on the wrong state: before
// the claim is visible, over someone's uncommitted work, or from inside a worktree.

/** A main checkout with P3 claimed on main (unless `status` says otherwise). */
function claimedRepo({ status = 'in-progress', title = 'Make the widget spin' } = {}) {
  const main = tempDir();
  writeFiles(main, {
    ...renderFiles({ backlog: [P('P3', { status, title })], nextUp: status === 'proposed' ? ['P3'] : [] }),
    '.gitignore': '.claude/worktrees/\n',
  });
  return { main, ...gitInit(main) };
}
const start = (cwd, ...args) => run('worktree.mjs', ['start', ...args], { cwd });
const git1 = (cwd, cmd) => execSync(`git ${cmd}`, { cwd, encoding: 'utf8' }).trim();
const pathLine = (r) => (r.stdout.match(/^path: (.+)$/m) || [])[1];

describe('worktree.mjs start gives a claimed entry its own branch and worktree (P15 R1)', () => {
  test('a claimed entry gets feat/p<#>-<slug> in .claude/worktrees/, at local main', () => {
    const { main } = claimedRepo();
    const r = start(main, 'P3');
    assert.equal(r.code, 0, out(r));
    const wt = pathLine(r);
    assert.equal(wt, join(main, '.claude', 'worktrees', 'p3-make-the-widget-spin'));
    assert.equal(git1(wt, 'rev-parse --abbrev-ref HEAD'), 'feat/p3-make-the-widget-spin');
    assert.equal(git1(wt, 'rev-parse HEAD'), git1(main, 'rev-parse main'));
    assert.equal(git1(main, 'status --porcelain'), '', 'the worktree must not dirty the main checkout');
  });

  test('it branches from local main, not origin — the claim is usually unpushed (A-6)', () => {
    const { main, sh } = claimedRepo({ status: 'proposed' });
    sh('git update-ref refs/remotes/origin/main HEAD'); // origin: before the claim
    writeFiles(main, renderFiles({ backlog: [P('P3', { status: 'in-progress', title: 'Make the widget spin' })], nextUp: [] }));
    sh('git commit -qam claim');
    const r = start(main, 'P3');
    assert.equal(r.code, 0, out(r));
    assert.equal(git1(pathLine(r), 'rev-parse HEAD'), git1(main, 'rev-parse main'));
    assert.notEqual(git1(pathLine(r), 'rev-parse HEAD'), git1(main, 'rev-parse origin/main'));
  });

  test('an unclaimed entry is refused, and nothing is created', () => {
    const { main } = claimedRepo({ status: 'proposed' });
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /not claimed.*via \/ship/s);
    assert.equal(git1(main, 'branch --list "feat/*"'), '');
  });

  test('the claim is read from main, never the checked-out copy', () => {
    const { main, sh } = claimedRepo({ status: 'proposed' });
    sh('git checkout -qb elsewhere');
    writeFiles(main, renderFiles({ backlog: [P('P3', { status: 'in-progress' })], nextUp: [] }));
    sh('git commit -qam "a claim that never reached main"');
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /`proposed` on main/);
  });

  test('a dirty main checkout is refused, naming the files', () => {
    const { main } = claimedRepo();
    writeFileSync(join(main, 'stray.txt'), 'someone else\'s work');
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /uncommitted changes[\s\S]*stray\.txt/);
    assert.equal(git1(main, 'branch --list "feat/*"'), '');
  });

  test('a second start resumes the same worktree instead of making another', () => {
    const { main } = claimedRepo();
    const first = start(main, 'P3');
    const again = start(main, 'P3', '--json');
    assert.equal(again.code, 0, out(again));
    const j = JSON.parse(again.stdout);
    assert.equal(j.action, 'resumed');
    assert.equal(j.path, pathLine(first));
    assert.equal(git1(main, 'worktree list').split('\n').length, 2);
  });

  test('a branch whose worktree was removed gets its worktree back, on the same branch', () => {
    const { main, sh } = claimedRepo();
    const wt = pathLine(start(main, 'P3'));
    sh(`git worktree remove "${wt}"`);
    const r = start(main, 'P3');
    assert.equal(r.code, 0, out(r));
    assert.equal(git1(pathLine(r), 'rev-parse --abbrev-ref HEAD'), 'feat/p3-make-the-widget-spin');
  });

  test('run from inside a linked worktree, it refuses', () => {
    const { main } = claimedRepo();
    const wt = pathLine(start(main, 'P3'));
    const r = start(wt, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /linked worktree.*main checkout/s);
  });

  test('another entry\'s branch with a longer id is not taken for this one', () => {
    const { main, sh } = claimedRepo();
    sh('git branch feat/p31-something-else');
    const r = start(main, 'P3', '--json');
    assert.equal(r.code, 0, out(r));
    assert.equal(JSON.parse(r.stdout).action, 'created');
  });

  test('a claimed bug gets feat/b<#>-<slug>, read from docs/bugs/ (P5 R1)', () => {
    const main = tempDir();
    writeFiles(main, {
      ...renderFiles({ bugs: [B('B2', { status: 'in-progress', title: 'Queue check passes empty' })] }),
      '.gitignore': '.claude/worktrees/\n',
    });
    gitInit(main);
    const r = start(main, 'B2');
    assert.equal(r.code, 0, out(r));
    assert.equal(git1(pathLine(r), 'rev-parse --abbrev-ref HEAD'), 'feat/b2-queue-check-passes-empty');
  });

  test('an open bug is not claimed, and is refused like an unclaimed feature', () => {
    const main = tempDir();
    writeFiles(main, renderFiles({ bugs: [B('B2')] }));
    gitInit(main);
    const r = start(main, 'B2');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /B2 is `open` on main, not claimed/);
  });

  test('an id from a register nobody builds from is a usage error', () => {
    const { main } = claimedRepo();
    const r = start(main, 'A-3');
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /not a buildable id \(P# or B#\)/);
  });

  test('an id with no entry on main is refused toward /triage', () => {
    const { main } = claimedRepo();
    const r = start(main, 'P9');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /no entry on main.*\/triage/s);
  });
});

// ── P32: a claimed entry whose dependencies are unmet gets no worktree ──────
//
// The schema check refuses such a claim at commit time, but these fixture repos have no
// hook — the very gap P32 closes: the claim is on main, and only this script stands
// between it and a worktree.

/** A main checkout with `state` committed; returns its root and git helpers. */
function blockedRepo(state) {
  const main = tempDir();
  writeFiles(main, { ...renderFiles({ nextUp: [], ...state }), '.gitignore': '.claude/worktrees/\n' });
  return { main, ...gitInit(main) };
}
const claimedOn = (dep) => P('P3', { status: 'in-progress', title: 'Make the widget spin', dependsOn: [dep] });
const noBranches = (main) => assert.equal(git1(main, 'branch --list "feat/*"'), '');

describe('worktree.mjs refuses a claimed entry whose dependencies are unmet (P32)', () => {
  test('an entry whose header does not parse on main is named as unreadable, not as `undefined`', () => {
    const { main, commitAll } = blockedRepo({ backlog: [claimedOn('A-1')], assumptions: [A('A-1')] });
    const rel = join(main, 'docs/backlog/P3.md');
    writeFileSync(rel, `﻿${readFileSync(rel, 'utf8')}`);
    commitAll('a BOM');
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /P3\.md on main has no readable `status:` header\. Run npm run check:docs/);
    assert.doesNotMatch(r.stderr, /undefined/);
  });

  test('a claim resting on an open assumption is refused, naming it, and nothing is created', () => {
    const { main } = blockedRepo({ backlog: [claimedOn('A-1')], assumptions: [A('A-1')] });
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /P3 is claimed but blocked on main: it depends on A-1 \(`open`\)/);
    noBranches(main);
    assert.equal(git1(main, 'worktree list').split('\n').length, 1);
  });

  test('a claim resting on an open decision is refused the same way', () => {
    const { main } = blockedRepo({ backlog: [claimedOn('D-1')], decisions: [D('D-1')] });
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /depends on D-1 \(`open`\)/);
    noBranches(main);
  });

  test('a claim on an unshipped feature, and on a dependency with no entry, is refused', () => {
    const { main } = blockedRepo({ backlog: [P('P1', { status: 'partial' }), P('P3', { status: 'in-progress', dependsOn: ['P1', 'B9'] })], bugsReadme: true });
    const r = start(main, 'P3', '--json');
    assert.equal(r.code, 1, out(r));
    assert.deepEqual(JSON.parse(r.stdout).unmet, [{ id: 'P1', status: 'partial' }, { id: 'B9', status: null }]);
  });

  test('a claim resting on a moved assumption or a superseded decision is refused (B10)', () => {
    const { main } = blockedRepo({
      backlog: [P('P3', { status: 'in-progress', title: 'Make the widget spin', dependsOn: ['A-1', 'D-1'] }), P('P4')],
      assumptions: [A('A-1', { status: 'moved', resolved: '2026-08-02', movedTo: 'P4', resolution: 'a choice, not a fact.' })],
      decisions: [D('D-1', { status: 'superseded', waitingOn: null, supersededBy: 'D-2' }), D('D-2')],
    });
    const r = start(main, 'P3', '--json');
    assert.equal(r.code, 1, out(r));
    assert.deepEqual(JSON.parse(r.stdout).unmet, [{ id: 'A-1', status: 'moved' }, { id: 'D-1', status: 'superseded' }]);
    noBranches(main);
    // The fix is a re-point, not a settle: the refusal names each new home.
    const t = start(main, 'P3');
    assert.match(t.stderr, /Re-point its `depends_on:` via \/ship: A-1 → P4, D-1 → D-2 — then re-run/);
    assert.doesNotMatch(t.stderr, /settle what blocks it/i);
  });

  test('a claimed bug resting on an open assumption is refused', () => {
    const { main } = blockedRepo({ bugs: [B('B2', { status: 'in-progress', dependsOn: ['A-1'] })], assumptions: [A('A-1')] });
    const r = start(main, 'B2');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /B2 is claimed but blocked on main: it depends on A-1 \(`open`\)/);
    noBranches(main);
  });

  test('an entry that already has its worktree is refused once a dependency reopens on main', () => {
    const settled = { backlog: [claimedOn('D-1')], decisions: [decidedD('D-1')] };
    const { main, commitAll } = blockedRepo(settled);
    const wt = pathLine(start(main, 'P3'));
    assert.ok(wt, 'the unblocked entry should have got its worktree');
    writeFiles(main, renderFiles({ nextUp: [], backlog: [claimedOn('D-1')], decisions: [D('D-1')] }));
    commitAll('D-1 reopened');
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /depends on D-1 \(`open`\)/);
  });

  test('once the dependency is settled, the same command creates the worktree, then resumes it', () => {
    const { main, commitAll } = blockedRepo({ backlog: [claimedOn('A-1')], assumptions: [A('A-1')] });
    assert.equal(start(main, 'P3').code, 1);
    writeFiles(main, renderFiles({
      nextUp: [], backlog: [claimedOn('A-1')],
      assumptions: [A('A-1', { status: 'verified', resolved: '2026-08-02', resolution: 'probed; it holds.' })],
    }));
    commitAll('A-1 verified');
    const r = start(main, 'P3', '--json');
    assert.equal(r.code, 0, out(r));
    assert.equal(JSON.parse(r.stdout).action, 'created');
    const again = start(main, 'P3', '--json');
    assert.equal(again.code, 0, out(again));
    assert.equal(JSON.parse(again.stdout).action, 'resumed');
  });
});

// ── P33: ad-hoc work gets a worktree with no entry ──────────────────────────

/** A main checkout with no registers at all: ad-hoc work needs none. */
function bareRepo() {
  const main = tempDir();
  writeFiles(main, { '.gitignore': '.claude/worktrees/\n', 'README.md': 'x\n' });
  return { main, ...gitInit(main) };
}

describe('worktree.mjs start --adhoc cuts adhoc/<slug> with no entry (P33)', () => {
  test('it creates adhoc/<slug> and its worktree off local main, with no backlog or bug ID', () => {
    const { main } = bareRepo();
    const r = start(main, '--adhoc', 'fix-readme-typo');
    assert.equal(r.code, 0, out(r));
    const wt = pathLine(r);
    assert.equal(wt, join(main, '.claude', 'worktrees', 'adhoc-fix-readme-typo'));
    assert.equal(git1(wt, 'rev-parse --abbrev-ref HEAD'), 'adhoc/fix-readme-typo');
    assert.equal(git1(wt, 'rev-parse HEAD'), git1(main, 'rev-parse main'));
    assert.equal(git1(main, 'status --porcelain'), '');
  });

  test('the slug is lowercased and hyphenated, never cut short: it is the caller\'s own name', () => {
    const { main } = bareRepo();
    const r = start(main, '--adhoc', 'Reword  the GUIDE!', '--json');
    assert.equal(r.code, 0, out(r));
    assert.equal(JSON.parse(r.stdout).branch, 'adhoc/reword-the-guide');
  });

  test('a second start resumes it, and a removed worktree is given back', () => {
    const { main, sh } = bareRepo();
    const wt = pathLine(start(main, '--adhoc', 'x'));
    assert.equal(JSON.parse(start(main, '--adhoc', 'x', '--json').stdout).action, 'resumed');
    sh(`git worktree remove "${wt}"`);
    const r = start(main, '--adhoc', 'x', '--json');
    assert.equal(r.code, 0, out(r));
    assert.equal(JSON.parse(r.stdout).path, wt);
  });

  test('the main-checkout rules still hold: a dirty tree and a linked worktree are refused', () => {
    const { main } = bareRepo();
    const wt = pathLine(start(main, '--adhoc', 'first'));
    assert.match(start(wt, '--adhoc', 'second').stderr, /linked worktree/);
    writeFileSync(join(main, 'stray.txt'), 'someone else\'s work');
    const r = start(main, '--adhoc', 'second');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /uncommitted changes[\s\S]*stray\.txt/);
  });

  test('--adhoc with no slug, or with an ID as well, is a usage error', () => {
    const { main } = bareRepo();
    assert.equal(start(main, '--adhoc').code, 2);
    assert.equal(start(main, '--adhoc', '!!!').code, 2);
    assert.equal(start(main, 'P3', '--adhoc', 'x').code, 2);
    assert.equal(start(main, '--adhoc', 'x', '--slug', 'y').code, 2);
    // A flag right after --adhoc is the next flag, not a slug.
    assert.equal(start(main, '--adhoc', '--json').code, 2);
    assert.equal(git1(main, 'branch --list "adhoc/*"'), '');
  });

  test('an entry ID without --adhoc is still gated exactly as before', () => {
    const { main } = bareRepo();
    const r = start(main, 'P3');
    assert.equal(r.code, 1, out(r));
    assert.match(r.stderr, /no entry on main.*\/triage/s);
  });
});

describe('the repo is set up for the worktrees /implement makes (P15 R1)', () => {
  test('.claude/worktrees/ is gitignored, so the main checkout stays clean', () => {
    const r = spawnSync('git', ['check-ignore', '-q', '.claude/worktrees/p1-x/file'], { cwd: REPO });
    assert.equal(r.status, 0, '.claude/worktrees/ must be ignored');
  });

  test('settings.json sets worktree.baseRef to head (A-6)', () => {
    const s = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'));
    assert.equal(s.worktree?.baseRef, 'head');
  });

  test('CLAUDE.md authorizes EnterWorktree for the path the script prints', () => {
    // EnterWorktree acts only on the user's or CLAUDE.md's instruction; without this
    // line /implement's step is a request the tool is told to ignore.
    const t = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
    assert.match(t, /scripts\/worktree\.mjs start/);
    assert.match(t, /EnterWorktree/);
    assert.match(t, /ExitWorktree/);
  });

  test('/implement starts the worktree after the claim, not before', () => {
    const t = readFileSync(join(REPO, '.claude', 'skills', 'implement', 'SKILL.md'), 'utf8');
    const claim = t.indexOf('in-progress` **via /ship, committed on main before branching**');
    const wt = t.indexOf('node scripts/worktree.mjs start');
    assert.ok(claim > 0 && wt > claim, 'the worktree step must follow the claim step');
  });
});
