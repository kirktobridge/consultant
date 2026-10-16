// Layer 2 — session-audit, against real git repositories.
//
// Nothing here is mocked. The audit's whole value is that it reads actual merge state
// rather than trusting a status line, so a test that faked git would be testing the
// opposite of the thing.
//
// The most important assertion in the file is the LAST one: exit 2 must be
// distinguishable from exit 0. An audit that could not run looks exactly like an audit
// that found nothing (LESSONS L3), and the session reading it at startup has to
// be able to tell which one it got.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { P, A, D, decidedD, REPO, project, gitInit, run, out, daysAgo, tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const CLEAN = 0;
const FINDINGS = 1;
const CANNOT_AUDIT = 2;

const audit = (dir, args = []) => run('session-audit.mjs', args, { cwd: dir });

/** A committed project on `main`, ready to have branches and drift added. */
function repo(opts = {}) {
  const dir = project(opts);
  const g = gitInit(dir, opts.base ?? 'main');
  return { dir, g };
}

describe('the clean path', () => {
  test('a committed repo with honest statuses reports clean, exit 0', () => {
    const { dir } = repo();
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
    assert.match(r.stdout, /clean \(base main\)/);
  });

  // P6: `released` is optional. A project that never deploys must never be nagged for it.
  test('shipped entries that were never released still report clean', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2', { status: 'shipped', shipped: daysAgo(1) })] });
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
    assert.doesNotMatch(r.stdout, /releas/i);
  });
});

describe('working tree', () => {
  test('uncommitted changes are noted', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'docs', 'backlog', 'QUEUE.md'), '# edited\n');
    const r = audit(dir);
    assert.equal(r.code, FINDINGS);
    assert.match(r.stdout, /uncommitted change/);
  });

  test('an untracked file inside a TRACKED code dir names the file', () => {
    const { dir, g } = repo();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'kept.js'), '// tracked\n');
    g.commitAll('add src');
    writeFileSync(join(dir, 'src', 'stray.js'), '// oops\n');
    const r = audit(dir);
    assert.match(r.stdout, /\[CHECK\].*Untracked file\(s\) under code directories.*stray\.js/s);
  });

  test('a wholly-untracked code dir is reported as the directory', () => {
    // git collapses an untracked directory to `?? src/` and never lists its contents,
    // so the finding names the dir. Pinned because it is the case that reads oddly and
    // would otherwise get "fixed" into a filename that git never emits.
    const { dir } = repo();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'stray.js'), '// oops\n');
    const r = audit(dir);
    assert.match(r.stdout, /\[CHECK\].*Untracked file\(s\) under code directories.*src\//s);
  });
});

describe('claims that no longer match reality', () => {
  test('in-progress with a live unmerged branch is legitimately in flight — silent', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    g.checkout('feat/p1-thing', true);
    g.commitAll('work');
    g.checkout('main');
    const r = audit(dir);
    assert.doesNotMatch(r.stdout, /P1 is `in-progress`/);
  });

  test('in-progress whose branch already merged → a flip is owed, and shipped is the user\'s', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    g.checkout('feat/p1-thing', true);
    g.commitAll('work');
    g.checkout('main');
    g.merge('feat/p1-thing');
    const r = audit(dir);
    assert.equal(r.code, FINDINGS);
    assert.match(r.stdout, /P1 is `in-progress` but its branch is already merged into main/);
    assert.match(r.stdout, /run \/ship on main/);
    // P4 R2: /land leaves a last milestone `in-progress`, so this state is also
    // "awaiting acceptance" — the audit must not send the session off to flip it.
    assert.match(r.stdout, /awaits the user's acceptance/);
    assert.match(r.stdout, /`shipped` is their flip, never yours/);
  });

  test('in-progress with no branch anywhere → an abandoned claim', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    const r = audit(dir);
    assert.match(r.stdout, /P1 is `in-progress` but no branch names it/);
    assert.match(r.stdout, /a stale claim is worse than no claim/);
    assert.match(r.stdout, /`shipped` once the user accepts it/);
  });

  test('a branch for a longer ID does not hide an abandoned claim', () => {
    // The check once matched by substring, so feat/p18-… counted as P1's branch.
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P18')] });
    g.checkout('feat/p18-other', true);
    g.commitAll('work');
    g.checkout('main');
    assert.match(audit(dir).stdout, /P1 is `in-progress` but no branch names it/);
  });
});

