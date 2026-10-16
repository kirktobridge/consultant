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
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO, P, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles,
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
