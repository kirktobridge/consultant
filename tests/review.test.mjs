// When /implement's review step runs, and when it may be skipped (P8).
//
// The skip rule is a condition anyone can re-check: only Markdown changed against the
// integration branch. Each case builds a real repo with a feature branch and asks
// scripts/review.mjs — the same call the skill makes.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, out, tempDir, cleanupAll, gitInit } from './helpers/fixture.mjs';

after(cleanupAll);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A repo with one commit on main and a feature branch checked out. */
function repo() {
  const dir = tempDir();
  writeFileSync(join(dir, 'README.md'), '# r\n');
  const g = gitInit(dir);
  g.checkout('feat/x', true);
  const put = (path, text = 'x\n') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  return { dir, put, ...g };
}
const review = (cwd, ...args) => run('review.mjs', args, { cwd });

describe('review.mjs: the skip rule is a condition, not a judgement (P8)', () => {
  test('no changes at all: skippable, and it says why', () => {
    const { dir } = repo();
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /^review: skip — no changes against main$/m);
  });

  test('a Markdown-only diff, committed and uncommitted: skippable', () => {
    const { dir, put, commitAll } = repo();
    put('docs/a.md');
    commitAll();
    put('.claude/skills/x/SKILL.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /only Markdown changed against main \(2 file\(s\)\)/);
  });

  test('one code file among the Markdown makes it required', () => {
    const { dir, put, commitAll } = repo();
    put('docs/a.md');
    put('scripts/x.mjs');
    commitAll();
    const r = review(dir);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /^review: required$/m);
    assert.match(r.stdout, /^security-review: not warranted$/m);
    assert.match(r.stdout, /scripts\/x\.mjs/);
  });

  test('an untracked code file counts — the step runs before the build commit', () => {
    const { dir, put } = repo();
    put('src/new.js');
    assert.equal(review(dir).code, 0);
  });

  test('deleting a code file counts', () => {
    const { dir, put, commitAll, checkout, sh } = repo();
    checkout('main');
    put('lib.js');
    commitAll();
    checkout('feat/y', true);
    sh('git rm -q lib.js');
    assert.equal(review(dir).code, 0);
  });

  test('changes already on main are not this branch\'s diff', () => {
    const { dir, put, commitAll, checkout } = repo();
    checkout('main');
    put('scripts/landed.mjs');
    commitAll();
    checkout('feat/y', true);
    put('notes.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
  });

  for (const path of ['.claude/hooks/h.mjs', '.claude/settings.json', 'package.json', '.github/workflows/ci.yml', '.claude/edit-blocklist']) {
    test(`touching ${path} warrants a security review`, () => {
      const { dir, put } = repo();
      put(path, path.endsWith('.json') ? '{}\n' : 'x\n');
      const r = review(dir);
      assert.equal(r.code, 0, out(r));
      assert.match(r.stdout, /^security-review: warranted$/m);
      assert.ok(r.stdout.includes(path), r.stdout);
    });
  }

  describe('what a hook in .claude/settings.json runs is read from it, not listed by hand', () => {
    /** main registers two hooks; one imports a module, which imports another. */
    function hooked() {
      const r = repo();
      r.checkout('main');
      r.put('.claude/settings.json', JSON.stringify({ hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/audit.mjs" || true' }] }],
        PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/guard.mjs"' }] }],
      } }));
      r.put('scripts/audit.mjs', "import { x } from './lib.mjs';\n");
      r.put('scripts/lib.mjs', "import './deep/more.mjs';\n");
      r.put('scripts/deep/more.mjs');
      r.put('scripts/other.mjs');
      r.put('.claude/guard.mjs');
      r.commitAll();
      r.checkout('feat/h', true);
      return r;
    }
    for (const path of ['scripts/audit.mjs', '.claude/guard.mjs', 'scripts/lib.mjs', 'scripts/deep/more.mjs']) {
      test(`${path} is hook-run, so it warrants one`, () => {
        const { dir, put } = hooked();
        put(path, 'changed\n');
        const r = review(dir);
        assert.match(r.stdout, /^security-review: warranted$/m, out(r));
        assert.ok(r.stdout.includes(path), r.stdout);
      });
    }
    test('a script no hook reaches does not', () => {
      const { dir, put } = hooked();
      put('scripts/other.mjs', 'changed\n');
      assert.match(review(dir).stdout, /^security-review: not warranted$/m);
    });
  });

  test('Markdown in a security path is not skipped', () => {
    const { dir, put } = repo();
    put('.claude/hooks/README.md');
    const r = review(dir);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /^security-review: warranted$/m);
  });

  test('run from a subdirectory, it still sees the whole tree, by repo-root paths', () => {
    const { dir, put } = repo();
    put('docs/x.md');
    put('scripts/new.mjs');
    put('.claude/hooks/pre-push');
    const r = run('review.mjs', [], { cwd: join(dir, 'docs') });
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /scripts\/new\.mjs/);
    assert.match(r.stdout, /^security-review: warranted$/m);
  });

  test('a Markdown file with a non-ASCII name is still Markdown', () => {
    const { dir, put, commitAll } = repo();
    put('docs/café.md');
    commitAll();
    put('docs/naïve.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
  });

  test('--json carries the same verdict', () => {
    const { dir, put } = repo();
    put('scripts/install-hooks.mjs');
    const j = JSON.parse(review(dir, '--json').stdout);
    assert.equal(j.base, 'main');
    assert.equal(j.review, true);
    assert.equal(j.security, true);
    assert.deepEqual(j.securityFiles, ['scripts/install-hooks.mjs']);
  });

  test('no integration branch: exit 2, never a skip', () => {
    const dir = tempDir();
    gitInit(dir, 'develop');
    const r = review(dir);
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /no integration branch/);
  });

  test('--base names the integration branch', () => {
    const dir = tempDir();
    const { checkout } = gitInit(dir, 'develop');
    checkout('feat/z', true);
    writeFileSync(join(dir, 'a.js'), 'x\n');
    const r = review(dir, '--base', 'develop');
    assert.equal(r.code, 0, out(r));
  });

  test('--base takes any ref that resolves, and refuses a missing one', () => {
    const { dir, put, sh } = repo();
    sh('git tag v1 main');
    put('a.js');
    assert.equal(review(dir, '--base', 'v1').code, 0);
    const r = review(dir, '--base');
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /--base needs a ref/);
    assert.equal(review(dir, '--base', 'nope').code, 2);
  });
});

