// titles.mjs — the index /triage reads before it classifies (P40).
//
// What it must never do is print a shorter list that looks complete: the entry missing
// from it is the duplicate nobody is told about. So every unreadable case below asserts
// two things — exit 2, and an empty stdout — because a script that printed the
// readable part and then exited 2 would still hand a reader a list.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { P, B, A, D, X, project, run, out, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const titles = (dir, args = []) => run('titles.mjs', args, { cwd: dir });

const full = () => project({
  backlog: [
    P('P1', { title: 'batch outbound calls under the rate limit' }),
    P('P2', { title: 'a chime on placement', status: 'shipped', shipped: '2026-09-01' }),
  ],
  bugs: [B('B1', { title: 'the queue check passes an empty queue' })],
  assumptions: [A('A-1', { title: 'the provider allows 100 requests a minute', status: 'open' })],
  decisions: [D('D-1', { title: 'exports count toward the disk cap?' })],
  research: { experiments: [X('X1', { title: 'how often is a placement undone?' })] },
  nextUp: ['P1'],
});

describe('every entry in every register is listed with its status and title', () => {
  test('each register is a group, each entry a line', () => {
    const dir = full();
    const r = titles(dir);
    assert.equal(r.code, 0, out(r));
    for (const line of [
      'P1\tproposed\tbatch outbound calls under the rate limit',
      'P2\tshipped\ta chime on placement',
      'B1\topen\tthe queue check passes an empty queue',
      'A-1\topen\tthe provider allows 100 requests a minute',
      'D-1\topen\texports count toward the disk cap?',
      'X1\tproposed\thow often is a placement undone?',
    ]) assert.ok(r.stdout.includes(`${line}\n`), `missing line: ${line}\n${r.stdout}`);
    for (const g of ['docs/backlog (2)', 'docs/bugs (1)', 'docs/assumptions (1)', 'docs/decisions (1)', 'docs/research/experiments (1)']) {
      assert.match(r.stdout, new RegExp(`^# ${g.replace(/[()]/g, '\\$&')}$`, 'm'));
    }
  });

  test('the total is a positive control: it counts the files on disk', () => {
    const r = titles(full());
    assert.match(r.stdout, /^titles: 6 entries across 5 register\(s\)$/m);
  });

  test('a register the project has not adopted says so instead of vanishing', () => {
    const r = titles(project({ backlog: [P('P1')], nextUp: ['P1'] }));
    assert.equal(r.code, 0, out(r));
    for (const dir of ['docs/bugs', 'docs/assumptions', 'docs/decisions', 'docs/research/experiments']) {
      assert.match(r.stdout, new RegExp(`^# ${dir} — not adopted$`, 'm'));
    }
    // Runs and findings are never listed: they record work done, not ideas.
    assert.doesNotMatch(r.stdout, /research\/(runs|findings)/);
  });
});

describe('a register it cannot read stops it: exit 2, and no list at all', () => {
  const refused = (r, pattern) => {
    assert.equal(r.code, 2, out(r));
    assert.equal(r.stdout, '', 'printed a list despite failing — a shorter list looks complete');
    assert.match(r.stderr, pattern);
    assert.match(r.stderr, /printed nothing/);
  };

  test('no backlog directory', () => {
    const dir = full();
    rmSync(join(dir, 'docs/backlog'), { recursive: true });
    refused(titles(dir), /docs\/backlog\/: missing/);
  });

  test('the research track is adopted but its experiments directory is gone', () => {
    const dir = full();
    rmSync(join(dir, 'docs/research/experiments'), { recursive: true });
    refused(titles(dir), /docs\/research\/experiments\/: missing, though docs\/research\/README\.md says/);
  });

  test('an entry with no readable title', () => {
    const dir = full();
    writeFileSync(join(dir, 'docs/assumptions/A-2.md'), '---\nid: A-2\nstatus: open\nraised: 2026-08-01\n---\n\n## Assumption\n\nx\n');
    refused(titles(dir), /docs\/assumptions\/A-2\.md: no readable title/);
  });

  test('an entry whose header never parsed (a stray first line)', () => {
    const dir = full();
    writeFileSync(join(dir, 'docs/bugs/B2.md'), 'notes\n---\nid: B2\ntitle: x\nstatus: open\n---\n');
    refused(titles(dir), /docs\/bugs\/B2\.md:1: no header/);
  });

  test('an entry whose header is malformed, though its title still parses', () => {
    // A duplicate key keeps the first value, so the line it would print could carry a
    // stale status. A header error means not read, whatever survived it.
    const dir = full();
    writeFileSync(join(dir, 'docs/backlog/P3.md'), '---\nid: P3\ntitle: x\nstatus: proposed\nstatus: shipped\n---\n');
    refused(titles(dir), /docs\/backlog\/P3\.md:5: duplicate header key `status`/);
  });

  test('a register directory it may not list', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
    const dir = full();
    const d = join(dir, 'docs/decisions');
    chmodSync(d, 0o000);
    try {
      refused(titles(dir), /docs\/decisions\/: could not be read/);
    } finally {
      chmodSync(d, 0o755);
    }
  });

  test('every problem is named, not just the first', () => {
    const dir = full();
    rmSync(join(dir, 'docs/research/experiments'), { recursive: true });
    mkdirSync(join(dir, 'docs/bugs'), { recursive: true });
    writeFileSync(join(dir, 'docs/bugs/B2.md'), 'no header\n');
    const r = titles(dir);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /experiments\/: missing/);
    assert.match(r.stderr, /B2\.md:1:/);
  });
});
