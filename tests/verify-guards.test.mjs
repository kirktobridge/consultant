// Does the disarm-detector actually detect disarming?
//
// This check guards the thing that guards everything else, so a false "armed" is the
// most expensive possible green in the repo. Every case below is a way settings.json
// could be edited that leaves the suite unprotected, and each asserts a failure.
//
// The cases are written as they would appear in a diff, because that is how they will
// actually arrive: not as sabotage, but as a tidy-up, a rename, a narrowed matcher.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, run, out, tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const ARMED = 0;
const DISARMED = 1;
const DISARMED_HOOK = 2;

/** A copy of the real .claude/ plus scripts/, so tests mutate a throwaway. */
function guarded(mutate = () => {}) {
  const dir = tempDir();
  mkdirSync(join(dir, '.claude'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(REPO, '.claude', 'settings.json'), join(dir, '.claude', 'settings.json'));
  cpSync(join(REPO, '.claude', 'edit-blocklist'), join(dir, '.claude', 'edit-blocklist'));
  cpSync(join(REPO, '.claude', 'edit-guard.mjs'), join(dir, '.claude', 'edit-guard.mjs'));
  for (const s of ['backlog-schema-check.mjs', 'verify-guards.mjs']) {
    cpSync(join(REPO, 'scripts', s), join(dir, 'scripts', s));
  }
  mutate({
    dir,
    settings: (fn) => {
      const p = join(dir, '.claude', 'settings.json');
      const s = JSON.parse(readFileSync(p, 'utf8'));
      writeFileSync(p, JSON.stringify(fn(s) ?? s, null, 2));
    },
    raw: (rel, content) => writeFileSync(join(dir, rel), content),
    remove: (rel) => rmSync(join(dir, rel), { force: true }),
  });
  return dir;
}

const check = (dir, args = ['--all']) => run('verify-guards.mjs', args, { cwd: dir });

const disarmed = (dir, needle) => {
  const r = check(dir);
  assert.equal(r.code, DISARMED, `expected DISARMED, got ${r.code}:\n${out(r)}`);
  assert.match(r.stderr, /THE ENFORCEMENT LAYER IS DISARMED/);
  if (needle) assert.match(r.stderr, needle);
  return r.stderr;
};

describe('the armed baseline', () => {
  test('an untouched copy of the real config reports armed', () => {
    const r = check(guarded());
    assert.equal(r.code, ARMED, out(r));
    assert.match(r.stdout, /armed \(2 hooks verified, blocklist intact\)/);
  });

  test('adding unrelated hooks and permissions is fine — properties, not equality', () => {
    const dir = guarded(({ settings }) =>
      settings((s) => {
        s.permissions = { allow: ['Bash(npm test)'] };
        s.hooks.Stop = [{ matcher: '*', hooks: [{ type: 'command', command: 'echo done' }] }];
        s.hooks.PreToolUse.push({
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo linting' }],
        });
        return s;
      }),
    );
    assert.equal(check(dir).code, ARMED, 'the config must stay extensible');
  });
});

describe('ways the guard gets removed', () => {
  test('the PreToolUse hook is deleted outright', () => {
    const dir = guarded(({ settings }) => settings((s) => { delete s.hooks.PreToolUse; return s; }));
    disarmed(dir, /PreToolUse no longer runs edit-guard/);
  });

  test('the hooks block is emptied', () => {
    const dir = guarded(({ settings }) => settings((s) => { s.hooks = {}; return s; }));
    const e = disarmed(dir, /PreToolUse no longer runs edit-guard/);
    assert.match(e, /PostToolUse no longer runs backlog-schema-check/, 'both must be reported, not just the first');
  });

  test('the whole file is replaced with something innocuous', () => {
    const dir = guarded(({ raw }) => raw('.claude/settings.json', '{"permissions":{"allow":[]}}'));
    disarmed(dir, /no longer runs edit-guard/);
  });

  test('the file is corrupted — unparseable JSON runs NO hooks at all', () => {
    const dir = guarded(({ raw }) => raw('.claude/settings.json', '{ oops'));
    disarmed(dir, /not valid JSON.*No hooks are running/s);
  });

  test('the command is repointed at a script that does not exist', () => {
    const dir = guarded(({ settings }) =>
      settings((s) => {
        s.hooks.PreToolUse[0].hooks[0].command = 'node "$CLAUDE_PROJECT_DIR/.claude/edit-guard-v2.mjs"';
        return s;
      }),
    );
    disarmed(dir, /does not exist — the hook fails open/);
  });
});

describe('ways the guard gets quietly narrowed — the ones that read as tidy-ups', () => {
  test('the matcher is narrowed to Edit only, leaving Write and MultiEdit open', () => {
    const dir = guarded(({ settings }) =>
      settings((s) => { s.hooks.PreToolUse[0].matcher = 'Edit'; return s; }),
    );
    disarmed(dir, /does not cover Write, MultiEdit — those writes are unguarded/);
  });

  test('MultiEdit alone is dropped', () => {
    const dir = guarded(({ settings }) =>
      settings((s) => { s.hooks.PreToolUse[0].matcher = 'Edit|Write'; return s; }),
    );
    disarmed(dir, /does not cover MultiEdit/);
  });

  test('the guard is moved from PreToolUse to PostToolUse — reports after the write', () => {
    const dir = guarded(({ settings }) =>
      settings((s) => {
        const g = s.hooks.PreToolUse[0];
        delete s.hooks.PreToolUse;
        s.hooks.PostToolUse.push(g);
        return s;
      }),
    );
    disarmed(dir, /PreToolUse no longer runs edit-guard/);
  });

  test('a wildcard matcher is accepted — it covers everything', () => {
    const dir = guarded(({ settings }) =>
      settings((s) => { s.hooks.PreToolUse[0].matcher = '*'; return s; }),
    );
    assert.equal(check(dir).code, ARMED);
  });
});

describe('ways the blocklist gets disarmed', () => {
  test('the blocklist stops protecting the guard script', () => {
    const dir = guarded(({ raw }) => raw('.claude/edit-blocklist', 'docs/SPEC.md\n.claude/edit-blocklist\n'));
    disarmed(dir, /no longer protects \.claude\/edit-guard\.mjs/);
  });

  test('the blocklist stops protecting itself', () => {
    const dir = guarded(({ raw }) => raw('.claude/edit-blocklist', 'docs/SPEC.md\n.claude/edit-guard.mjs\n'));
    disarmed(dir, /no longer protects \.claude\/edit-blocklist/);
  });

  test('the blocklist is deleted — the guard then permits everything', () => {
    const dir = guarded(({ remove }) => remove('.claude/edit-blocklist'));
    disarmed(dir, /is missing — the guard has no patterns and permits everything/);
  });

  test('a commented-out protection line does not count as protection', () => {
    const dir = guarded(({ raw }) =>
      raw('.claude/edit-blocklist', 'docs/SPEC.md\n# .claude/edit-guard.mjs\n.claude/edit-blocklist\n'),
    );
    disarmed(dir, /no longer protects \.claude\/edit-guard\.mjs/);
  });
});

describe('hook mode', () => {
  test('editing settings.json triggers the check and exits 2 when disarmed', () => {
    const dir = guarded(({ settings }) => settings((s) => { delete s.hooks.PreToolUse; return s; }));
    const r = run('verify-guards.mjs', [], {
      cwd: dir,
      input: JSON.stringify({ tool_input: { file_path: '.claude/settings.json' } }),
    });
    assert.equal(r.code, DISARMED_HOOK, 'hook mode must exit 2 so the message reaches the session');
  });

  test('editing an unrelated file does not run the check', () => {
    const dir = guarded(({ settings }) => settings((s) => { delete s.hooks.PreToolUse; return s; }));
    const r = run('verify-guards.mjs', [], {
      cwd: dir,
      input: JSON.stringify({ tool_input: { file_path: 'README.md' } }),
    });
    assert.equal(r.code, ARMED, 'unrelated edits must not pay for this check');
  });

  test('the failure names npm test as the copy that actually holds', () => {
    const dir = guarded(({ settings }) => settings((s) => { delete s.hooks.PreToolUse; return s; }));
    assert.match(check(dir).stderr, /npm test.*cannot be trusted to catch settings\.json being edited/s);
  });
});
