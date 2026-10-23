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
import { P, B, A, D, decidedD, REPO, project, gitInit, run, out, daysAgo, tempDir, cleanupAll } from './helpers/fixture.mjs';

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

  test('an in-progress bug with no branch is a stale claim, cleared back to `open` (P5 R1)', () => {
    const { dir } = repo({ bugs: [B('B1', { status: 'in-progress' })] });
    const r = audit(dir);
    assert.match(r.stdout, /B1 is `in-progress` but no branch names it/);
    assert.match(r.stdout, /clear it back to `open`/);
    assert.match(r.stdout, /`fixed` is their flip/);
  });

  test('a bug\'s feat/b<#>- branch counts as its claim being in flight (P5 R1)', () => {
    const { dir, g } = repo({ bugs: [B('B1', { status: 'in-progress' })] });
    g.checkout('feat/b1-the-fix', true);
    g.commitAll('work');
    g.checkout('main');
    assert.doesNotMatch(audit(dir).stdout, /B1 is `in-progress`/);
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

  // P25: only a verified assumption or a decision unblocks anything. The A-1 finding
  // is picked out, so a word elsewhere in the audit can't pass or fail these.
  const finding = (stdout, id) => stdout.split('\n\n').find((f) => f.includes(`${id} is \``)) ?? '';

  test('a moved assumption names its moved_to target and says to re-point, never to promote', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] }), P('P3')],
      assumptions: [A('A-1', { status: 'moved', resolved: daysAgo(0), movedTo: 'P3', resolution: 'a choice, not a fact.' })],
    });
    const f = finding(audit(dir).stdout, 'A-1');
    assert.match(f, /A-1 is `moved` \(resolved today\) and 1 entr\(y\/ies\) depend on it: P2 \(proposed\)/);
    assert.match(f, /refiled as P3\. Re-point each dependent's `depends_on:` from A-1 to P3 via \/ship/);
    assert.doesNotMatch(f, /unblocked|promot/i);
  });

  test('a moot assumption gets advice of its own, not the unblock note', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'moot', resolved: daysAgo(0), resolution: 'no longer matters.' })],
    });
    const f = finding(audit(dir).stdout, 'A-1');
    assert.match(f, /A-1 is `moot`/);
    assert.match(f, /stopped mattering.*Re-read each for scope/s);
    assert.doesNotMatch(f, /now unblocked/);
  });

  // Shipped work isn't promoted, so a verified assumption or a decision with only
  // terminal dependents has nothing to say. A refutation still does: shipped work may
  // rest on the false premise.
  for (const [what, settle] of [
    ['an assumption verified', { assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(0), resolution: 'held.' })] }],
    ['a decision taken', { decisions: [decidedD('D-1', { decided: daysAgo(0) })] }],
  ]) {
    test(`${what} today whose only dependent is shipped produces no finding`, () => {
      const id = settle.decisions ? 'D-1' : 'A-1';
      const { dir } = repo({ backlog: [P('P1'), P('P2', { status: 'shipped', shipped: daysAgo(1), dependsOn: [id] })], ...settle });
      const r = audit(dir);
      // The control: an audit that crashed or printed nothing has no finding either.
      assert.match(r.stdout, /^session-audit: /);
      assert.equal(finding(r.stdout, id), '');
    });
  }

  test('a deferred dependent is still named: it may have been parked on the question', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { status: 'deferred', dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(0), resolution: 'held.' })],
    });
    assert.match(finding(audit(dir).stdout, 'A-1'), /depend on it: P2 \(deferred\)/);
  });

  test('a moved assumption with no moved_to: says to record it, not to re-point at nothing', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'moved', resolved: daysAgo(0), resolution: 'a choice, not a fact.' })],
    });
    const f = finding(audit(dir).stdout, 'A-1');
    assert.match(f, /records no `moved_to:`.*Record where it moved via \/ship first/s);
    assert.doesNotMatch(f, /Re-point each/);
    assert.doesNotMatch(f, /unblocked|promot/i);
  });

  test('the same setup refuted still raises the alert and names the shipped entry', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { status: 'shipped', shipped: daysAgo(1), dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'refuted', resolved: daysAgo(0), resolution: 'wrong.' })],
    });
    assert.match(audit(dir).stdout, /\[ALERT\] A-1 is `refuted` \(resolved today\) and 1 entr\(y\/ies\) depend on it: P2 \(shipped\)/);
  });

  test('beside an open dependent, a shipped one is left out of the unblock note', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] }), P('P3', { status: 'shipped', shipped: daysAgo(1), dependsOn: ['A-1'] })],
      assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(0), resolution: 'held.' })],
    });
    assert.match(finding(audit(dir).stdout, 'A-1'), /1 entr\(y\/ies\) depend on it: P2 \(proposed\)\./);
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

