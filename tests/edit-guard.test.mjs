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
import { fnmatch, isBlocked, pathsFrom } from '../.claude/edit-guard.mjs';

const GUARD = join(REPO, '.claude', 'edit-guard.mjs');

function guard(payload) {
  const r = spawnSync(process.execPath, [GUARD], {
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
    assert.equal(guard({ tool_input: { file_path: '.claude/edit-guard.mjs' } }).code, BLOCKED);
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

  test('a non-string file_path does not crash the guard', () => {
    assert.equal(guard({ tool_input: { file_path: 42 } }).code, ALLOWED);
    assert.equal(guard({ tool_input: { edits: [null, { file_path: null }] } }).code, ALLOWED);
  });
});

// The pattern matcher is Python's fnmatch, reimplemented for the port off python3.
// It is the only genuinely new logic in that file, so it gets tested directly rather
// than only through the four hundred paths the CLI could take to reach it.
describe('fnmatch semantics (NOT glob — `*` crosses separators)', () => {
  test('* spans directory separators, so **/ and */ mean the same thing', () => {
    assert.ok(fnmatch('src/generated/deep/f.js', 'src/generated/**'));
    assert.ok(fnmatch('src/generated/deep/f.js', 'src/generated/*'));
  });

  test('? is exactly one character', () => {
    assert.ok(fnmatch('tmp1.md', 'tmp?.md'));
    assert.ok(!fnmatch('tmpXY.md', 'tmp?.md'));
  });

  test('character classes, including negation', () => {
    assert.ok(fnmatch('note7.md', 'note[0-9].md'));
    assert.ok(!fnmatch('noteA.md', 'note[0-9].md'));
    assert.ok(fnmatch('noteA.md', 'note[!0-9].md'));
  });

  test('an unterminated class is a literal bracket, as in Python', () => {
    assert.ok(fnmatch('a[b', 'a[b'));
  });

  test('regex metacharacters in a pattern are literal', () => {
    assert.ok(fnmatch('a.lock', '*.lock'));
    assert.ok(!fnmatch('axlock', '*.lock'), '`.` must not behave as a regex wildcard');
    assert.ok(fnmatch('v1.2+build', 'v1.2+build'));
  });

  test('the match is anchored at both ends', () => {
    assert.ok(!fnmatch('xdocs/SPEC.mdx', 'docs/SPEC.md'));
  });
});

describe('the four matching rules', () => {
  const pats = ['docs/dev_notes/', 'docs/SPEC.md', '*.lock'];

  test('folder prefix blocks the directory itself and everything under it', () => {
    assert.equal(isBlocked('docs/dev_notes', pats), 'docs/dev_notes/');
    assert.equal(isBlocked('docs/dev_notes/deep/x.md', pats), 'docs/dev_notes/');
  });

  test('a basename glob blocks that filename anywhere', () => {
    assert.equal(isBlocked('some/deep/path/package-lock.json', ['*-lock.json']), '*-lock.json');
  });

  test('nothing matches → null, not a throw', () => {
    assert.equal(isBlocked('src/app.js', pats), null);
  });
});

describe('path extraction', () => {
  test('Edit/Write and MultiEdit paths are all collected', () => {
    assert.deepEqual(pathsFrom({ tool_input: { file_path: 'a.md' } }), ['a.md']);
    assert.deepEqual(
      pathsFrom({ tool_input: { file_path: 'a.md', edits: [{ file_path: 'b.md' }] } }),
      ['a.md', 'b.md'],
    );
    assert.deepEqual(pathsFrom({}), []);
  });
});