describe('spikes in flight', () => {
  test('an in-progress spike whose assumption is still open is surfaced', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P9', { status: 'in-progress', resolves: 'A-1' })],
      assumptions: [A('A-1')],
    });
    const r = audit(dir);
    assert.match(r.stdout, /Spike P9 is `in-progress` and A-1 is still `open`/);
    assert.match(r.stdout, /only in the transcript is lost/);
  });

  test('a proposed spike is not nagged about — nobody claimed to have an answer', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P9', { resolves: 'A-1' })],
      assumptions: [A('A-1')],
    });
    assert.doesNotMatch(audit(dir).stdout, /Spike P9/);
  });
});

describe('resolutions nobody swept', () => {
  test('an assumption refuted today with live dependents raises an ALERT, ranked first', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'refuted', resolved: daysAgo(0), resolution: 'wrong.' })],
    });
    const r = audit(dir);
    assert.equal(r.code, FINDINGS);
    assert.match(r.stdout, /\[ALERT\] A-1 is `refuted` \(resolved today\)/);
    assert.match(r.stdout, /can VOID dependents rather than unblock them/);
    // Severity ordering is the point of the labels — the urgent case must lead.
    assert.ok(
      r.stdout.indexOf('[ALERT]') < (r.stdout.indexOf('[CHECK]') + 1 || Infinity),
      'ALERT must be reported before CHECK',
    );
  });

  test('a verified assumption is an unblock note, not an alert', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(0), resolution: 'held.' })],
    });
    const r = audit(dir);
    assert.match(r.stdout, /A-1 is `verified`/);
    assert.match(r.stdout, /now unblocked and nothing else will notice/);
    assert.doesNotMatch(r.stdout, /\[ALERT\]/);
  });

  test('an assumption resolved long ago with no dependents is not re-reported forever', () => {
    const { dir } = repo({
      backlog: [P('P1')],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(400), resolution: 'held.' })],
    });
    assert.equal(audit(dir).code, CLEAN);
  });

  test('a decision taken today with dependents is an unblock note', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['D-1'] })],
      decisions: [decidedD('D-1', { decided: daysAgo(0) })],
    });
    const r = audit(dir);
    assert.match(r.stdout, /\[note \] D-1 is `decided` \(decided today\) and 1 entr\(y\/ies\) depend on it: P2/);
    assert.doesNotMatch(r.stdout, /\[ALERT\]/);
  });
});

describe('choices waiting on the user (P10)', () => {
  // Accept criterion: a choice only the product owner can make is listed somewhere
  // they can see at a glance, with what it is waiting on.
  test('an open decision waiting on the user is listed, with what else it waits on and what it holds back', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['D-1'] })],
      decisions: [D('D-1', { title: 'Do exports count toward the cap?', waitingOn: 'user, P1' })],
    });
    const r = audit(dir);
    assert.match(r.stdout, /Waiting on the user — choices only they can make/);
    assert.match(r.stdout, /D-1 — Do exports count toward the cap\? \(also waiting on P1\) — holds back P2/);
  });

  test('it is not a finding: the audit still reports clean, exit 0', () => {
    const { dir } = repo({ decisions: [D('D-1')] });
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
    assert.match(r.stdout, /clean \(base main\)[\s\S]*D-1 — D-1 example/);
  });

  test('a decision waiting only on other entries, or already decided, is not listed', () => {
    const { dir } = repo({
      decisions: [D('D-1', { waitingOn: 'P1' }), decidedD('D-2')],
    });
    assert.doesNotMatch(audit(dir).stdout, /Waiting on the user/);
  });

  test('--json carries the list', () => {
    const { dir } = repo({ decisions: [D('D-1')] });
    const j = JSON.parse(audit(dir, ['--json']).stdout);
    assert.deepEqual(j.waitingOnUser, [{ id: 'D-1', title: 'D-1 example', alsoWaitingOn: [], holds: [] }]);
  });
});

describe('unmerged branches are not findings by themselves', () => {
  // P18 retired the baton file, and with it the "branch with no handoff section"
  // check. A branch is in-flight work; git already records it, and `npm run history`
  // shows its latest commit message.
  test('an unmerged branch with no claim attached is not flagged', () => {
    const { dir, g } = repo();
    g.checkout('feat/orphan', true);
    g.commitAll('work');
    g.checkout('main');
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
    assert.doesNotMatch(r.stdout, /feat\/orphan/);
  });
});

