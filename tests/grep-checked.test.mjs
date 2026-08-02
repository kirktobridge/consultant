// Layer 2 — grep-checked's exit codes ARE its interface.
//
// Skills branch on them: exit 1 means "a negative you may write down", exit 2 means
// "the search never worked". Get those backwards and the tool becomes a laundering
// machine for exactly the claim LESSONS L1 exists to stop.
//
// The cases that matter most are 2-returning: each one is a search that plain grep
// would report as a clean, confident, wrong "no matches".

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, out, tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const MATCHES = 0;
const CLEAN_NEGATIVE = 1;
const CONTROL_FAILED = 2;
const USAGE = 3;

function corpus() {
  const d = tempDir();
  mkdirSync(join(d, 'sub'), { recursive: true });
  writeFileSync(join(d, 'a.md'), '# Title\n- **Status:** proposed\n- **Value:** something\n');
  writeFileSync(join(d, 'sub', 'b.md'), '- **Status:** shipped\nCASEtest here\n');
  writeFileSync(join(d, 'notes.txt'), 'plain text, no markdown fields\n');
  return d;
}

const grep = (args, cwd) => run('grep-checked.mjs', args, { cwd });

describe('positive results are self-validating', () => {
  test('matches → exit 0, and the control is explicitly not required', () => {
    const d = corpus();
    const r = grep(['Status:', d], d);
    assert.equal(r.code, MATCHES);
    assert.match(r.stdout, /a\.md:2:/);
    assert.match(r.stderr, /self-validating, no control needed/);
  });

  test('--files collapses to filenames', () => {
    const d = corpus();
    const r = grep(['--files', 'Status:', d], d);
    assert.equal(r.code, MATCHES);
    assert.equal(r.stdout.trim().split('\n').length, 2);
  });

  test('-i changes what matches', () => {
    const d = corpus();
    assert.equal(grep(['casetest', d], d).code, CLEAN_NEGATIVE);
    assert.equal(grep(['-i', 'casetest', d], d).code, MATCHES);
  });
});

describe('negatives are graded, never bare', () => {
  test('with an explicit control that matches → exit 1, VERIFIED', () => {
    const d = corpus();
    const r = grep(['--control', 'Status:', 'ZZZ_absent', d], d);
    assert.equal(r.code, CLEAN_NEGATIVE);
    assert.match(r.stderr, /Strength: VERIFIED/);
    assert.match(r.stderr, /control \/Status:\/ matched at/);
  });

  test('without a control → exit 1, but labelled WEAK', () => {
    const d = corpus();
    const r = grep(['ZZZ_absent', d], d);
    assert.equal(r.code, CLEAN_NEGATIVE);
    assert.match(r.stderr, /Strength: WEAK/);
    assert.match(r.stderr, /re-run with --control/);
  });

  test('a WEAK negative still proves the files were readable', () => {
    const d = corpus();
    assert.match(grep(['ZZZ_absent', d], d).stderr, /scanned \d+ lines in \d+ file\(s\)/);
  });
});

describe('CONTROL FAILED — the cases plain grep reports as a clean negative', () => {
  test('a path that does not exist', () => {
    const d = corpus();
    const r = grep(['--control', 'Status:', 'ZZZ', join(d, 'nope')], d);
    assert.equal(r.code, CONTROL_FAILED);
    assert.match(r.stderr, /NOT evidence/);
    assert.match(r.stderr, /do not exist/);
  });

  test('an --ext filter that excludes everything', () => {
    const d = corpus();
    const r = grep(['--ext', 'rs', '--control', 'Status:', 'ZZZ', d], d);
    assert.equal(r.code, CONTROL_FAILED);
    assert.match(r.stderr, /never looked at anything/);
  });

  test('a control that cannot match — the tooling lied, not the repo', () => {
    const d = corpus();
    const r = grep(['--control', 'ZZZ_NEVER', 'ZZZ_absent', d], d);
    assert.equal(r.code, CONTROL_FAILED);
    assert.match(r.stderr, /control \/ZZZ_NEVER\/ matched 0 of \d+ lines/);
    assert.match(r.stderr, /NOT evidence of absence/);
  });

  test('the failure text names the remedy, not just the problem', () => {
    const d = corpus();
    const r = grep(['--ext', 'rs', '--control', 'Status:', 'ZZZ', d], d);
    assert.match(r.stderr, /Check the paths, the --ext filter/);
  });
});

describe('robustness', () => {
  test('a bad regex is a usage error, not a silent zero', () => {
    const d = corpus();
    const r = grep(['[unclosed', d], d);
    assert.equal(r.code, USAGE);
    assert.match(r.stderr, /bad pattern/);
  });

  test('no arguments prints usage', () => {
    assert.equal(grep([]).code, USAGE);
  });

  test('.git and node_modules are skipped', () => {
    const d = corpus();
    mkdirSync(join(d, 'node_modules'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'junk.md'), 'Status: noise\n');
    const r = grep(['--files', 'Status', d], d);
    assert.doesNotMatch(out(r), /node_modules/);
  });

  test('the searcher is in-process — no external grep is invoked', () => {
    // The original failure was a *proxied* grep (L1). If this ever shells out, a
    // hostile PATH would make the tool lie in precisely the way it exists to prevent.
    const d = corpus();
    const r = run('grep-checked.mjs', ['--control', 'Status:', 'ZZZ', d], {
      cwd: d,
      env: { PATH: '/nonexistent' },
    });
    assert.equal(r.code, CLEAN_NEGATIVE, `should still work with no PATH:\n${out(r)}`);
    assert.match(r.stderr, /Strength: VERIFIED/);
  });
});
