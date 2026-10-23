// The product owner's status view (P7).
//
// Each case builds a real repo, commits its registers on main, and runs
// scripts/status.mjs as the owner would — asserting on the JSON the report is built
// from, and on the text and HTML it renders, since those are what the owner reads.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { P, A, D, B, X, run, out, tempDir, cleanupAll, gitInit, renderFiles, writeFiles, REPO } from './helpers/fixture.mjs';

after(cleanupAll);

/** A repo whose main holds `state`, ignoring what this repo ignores. */
function repo(state) {
  const dir = tempDir();
  writeFiles(dir, { ...renderFiles(state), '.gitignore': readFileSync(join(REPO, '.gitignore'), 'utf8') });
  return { dir, ...gitInit(dir) };
}
const status = (cwd, ...args) => run('status.mjs', args, { cwd });
const report = (cwd) => {
  const r = status(cwd, '--json');
  assert.equal(r.code, 0, out(r));
  return JSON.parse(r.stdout);
};
const setStatus = (dir, id, s) => {
  const f = join(dir, 'docs/backlog', `${id}.md`);
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^status: .*$/m, `status: ${s}`));
};

describe('status.mjs tells the owner why each blocked item is blocked', () => {
  test('a direct assumption, and one reached through another entry, are both named', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['A-1'] }), P('P2', { dependsOn: ['P1'] }), P('P3')],
      assumptions: [A('A-1', { title: 'the API returns pages' })],
      nextUp: ['P3'],
    });
    const r = report(dir);
    assert.deepEqual(r.ready.map((x) => x.id), ['P3']);
    const p1 = r.blocked.find((b) => b.id === 'P1');
    assert.deepEqual(p1.waitsOn.map((w) => w.id), ['A-1']);
    const p2 = r.blocked.find((b) => b.id === 'P2');
    assert.deepEqual(p2.waitsOn.map((w) => w.id), ['P1']);
    assert.deepEqual(p2.roots.map((w) => [w.id, w.register]), [['A-1', 'assumptions']]);

    const t = status(dir).stdout;
    assert.match(t, /P2 .*\n\s+waits on P1 \(feature, proposed\).*\n\s+which rests on A-1 \(assumption, open\): the API returns pages/);
  });

  test('an entry resting on a moved assumption is blocked, not ready (B10)', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['A-1'] }), P('P3')],
      assumptions: [A('A-1', { status: 'moved', resolved: '2026-08-02', movedTo: 'P3', resolution: 'a choice, not a fact.' })],
      nextUp: ['P3'],
    });
    const r = report(dir);
    assert.deepEqual(r.ready.map((x) => x.id), ['P3']);
    assert.deepEqual(r.blocked.find((b) => b.id === 'P1')?.waitsOn.map((w) => w.id), ['A-1']);
  });

  // P13 R0. The research track reaches the report: a decision waiting on an experiment
  // is held by it until it closes, and that reads through to what rests on the decision.
  test('an experiment holds the decision waiting on it, and what rests on that decision', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['D-1'] })],
      decisions: [D('D-1', { waitingOn: 'X1', decisionRule: 'adopt if ≥ 60%.' })],
      research: { experiments: [X('X1', { title: 'how often does it happen', feeds: ['D-1'] })] },
      nextUp: [],
    });
    const p1 = report(dir).blocked.find((b) => b.id === 'P1');
    assert.deepEqual(p1.roots.map((w) => [w.id, w.register]), [['X1', 'experiments']]);
    assert.match(status(dir).stdout, /X1 \(experiment, proposed\): how often does it happen/);
  });

  test('a decision waiting on the owner is listed as waiting on them, with what it holds back', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['D-1'] }), P('P2', { dependsOn: ['P1'] })],
      decisions: [D('D-1', { title: 'pick a store' })],
      nextUp: [],
    });
    const r = report(dir);
    const d = r.waitingOnYou.find((w) => w.id === 'D-1');
    assert.equal(d.kind, 'decision');
    assert.deepEqual(d.holds.sort(), ['P1', 'P2']);
    assert.ok(r.blocked.find((b) => b.id === 'P2').roots.some((x) => x.id === 'D-1' && x.waitingOnYou));
  });

  test('open bugs are ready ahead of the queue, most severe first', () => {
    const { dir } = repo({
      backlog: [P('P1')], nextUp: ['P1'],
      bugs: [B('B1', { severity: 'minor' }), B('B2', { severity: 'critical' })],
    });
    const r = report(dir);
    assert.deepEqual(r.ready.map((x) => x.id), ['B2', 'B1', 'P1']);
    assert.equal(r.ready[2].queued, 1);
  });

  test('a dependency on an abandoned feature still blocks, as the DEPENDS GATE says', () => {
    const { dir } = repo({ backlog: [P('P1', { status: 'abandoned', scope: null, accept: null }), P('P2', { dependsOn: ['P1'] })], nextUp: ['P2'] });
    const r = report(dir);
    assert.deepEqual(r.ready, []);
    assert.deepEqual(r.blocked[0].waitsOn.map((w) => [w.id, w.status]), [['P1', 'abandoned']]);
  });

  test('a decision waiting on the owner stays in the chain even when it also waits on another', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['D-1'] }), P('P2', { dependsOn: ['P1'] })],
      decisions: [D('D-1', { waitingOn: 'user, D-2' }), D('D-2', { waitingOn: 'A-1' })],
      assumptions: [A('A-1')],
      nextUp: [],
    });
    const roots = report(dir).blocked.find((b) => b.id === 'P2').roots.map((x) => x.id);
    assert.ok(roots.includes('D-1'), roots.join());
    assert.ok(roots.includes('A-1'), roots.join());
  });
});