describe('the SessionStart hook, run as the harness runs it', () => {
  // The command string in settings.json, executed by a shell in a fixture project.
  // The script's own exit code is the wrong thing to test here: what reaches the
  // session is decided by the *hook's* exit (A-10 — non-zero drops the output).
  const settings = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'));
  const command = settings.hooks.SessionStart.flatMap((g) => g.hooks).find((h) => /session-audit/.test(h.command)).command;
  // The fixture has no copy of the script, so point the hook's script path at this repo's.
  const hook = (dir) => {
    const r = spawnSync('sh', ['-c', command.replace('$CLAUDE_PROJECT_DIR/scripts/', `${REPO}/scripts/`)], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  test('an abandoned claim reaches stdout, and the hook still exits 0', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    const r = hook(dir);
    assert.equal(r.code, 0, 'a non-zero hook exit drops the findings (A-10)');
    assert.match(r.stdout, /P1 is `in-progress` but no branch names it/);
  });

  test('a clean project says so', () => {
    const { dir } = repo();
    const r = hook(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /session-audit: clean/);
  });

  test('an audit that could not run says so on stdout, not silently', () => {
    // stderr's fate under SessionStart was not probed (A-10), so the hook folds it
    // into stdout — otherwise "could not audit" would look like no output at all.
    const r = hook(tempDir());
    assert.equal(r.code, 0);
    assert.match(r.stdout, /not a git repository/);
  });
});

describe('base branch resolution', () => {
  test('master is found when main does not exist', () => {
    const { dir } = repo({ base: 'master' });
    assert.match(audit(dir).stdout, /\(base master\)/);
  });

  test('--base is honoured', () => {
    const { dir } = repo();
    assert.match(audit(dir, ['--base', 'main']).stdout, /\(base main\)/);
  });

  test('--json does not get parsed as the branch name', () => {
    // indexOf returns -1 when a flag is absent, and argv[-1 + 1] is argv[0].
    const { dir } = repo();
    const parsed = JSON.parse(audit(dir, ['--json']).stdout);
    assert.equal(parsed.base, 'main');
    assert.ok(Array.isArray(parsed.findings));
  });
});

describe('an audit that could not run is NOT a clean audit (L3)', () => {
  test('a non-repo exits 2, distinguishable from clean', () => {
    const dir = tempDir();
    const r = audit(dir);
    assert.equal(r.code, CANNOT_AUDIT);
    assert.match(r.stderr, /not a git repository/);
    assert.doesNotMatch(out(r), /clean/);
  });

  test('when git refuses a repo, its own reason is passed on', () => {
    // A Windows git refusing a WSL repo ("dubious ownership") used to read as "not a
    // git repository", which sends the reader after the wrong fix. A .git file
    // pointing nowhere is a portable way to make git refuse with a reason of its own.
    const dir = tempDir();
    writeFileSync(join(dir, '.git'), 'gitdir: /nonexistent/gitdir\n');
    const r = audit(dir);
    assert.equal(r.code, CANNOT_AUDIT);
    assert.match(r.stderr, /\n  git: fatal: .*nonexistent/);
  });

  test('git is run without a shell — cmd.exe cannot start in a WSL (UNC) directory', () => {
    // Under a Windows `claude`, execSync ran git from C:\Windows and every check
    // came back "not a git repository". The fix is execFileSync; hold it in place.
    for (const name of ['session-audit.mjs', 'history.mjs']) {
      const src = readFileSync(join(REPO, 'scripts', name), 'utf8');
      assert.doesNotMatch(src, /import\s*\{[^}]*\bexecSync\b/, `${name} shells out to git`);
      assert.match(src, /safe\.directory=\*/, `${name} must lift git's ownership check (Windows git on WSL files)`);
    }
  });

  test('a repo with no recognisable integration branch exits 2 and says how to fix it', () => {
    const dir = project();
    gitInit(dir, 'weird-name');
    const r = audit(dir);
    assert.equal(r.code, CANNOT_AUDIT);
    assert.match(r.stderr, /no integration branch found/);
    assert.match(r.stderr, /Pass --base/);
  });
});
