// Layer 2 — session-audit, against real git repositories.
//
// Nothing here is mocked. The audit's whole value is that it reads actual merge state
// rather than trusting a status line, so a test that faked git would be testing the
// opposite of the thing.
//
// The most important assertion in the file is the LAST one: exit 2 must be
// distinguishable from exit 0. An audit that could not run looks exactly like an audit
// that found nothing (LESSONS L3), and /checkpoint branches on that difference.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { P, OD, project, gitInit, run, out, daysAgo, tempDir, cleanupAll } from './helpers/fixture.mjs';

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
    writeFileSync(join(dir, 'docs', 'product', 'BACKLOG.md'), '# edited\n');
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

  test('in-progress whose branch already merged → the /ship flip was missed', () => {
    const { dir, g } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    g.checkout('feat/p1-thing', true);
    g.commitAll('work');
    g.checkout('main');
    g.merge('feat/p1-thing');
    const r = audit(dir);
    assert.equal(r.code, FINDINGS);
    assert.match(r.stdout, /P1 is `in-progress` but its branch is already merged into main/);
    assert.match(r.stdout, /run \/ship on main/);
  });

  test('in-progress with no branch anywhere → an abandoned claim', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'in-progress' })] });
    const r = audit(dir);
    assert.match(r.stdout, /P1 is `in-progress` but no branch names it/);
    assert.match(r.stdout, /a stale claim is worse than no claim/);
  });
});

describe('spikes in flight', () => {
  test('an in-progress spike whose OD is still open is surfaced', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P9', { status: 'in-progress', resolves: 'OD-1' })],
      decisions: [OD('OD-1')],
    });
    const r = audit(dir);
    assert.match(r.stdout, /Spike P9 is `in-progress` and OD-1 is still `open`/);
    assert.match(r.stdout, /only in the transcript is lost/);
  });

  test('a proposed spike is not nagged about — nobody claimed to have an answer', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P9', { resolves: 'OD-1' })],
      decisions: [OD('OD-1')],
    });
    assert.doesNotMatch(audit(dir).stdout, /Spike P9/);
  });
});

describe('resolutions nobody swept', () => {
  test('an OD refuted today with live dependents raises an ALERT, ranked first', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['OD-1'] })],
      decisions: [OD('OD-1', { status: 'refuted', resolution: `${daysAgo(0)} — wrong.` })],
    });
    const r = audit(dir);
    assert.equal(r.code, FINDINGS);
    assert.match(r.stdout, /\[ALERT\] OD-1 is `refuted` \(resolved today\)/);
    assert.match(r.stdout, /can VOID dependents rather than unblock them/);
    // Severity ordering is the point of the labels — the urgent case must lead.
    assert.ok(
      r.stdout.indexOf('[ALERT]') < (r.stdout.indexOf('[CHECK]') + 1 || Infinity),
      'ALERT must be reported before CHECK',
    );
  });

  test('a verified OD is an unblock note, not an alert', () => {
    const { dir } = repo({
      backlog: [P('P1'), P('P2', { dependsOn: ['OD-1'] })],
      decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(0)} — held.` })],
    });
    const r = audit(dir);
    assert.match(r.stdout, /OD-1 is `verified`/);
    assert.match(r.stdout, /now unblocked and nothing else will notice/);
    assert.doesNotMatch(r.stdout, /\[ALERT\]/);
  });

  test('an OD resolved long ago with no dependents is not re-reported forever', () => {
    const { dir } = repo({
      backlog: [P('P1')],
      decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(400)} — held.` })],
    });
    assert.equal(audit(dir).code, CLEAN);
  });
});

describe('branches without a baton', () => {
  test('an unmerged branch with no HANDOFF section is flagged', () => {
    const { dir, g } = repo();
    g.checkout('feat/orphan', true);
    g.commitAll('work');
    g.checkout('main');
    const r = audit(dir);
    assert.match(r.stdout, /Branch `feat\/orphan` is unmerged and has no/);
  });

  test('a branch named in HANDOFF is accepted', () => {
    const { dir, g } = repo();
    g.checkout('feat/described', true);
    g.commitAll('work');
    g.checkout('main');
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'HANDOFF.md'), '# Handoff\n\n## feat/described\n- **Land:** ready\n');
    assert.doesNotMatch(audit(dir).stdout, /feat\/described/);
  });

  test('a branch with no unique commits counts as merged, not as an orphan', () => {
    const { dir, g } = repo();
    g.branch('feat/empty');
    assert.doesNotMatch(audit(dir).stdout, /feat\/empty/);
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

  test('a repo with no recognisable integration branch exits 2 and says how to fix it', () => {
    const dir = project();
    gitInit(dir, 'weird-name');
    const r = audit(dir);
    assert.equal(r.code, CANNOT_AUDIT);
    assert.match(r.stderr, /no integration branch found/);
    assert.match(r.stderr, /Pass --base/);
  });
});