describe('status.mjs names what is in flight, and what has landed awaiting acceptance', () => {
  test('an in-progress entry shows its branch, its worktree and when it was claimed', () => {
    const { dir, sh, commitAll } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1', 'P2'] });
    setStatus(dir, 'P1', 'in-progress');
    commitAll('docs: claim P1 (P1)');
    const wt = join(tempDir(), 'p1');
    sh(`git worktree add -q -b feat/p1-thing ${wt}`);

    const r = report(dir);
    const f = r.inFlight.find((x) => x.id === 'P1');
    assert.ok(f, JSON.stringify(r));
    assert.equal(f.branch, 'feat/p1-thing');
    assert.match(f.worktree, /p1$/);
    assert.equal(f.since.slice(0, 10), git(dir, 'log -1 --format=%cI').slice(0, 10));
    assert.ok(!r.ready.some((x) => x.id === 'P1'), 'a claimed entry is not ready');

    const t = status(dir).stdout;
    assert.match(t, /In flight \(1\)\n\s+P1 .*\n\s+claimed \d{4}-\d{2}-\d{2} \(today\); branch feat\/p1-thing; worktree \S*p1/);
  });

  test('an in-progress entry whose branch merged is waiting on the owner, not in flight', () => {
    const { dir, checkout, commitAll, merge } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    setStatus(dir, 'P1', 'in-progress');
    commitAll('docs: claim P1 (P1)');
    checkout('feat/p1-thing', true);
    writeFileSync(join(dir, 'x.txt'), 'built');
    commitAll('feat: thing (P1)');
    checkout('main');
    merge('feat/p1-thing');

    const r = report(dir);
    assert.deepEqual(r.inFlight, []);
    const w = r.waitingOnYou.find((x) => x.id === 'P1');
    assert.equal(w?.kind, 'acceptance', JSON.stringify(r));
    assert.match(status(dir).stdout, /Waiting on you \(1\)\n\s+P1 .*\n\s+landed .*awaiting your acceptance/);
  });

  test('a landed ad-hoc branch that shares the ID\'s prefix is not the entry landing', () => {
    const { dir, checkout, commitAll, merge } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    setStatus(dir, 'P1', 'in-progress');
    commitAll('docs: claim P1 (P1)');
    checkout('adhoc/p1-typo', true);
    writeFileSync(join(dir, 'x.txt'), 'typo');
    commitAll('fix typo');
    checkout('main');
    merge('adhoc/p1-typo');
    const r = report(dir);
    assert.equal(r.inFlight[0]?.id, 'P1', JSON.stringify(r));
    assert.equal(r.inFlight[0].branch, null);
  });

  test('an in-flight entry names this claim\'s branch, not an earlier milestone\'s leftover (B5)', () => {
    const { dir, checkout, commitAll } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    checkout('feat/p1-a', true);
    writeFileSync(join(dir, 'old.txt'), 'leftover');
    commitAll('feat: R1 leftovers (P1)');
    checkout('main');
    setStatus(dir, 'P1', 'in-progress');
    commitAll('docs: claim P1 (P1)');
    checkout('feat/p1-thing', true);
    writeFileSync(join(dir, 'x.txt'), 'building');
    commitAll('feat: thing (P1)');
    checkout('main');
    const r = report(dir);
    assert.equal(r.inFlight[0]?.branch, 'feat/p1-thing', JSON.stringify(r));
  });

  test('a build that only a remote holds is named by its remote branch (B7)', () => {
    const { dir, sh, checkout, commitAll } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    setStatus(dir, 'P1', 'in-progress');
    commitAll('docs: claim P1 (P1)');
    checkout('feat/p1-thing', true);
    writeFileSync(join(dir, 'x.txt'), 'building elsewhere');
    commitAll('feat: thing (P1)');
    sh('git update-ref refs/remotes/origin/feat/p1-thing HEAD');
    checkout('main');
    sh('git branch -D feat/p1-thing');
    const r = report(dir);
    assert.equal(r.inFlight[0]?.branch, 'origin/feat/p1-thing', JSON.stringify(r));
  });

  test('a branch with no commits of its own is in flight, not landed', () => {
    const { dir, sh, commitAll } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    setStatus(dir, 'P1', 'in-progress');
    commitAll('docs: claim P1 (P1)');
    sh('git branch feat/p1-thing');
    const r = report(dir);
    assert.equal(r.inFlight[0]?.id, 'P1', JSON.stringify(r));
    assert.equal(r.inFlight[0].lastCommit, null);
  });
});

