// Layer 2 — the PreToolUse guard.
//
// This is the only mechanism in the suite that stops an agent doing something, rather
// than telling it afterwards. Its failure mode is quiet in the worst direction: a
// guard that silently stops blocking looks identical to one nobody tried to violate.
//
// Exit 2 blocks the edit. Exit 0 permits it. Nothing else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './helpers/fixture.mjs';

const GUARD = join(REPO, '.claude', 'edit-guard.py');

function guard(payload) {
  const r = spawnSync('python3', [GUARD], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    cwd: REPO,
  });
  return { code: r.status ?? 1, stderr: r.stderr ?? '' };
}

const BLOCKED = 2;
const ALLOWED = 0;

describe('human-owned files are blocked', () => {
  test('the spec', () => {
    const r = guard({ tool_input: { file_path: 'docs/SPEC.md' } });
    assert.equal(r.code, BLOCKED);
    assert.match(r.stderr, /BLOCKED by edit-guard/);
  });

  test('anything under the raw idea dump', () => {
    assert.equal(guard({ tool_input: { file_path: 'docs/dev_notes/OPEN_IDEAS.md' } }).code, BLOCKED);
    assert.equal(guard({ tool_input: { file_path: 'docs/dev_notes/anything.md' } }).code, BLOCKED);
  });

  test('the guard cannot disarm itself', () => {
    // Both the blocklist and the guard script are in the blocklist on purpose: a
    // session that could edit either could grant itself everything else.
    assert.equal(guard({ tool_input: { file_path: '.claude/edit-blocklist' } }).code, BLOCKED);
    assert.equal(guard({ tool_input: { file_path: '.claude/edit-guard.py' } }).code, BLOCKED);
  });

  test('an absolute path to a blocked file is still blocked', () => {
    assert.equal(guard({ tool_input: { file_path: join(REPO, 'docs/SPEC.md') } }).code, BLOCKED);
  });

  test('MultiEdit is checked per-edit, not just on the top-level path', () => {
    const r = guard({
      tool_input: {
        file_path: 'README.md',
        edits: [{ file_path: 'README.md' }, { file_path: 'docs/SPEC.md' }],
      },
    });
    assert.equal(r.code, BLOCKED, 'a blocked path buried in edits[] must still block');
  });
});

describe('everything else is permitted', () => {
  test('the tracked docs the skills own', () => {
    assert.equal(guard({ tool_input: { file_path: 'docs/product/BACKLOG.md' } }).code, ALLOWED);
    assert.equal(guard({ tool_input: { file_path: 'docs/OPEN_DECISIONS.md' } }).code, ALLOWED);
    assert.equal(guard({ tool_input: { file_path: 'docs/ARCHITECTURE.md' } }).code, ALLOWED);
  });

  test('source and scripts', () => {
    assert.equal(guard({ tool_input: { file_path: 'scripts/whatever.mjs' } }).code, ALLOWED);
  });
});

describe('malformed input never blocks an unrelated edit', () => {
  test('unparseable stdin is a no-op', () => {
    assert.equal(guard('not json at all').code, ALLOWED);
  });

  test('a payload with no file_path is a no-op', () => {
    assert.equal(guard({ tool_input: {} }).code, ALLOWED);
  });

  test('empty stdin is a no-op', () => {
    assert.equal(guard('').code, ALLOWED);
  });
});