describe('review.mjs: a changed SKILL.md names the eval cases that measure it (P48)', () => {
  /**
   * A stand-in for evals/run.mjs's `--list --skill <s>`: these skills' cases, as the real
   * runner prints them. The real runner's selection is tested on its own, below.
   */
  const runner = (skills) =>
    `const CASES = ${JSON.stringify(skills.map((skill, i) => ({ id: `c${i}`, skill })))};\n` +
    "const s = process.argv[process.argv.indexOf('--skill') + 1];\n" +
    'console.log(JSON.stringify({ cases: CASES.filter((c) => c.skill === s) }));\n';

  /** A repo whose main carries an eval runner, then a fresh branch off it. */
  function suite(skills, source = runner(skills)) {
    const r = repo();
    r.checkout('main');
    r.put('evals/run.mjs', source);
    r.put('.claude/skills/old/SKILL.md');
    r.commitAll();
    r.checkout('feat/eval', true);
    return r;
  }
  const evalLines = (r) => r.stdout.split('\n').filter((l) => l.startsWith('eval:'));

  test('a Markdown-only diff to the implement SKILL.md: still skippable, and an eval line names implement and its case count', () => {
    const { dir, put } = suite(['implement', 'implement', 'triage']);
    put('.claude/skills/implement/SKILL.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
    assert.match(r.stdout, /^review: skip — only Markdown changed/m);
    assert.deepEqual(evalLines(r), [
      "eval: implement's SKILL.md changed — 2 eval case(s) measure it: npm run eval -- --skill implement (advisory; the owner decides whether to run them)",
    ]);
  });

  test('with code in the diff too: still required, exit 0, and the eval line comes after', () => {
    const { dir, put } = suite(['implement']);
    put('.claude/skills/implement/SKILL.md');
    put('scripts/x.mjs');
    const r = review(dir);
    assert.equal(r.code, 0, out(r));
    assert.match(r.stdout, /^review: required$/m);
    assert.match(evalLines(r)[0], /^eval: implement's SKILL\.md changed — 1 eval case\(s\)/);
  });

  test('the exit code is the same with the eval line as without it', () => {
    for (const extra of [[], ['scripts/x.mjs']]) {
      const withSkill = suite(['implement']);
      const without = suite(['implement']);
      withSkill.put('.claude/skills/implement/SKILL.md');
      without.put('docs/a.md');
      for (const f of extra) {
        withSkill.put(f);
        without.put(f);
      }
      const a = review(withSkill.dir);
      const b = review(without.dir);
      assert.equal(evalLines(a).length, 1, out(a));
      assert.equal(evalLines(b).length, 0, out(b));
      assert.equal(a.code, b.code, `${out(a)}\n---\n${out(b)}`);
    }
  });

  test('a diff touching no SKILL.md prints no eval line', () => {
    const { dir, put } = suite(['implement']);
    put('docs/a.md');
    put('.claude/skills/implement/notes.md'); // a skill's other files are not the prose under test
    put('scripts/x.mjs');
    const r = review(dir);
    assert.deepEqual(evalLines(r), [], out(r));
  });

  test('a skill with no cases says it has none, rather than staying silent', () => {
    const { dir, put } = suite(['implement']);
    put('.claude/skills/land/SKILL.md');
    put('.claude/skills/implement/SKILL.md');
    const r = review(dir);
    assert.equal(r.code, 1, out(r));
    assert.deepEqual(evalLines(r).map((l) => l.slice(0, 60)), [
      "eval: implement's SKILL.md changed — 1 eval case(s) measure ",
      "eval: land's SKILL.md changed — it has no eval cases",
    ]);
  });

  test('no eval runner, or one that fails, prints nothing usable or exits itself: it says so, and its exit code and stdout stay out', () => {
    const none = repo();
    none.put('.claude/skills/implement/SKILL.md');
    const r = review(none.dir);
    assert.equal(r.code, 1, out(r));
    assert.match(evalLines(r)[0], /^eval: implement's SKILL\.md changed — its cases can't be counted \(no evals\/run\.mjs here\)$/);

    const broken = {
      'a syntax error': ['const CASES = [;\n', /evals\/run\.mjs --list failed: /],
      'its own exit code': ["console.error('boom'); process.exit(7);\n", /evals\/run\.mjs --list failed: boom/],
      'noise and no list': ["console.log('review: required'); process.exit(0);\n", /evals\/run\.mjs --list printed no case list/],
    };
    for (const [what, [source, said]] of Object.entries(broken)) {
      const b = suite([], source);
      b.put('.claude/skills/implement/SKILL.md');
      const x = review(b.dir);
      assert.equal(x.code, 1, `${what}: ${out(x)}`);
      assert.match(evalLines(x)[0], said, what);
      assert.doesNotMatch(x.stdout, /^review: required$/m, `${what}: the runner's stdout must not reach review's`);
    }
  });

  test('a deleted SKILL.md says so, rather than asking for its prose to be measured', () => {
    const { dir, sh } = suite(['old', 'old']);
    sh('git rm -q .claude/skills/old/SKILL.md');
    const r = review(dir);
    assert.deepEqual(evalLines(r), ["eval: old's SKILL.md was deleted — 2 eval case(s) still name the skill"], out(r));
  });

  test('--json carries the counts and prints no eval line', () => {
    const { dir, put } = suite(['triage', 'triage']);
    put('.claude/skills/triage/SKILL.md');
    const r = review(dir, '--json');
    assert.equal(r.code, 1, out(r));
    assert.deepEqual(JSON.parse(r.stdout).eval, [{ skill: 'triage', deleted: false, cases: 2 }]);
  });
});

describe('evals/run.mjs --list --skill: the selection review.mjs counts (P48)', () => {
  const evalRun = (...args) => spawnSync(process.execPath, [join(REPO_ROOT, 'evals', 'run.mjs'), ...args], { encoding: 'utf8' });

  test('lists exactly the cases that name the skill, the same ones a run of --skill selects', async () => {
    const { CASES } = await import('../evals/cases.mjs');
    const want = CASES.filter((c) => c.skill === 'implement').map((c) => c.id);
    assert.ok(want.length > 0);
    const r = evalRun('--list', '--skill', 'implement');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).cases.map((c) => c.id), want);
    const dry = evalRun('--dry-run', '--skill', 'implement');
    assert.equal(dry.status, 0, dry.stderr);
    for (const id of want) assert.ok(dry.stdout.includes(`✔ ${id} `), `${id} not in the dry run`);
  });

  test('a skill with no cases lists none and exits 0; a run of it exits 2', () => {
    const r = evalRun('--list', '--skill', 'no-such-skill');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { cases: [] });
    assert.equal(evalRun('--dry-run', '--skill', 'no-such-skill').status, 2);
  });

  test('a bare --skill is refused, rather than selecting every case', () => {
    const r = evalRun('--dry-run', '--skill');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--skill needs a skill name/);
  });

  test('a bare --case is refused, rather than selecting every case (B11)', () => {
    const r = evalRun('--case', '--list');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--case needs a case id/);
  });
});