describe('worktrees and the land lock left behind (P15 R3)', () => {
  // Worktrees go in a sibling temp dir: where they live doesn't matter to the audit,
  // and inside the fixture they would add an unrelated untracked-files note.
  const addWorktree = (g, branch) => {
    const wt = join(tempDir(), 'wt');
    g.sh(`git worktree add -q -b ${branch} "${wt}" main`);
    return wt;
  };
  const writeLock = (dir, owner, minutesAgo = 0) =>
    writeFileSync(join(dir, '.git', 'loop-land.lock'), JSON.stringify({
      owner, worktree: dir, at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    }));

  test('a worktree whose branch is already merged is flagged, with the finish command', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'partial' })] });
    const wt = addWorktree(g, 'feat/p1-thing');
    execInWt(wt, 'work');
    g.merge('feat/p1-thing');
    const r = audit(dir);
    assert.equal(r.code, FINDINGS, out(r));
    assert.match(r.stdout, /feat\/p1-thing, which is already merged into main/);
    assert.match(r.stdout, /land\.mjs finish feat\/p1-thing/);
  });

  test('a landing between merge and finish — merged, lock live, worktree present — is not flagged', () => {
    // /ship is writing its flips under the lock right then; a session starting at that
    // moment must not be told the landing never finished (found by /verify, P15 R3).
    const { dir, g } = repo({ backlog: [P('P1', { status: 'partial' })] });
    const wt = addWorktree(g, 'feat/p1-thing');
    execInWt(wt, 'work');
    g.merge('feat/p1-thing');
    writeLock(dir, 'feat/p1-thing', 1);
    const r = audit(dir);
    assert.doesNotMatch(r.stdout, /already merged into main/, out(r));
  });

  test('a worktree building a bug whose claim is gone is flagged too (P5 R1)', () => {
    const { dir, g } = repo({ bugs: [B('B1')] });
    const wt = addWorktree(g, 'feat/b1-the-fix');
    execInWt(wt, 'work');
    assert.match(audit(dir).stdout, /building B1 \(feat\/b1-the-fix\), but B1 is `open` — its claim is gone/);
  });

  test('a worktree building an entry whose claim is gone is flagged, and removing it is the user\'s call', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'proposed' })] });
    const wt = addWorktree(g, 'feat/p1-thing');
    execInWt(wt, 'work');
    const r = audit(dir);
    assert.equal(r.code, FINDINGS, out(r));
    assert.match(r.stdout, /building P1 \(feat\/p1-thing\), but P1 is `proposed` — its claim is gone/);
    assert.match(r.stdout, /ask the user before removing/);
  });

  test('a build just started — branch cut, no commits yet — is in flight, not landed', () => {
    // Found live (P15 R3): a fresh branch sits at main's tip, so `git branch --merged`
    // lists it, and the audit called the session's own live build an unfinished landing.
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    addWorktree(g, 'feat/p1-thing');
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
  });

  test('a worktree building a claimed entry is in flight — silent', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    execInWt(addWorktree(g, 'feat/p1-thing'), 'work');
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
  });

  test('an old lock whose owner is unmerged is an ALERT naming the release command', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    execInWt(addWorktree(g, 'feat/p1-thing'), 'work');
    writeLock(dir, 'feat/p1-thing', 45);
    const r = audit(dir);
    assert.equal(r.code, FINDINGS, out(r));
    assert.match(r.stdout, /\[ALERT\] The land lock has been held by feat\/p1-thing/);
    assert.match(r.stdout, /lock release feat\/p1-thing/);
  });

  test('a lock whose owner branch is gone is noted as stale', () => {
    const { dir } = repo();
    writeLock(dir, 'feat/p9-gone');
    const r = audit(dir);
    assert.match(r.stdout, /held by feat\/p9-gone .* which has finished or gone/);
  });

  test('a fresh lock held by a live landing is not a finding', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    execInWt(addWorktree(g, 'feat/p1-thing'), 'work');
    writeLock(dir, 'feat/p1-thing', 1);
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
  });
});