describe('status.mjs reads main and stores nothing', () => {
  test('from a branch whose registers differ, the report is main\'s', () => {
    const { dir, checkout, commitAll } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    checkout('feat/p9-other', true);
    setStatus(dir, 'P1', 'abandoned');
    commitAll('on a branch');
    const r = report(dir);
    assert.deepEqual(r.ready.map((x) => x.id), ['P1']);
    assert.equal(r.base, 'main');
    assert.equal(r.commit, git(dir, 'rev-parse main'));
  });

  test('the HTML page is self-contained, stamped with its commit, and leaves every tracked file unchanged', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['A-1'] }), P('P2')],
      assumptions: [A('A-1')], decisions: [D('D-1')], nextUp: ['P2'],
    });
    const before = git(dir, 'status --porcelain --ignored=no');
    const r = status(dir, '--html');
    assert.equal(r.code, 0, out(r));
    assert.equal(git(dir, 'status --porcelain --ignored=no'), before);
    assert.equal(before, '');

    const page = join(dir, '.claude/status.html');
    assert.ok(existsSync(page), out(r));
    const h = readFileSync(page, 'utf8');
    assert.ok(h.includes(git(dir, 'rev-parse main').slice(0, 7)), 'stamped with the commit');
    assert.doesNotMatch(h, /<(script|link)\b|src=|https?:\/\//, 'nothing loaded from elsewhere');
    for (const s of ['Waiting on you', 'In flight', 'Ready to start', 'Blocked']) assert.ok(h.includes(s), s);
    assert.match(h, /waits on <span class="chip assumptions">A-1<\/span>/);
  });
});

