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
  REPO, P, B, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles,
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