/** Commit something in a worktree, so its branch is ahead of main. */
function execInWt(wt, msg) {
  writeFileSync(join(wt, `${msg}-${Math.random().toString(36).slice(2)}.txt`), msg);
  spawnSync('git', ['add', '-A'], { cwd: wt });
  spawnSync('git', ['commit', '-qm', msg], { cwd: wt });
}

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

describe('what is ahead, read from the graph on the trunk (P19)', () => {
  const ahead = (dir) => JSON.parse(audit(dir, ['--json']).stdout).ahead;

  test('a session start names the first queued entry, unasked', () => {
    const { dir } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P2', 'P1'] });
    const r = audit(dir);
    assert.equal(r.code, CLEAN, out(r));
    assert.match(r.stdout, /Ahead \(from the dependency graph on main\):\n  next up: P2 — P2 example\n/);
  });

  test('a claimed head is named as skipped, and the first unclaimed entry is next', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2')], nextUp: ['P1', 'P2'] });
    g.checkout('feat/p1-thing', true);
    g.commitAll('work');
    g.checkout('main');
    assert.match(audit(dir).stdout, /next up: P2 — P2 example \(after claimed P1\)\n/);
  });

  test('a head queued below its own unshipped dependency says what it waits on', () => {
    // The schema check allows it (user decision, 2026-10-16), so the head can be held.
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' }), P('P2', { dependsOn: ['P1'] })], nextUp: ['P1', 'P2'] });
    g.checkout('feat/p1-thing', true);
    g.commitAll('work');
    g.checkout('main');
    assert.match(audit(dir).stdout, /next up: P2 — P2 example \(after claimed P1\) — waits on P1\n/);
  });

  test('a ready bug takes "next up", and it is the bug next.mjs picks', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2')],
      bugs: [
        B('B1', { severity: 'minor' }),
        B('B2', { severity: 'critical', dependsOn: ['P2'] }),
        B('B3', { severity: 'major' }),
      ],
      nextUp: ['P1'],
    });
    const text = audit(dir).stdout;
    assert.match(text, /\n {2}next up: B3 — B3 example \(major bug; every ready bug goes before the queue\)\n {2}then the queue: P1 — /);
    const picked = JSON.parse(run('next.mjs', ['--json'], { cwd: dir }).stdout).next.id;
    assert.equal(picked, 'B3', 'B2 is held by P2; B3 outranks B1');
  });

  test('no ready bug: the queue head keeps "next up"', () => {
    const { dir } = repo({ backlog: [P('P1')], bugs: [B('B1', { dependsOn: ['P1'] })], nextUp: ['P1'] });
    const text = audit(dir).stdout;
    assert.match(text, /\n {2}next up: P1 — /);
    assert.doesNotMatch(text, /then the queue:/);
  });

  test('a forward view that cannot run costs none of the findings', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'docs', 'backlog', 'QUEUE.md'), '# edited\n');
    const r = run('session-audit.mjs', [], { cwd: dir, env: { TMPDIR: join(dir, 'no-such-dir') } });
    assert.equal(r.code, FINDINGS, out(r));
    assert.match(r.stdout, /uncommitted change/);
    assert.match(r.stdout, /Ahead: unreadable — /);
  });

  test('an entry on the trunk whose first line is not --- makes Ahead unreadable, naming the file (P36)', () => {
    const { dir, g } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1'] });
    const f = join(dir, 'docs', 'backlog', 'P2.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^---/, '***'));
    g.commitAll('a header nothing can read');
    assert.match(audit(dir).stdout, /Ahead: unreadable — .*docs\/backlog\/P2\.md/);
  });

  test('an entry whose dependency has no entry is not ready, and a held head names it (B9)', () => {
    const { dir } = repo({ backlog: [P('P1', { dependsOn: ['P99'] }), P('P2', { dependsOn: ['P98'] }), P('P3')], nextUp: ['P2'] });
    const a = ahead(dir);
    assert.deepEqual(a.readyUnqueued, ['P3']);
    assert.deepEqual(a.nextUp.waitsOn, ['P98']);
    assert.match(audit(dir).stdout, /next up: P2 — P2 example — waits on P98 \(no entry\)\n {2}ready, not queued: P3\n/);
  });

  test('an entry also resting on an assumption that has no entry is not near the queue (B9)', () => {
    // Settling A-1 would not free P1: A-99 is a bad reference, not a question to settle.
    const { dir } = repo({ backlog: [P('P1', { dependsOn: ['A-1', 'A-99'] }), P('P2', { dependsOn: ['A-1'] })], assumptions: [A('A-1')], nextUp: [] });
    assert.deepEqual(ahead(dir).assumptions.map((a) => [a.id, a.holds]), [['A-1', ['P2']]]);
  });

  test('an unqueued entry whose last blocker just shipped is named as ready', () => {
    const before = repo({ backlog: [P('P1'), P('P2', { dependsOn: ['P1'] }), P('P3')], nextUp: ['P1'] });
    assert.deepEqual(ahead(before.dir).readyUnqueued, ['P3'], 'P2 is still held by P1');
    const after = repo({
      backlog: [P('P1', { status: 'shipped', shipped: '2026-08-02' }), P('P2', { dependsOn: ['P1'] }), P('P3')],
      nextUp: ['P3'],
    });
    assert.deepEqual(ahead(after.dir).readyUnqueued, ['P2']);
    assert.match(audit(after.dir).stdout, / {2}ready, not queued: P2\n/);
  });

  test('an open assumption is named with the near-queue entries it holds, most first', () => {
    const { dir } = repo({
      backlog: [
        P('P1'),
        P('P2', { dependsOn: ['A-1'] }),
        P('P3', { dependsOn: ['A-1'] }),
        P('P4', { dependsOn: ['A-2'] }),
        // Two steps from ready (P5 is unshipped too): not near the queue.
        P('P5', { dependsOn: ['A-3'] }),
        P('P6', { dependsOn: ['A-3', 'P5'] }),
      ],
      assumptions: [A('A-1'), A('A-2'), A('A-3'), A('A-4')],
      nextUp: ['P1'],
    });
    const a = ahead(dir).assumptions;
    assert.deepEqual(a.map((x) => [x.id, x.holds]), [['A-1', ['P2', 'P3']], ['A-2', ['P4']], ['A-3', ['P5']]],
      'ranked by how many they hold; A-4 holds nothing and is not named');
    assert.match(audit(dir).stdout, / {2}A-1 holds P2, P3 — A-1 example\n {2}A-2 holds P4 — A-2 example\n/);
  });

  test('the section stays short: at most three assumption lines, then a count', () => {
    const ids = [1, 2, 3, 4, 5];
    const { dir } = repo({
      backlog: [P('P1'), ...ids.map((n) => P(`P${n + 1}`, { dependsOn: [`A-${n}`] }))],
      assumptions: ids.map((n) => A(`A-${n}`)),
      nextUp: ['P1'],
    });
    const text = audit(dir).stdout;
    assert.equal((text.match(/^ {2}A-\d+ holds /gm) ?? []).length, 3);
    assert.match(text, /… and 2 more open assumption\(s\)/);
    assert.ok(text.trim().split('\n').length <= 15, text);
  });

  test('it reads the trunk, not the checked-out branch', () => {
    // A worktree's registers are as old as its branch; the queue it opens on is main's.
    const { dir, g } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1'] });
    g.checkout('feat/p9-elsewhere', true);
    writeFileSync(join(dir, 'docs', 'backlog', 'QUEUE.md'), '# Next up\n\n1. **P2** — queued.\n');
    g.commitAll('requeue on a branch');
    assert.match(audit(dir).stdout, /next up: P1 — /);
  });
});
