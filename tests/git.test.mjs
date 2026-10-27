// git.mjs, the shared git runner: what it returns, and what it says when git fails.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from '../scripts/git.mjs';
import { tempDir, cleanupAll, gitInit } from './helpers/fixture.mjs';

after(cleanupAll);

describe('gitIn', () => {
  test('output keeps its leading column; only the final newline goes', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    const { commitAll } = gitInit(dir);
    commitAll('a');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    assert.equal(gitIn(dir)('status', '--porcelain'), ' M a.txt');
  });

  test('a failure is null, and firstError names the conflict, not the progress before it', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'base\n');
    const { commitAll, checkout } = gitInit(dir);
    commitAll('base');
    checkout('side', true);
    writeFileSync(join(dir, 'a.txt'), 'side\n');
    commitAll('side');
    checkout('main');
    writeFileSync(join(dir, 'a.txt'), 'main\n');
    commitAll('main');
    const git = gitIn(dir);
    assert.equal(git('merge', '--no-edit', 'side'), null);
    assert.match(git.error(), /Auto-merging a\.txt/);
    assert.match(git.firstError(), /^CONFLICT \(content\)/);
  });

  test('outside a repository it fails with git\'s own reason', () => {
    const git = gitIn(tempDir());
    assert.equal(git('rev-parse', '--show-toplevel'), null);
    assert.match(git.firstError(), /^fatal: not a git repository/);
  });
});