describe('status.mjs says when the graph may have dropped an edge (B8)', () => {
  test('a dangling dependency on main is named in the text, the JSON and the page', () => {
    const { dir } = repo({ backlog: [P('P1', { dependsOn: ['P99'] })], nextUp: ['P1'] });
    const r = report(dir);
    assert.match(r.graphWarning ?? '', /the graph may be wrong/);
    assert.deepEqual(r.ready.map((x) => x.id), [], 'a dependency with no entry is never met');
    const p1 = r.blocked.find((b) => b.id === 'P1');
    assert.deepEqual(p1?.waitsOn.map((w) => [w.id, w.status]), [['P99', 'not in the graph']]);
    assert.deepEqual(p1.roots.map((w) => w.id), ['P99']);
    const t = status(dir);
    assert.equal(t.code, 0, out(t));
    assert.match(t.stdout, /^status — .*\n {2}warning: .*the graph may be wrong/);
    assert.match(t.stdout, /Blocked \(1\)\n {2}P1 .*\n\s+waits on P99 \(unknown, not in the graph\): no entry the graph reads on main/);
    assert.equal(status(dir, '--html').code, 0);
    assert.match(readFileSync(join(dir, '.claude/status.html'), 'utf8'), /<p class="warn">[^<]*the graph may be wrong/);
  });

  test('a missing ID held behind a real edge is the root of the chain', () => {
    const { dir } = repo({
      backlog: [P('P1', { dependsOn: ['P99'] }), P('P2', { dependsOn: ['P1', 'P98'] })],
      nextUp: ['P1'],
    });
    const p2 = report(dir).blocked.find((b) => b.id === 'P2');
    assert.deepEqual(p2?.waitsOn.map((w) => w.id), ['P1', 'P98']);
    assert.deepEqual(p2.roots.map((w) => w.id).sort(), ['P98', 'P99']);
  });

  test('the warning is the check\'s own line, not stderr node printed before it', () => {
    const { dir } = repo({ backlog: [P('P1', { dependsOn: ['P99'] })], nextUp: ['P1'] });
    writeFileSync(join(dir, 'noise.cjs'), "console.error('(node:1) ExperimentalWarning: noise');\n");
    const r = run('status.mjs', ['--json'], { cwd: dir, env: { NODE_OPTIONS: `--require ${join(dir, 'noise.cjs')}` } });
    assert.equal(r.code, 0, out(r));
    assert.match(JSON.parse(r.stdout).graphWarning ?? '', /^backlog-schema: .*the graph may be wrong/);
  });

  test('a sound graph carries no warning', () => {
    const { dir } = repo({ backlog: [P('P1')], nextUp: ['P1'] });
    assert.equal(report(dir).graphWarning, null);
    assert.doesNotMatch(status(dir).stdout, /warning:/);
    assert.equal(status(dir, '--html').code, 0);
    assert.doesNotMatch(readFileSync(join(dir, '.claude/status.html'), 'utf8'), /class="warn"/);
  });
});

describe('status.mjs refuses a trunk it can only read in part (P36)', () => {
  test('an entry whose first line is not --- stops the report, naming the file', () => {
    const { dir, commitAll } = repo({ backlog: [P('P1'), P('P2')], nextUp: ['P1'] });
    const f = join(dir, 'docs/backlog/P2.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^---/, '***'));
    commitAll('a header nothing can read');
    const r = status(dir);
    assert.equal(r.code, 2, out(r));
    assert.match(r.stderr, /docs\/backlog\/P2\.md/);
  });
});

function git(dir, args) {
  return execSync(`git ${args}`, { cwd: dir, encoding: 'utf8' }).trim();
}
