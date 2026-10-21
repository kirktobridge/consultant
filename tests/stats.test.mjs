// stats.mjs — the numbers a run quotes come from here, so they are pinned (P13 R1).
//
// The pinned figures are the ones photocull's stats.py test held, and the port was
// diffed against stats.py when it was written. They must not move: a run that quoted
// "min detectable 67.9%" has to still read true after the helper changes. The CLI is
// driven as a subprocess too, because a run pastes its output verbatim.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { run as runScript } from './helpers/fixture.mjs';
import {
  wilson, zTest, invNormCdf, requiredN, minDetectable, precisionAt, nForHalfwidth, formatG, run,
} from '../scripts/stats.mjs';

const cli = (...args) => runScript('stats.mjs', args);
const near = (actual, expected, places, msg) =>
  assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, `${msg ?? ''} ${actual} ≉ ${expected}`);

describe('the normal approximations', () => {
  test('inverse CDF and upper tail at textbook points', () => {
    near(invNormCdf(0.975), 1.959964, 5);
    near(invNormCdf(0.95), 1.644854, 5);
    near(invNormCdf(0.005), -2.575829, 5, 'lower tail branch');
    near(zTest(59.8, 100, 0.5).p, 0.025, 3, 'z = 1.96');
    near(zTest(50, 100, 0.5).p, 0.5, 6, 'z = 0 splits the tails');
  });
});

describe('Wilson', () => {
  test('known values', () => {
    let { lo, hi } = wilson(8, 10, 0.95);
    near(lo, 0.4902, 3);
    near(hi, 0.9433, 3);
    ({ lo, hi } = wilson(5, 5, 0.95)); // 5/5 is 100%, and still only [57%, 100%]
    near(lo, 0.5655, 3);
    near(hi, 1.0, 6);
  });

  test('n must be positive', () => {
    assert.throws(() => wilson(0, 0, 0.95), RangeError);
  });
});

describe('power', () => {
  test('minimum detectable shares do not move', () => {
    assert.match(cli('--power', '--bar', '50', '--n', '30').stdout, /67\.9%/);
    assert.match(cli('--power', '--bar', '70', '--n', '80').stdout, /80\.0%/);
    assert.match(cli('--power', '--bar', '50', '--n', '60').stdout, /62\.7%/);
  });

  test('required n is the smallest that clears, and inverts the MDE', () => {
    for (const [effect, bar] of [[0.75, 0.6], [0.8, 0.5], [0.54, 0.5]]) {
      const n = requiredN(effect, bar, 0.95);
      assert.ok(wilson(effect * n, n, 0.95).lo > bar, `n=${n} should clear`);
      assert.ok(!(wilson(effect * (n - 1), n - 1, 0.95).lo > bar), `n=${n - 1} should not`);
      assert.ok(minDetectable(n, bar, 0.95) <= effect + 1e-9);
    }
  });

  test('an effect at or under the bar is a usage error', () => {
    assert.equal(cli('--power', '--bar', '60', '--effect', '60').code, 2);
  });

  test('an n where not even n/n clears the bar says so, and exits 1', () => {
    // stats.py reported 100% here: a run sized at n=3 would have been registered as
    // able to clear a 50% bar it can never clear.
    const r = cli('--power', '--bar', '50', '--n', '3');
    assert.equal(r.code, 1);
    assert.match(r.stdout, /none — even 3\/3 cannot clear the bar/);
    assert.equal(minDetectable(3, 0.5, 0.95), null);
  });

  test('the smallest n can be 1', () => {
    assert.equal(requiredN(0.9, 0.01, 0.95), 1);
    assert.equal(nForHalfwidth(0.5, 0.45, 0.95), 1);
  });

  test('needs exactly one of --effect / --n', () => {
    assert.equal(cli('--power', '--bar', '60').code, 2);
    assert.equal(cli('--power', '--bar', '60', '--n', '40', '--effect', '75').code, 2);
  });
});

describe('precision', () => {
  test('interval at n', () => {
    const r = cli('--precision', '--expect', '85', '--n', '80');
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[75\.6, 91\.2\]/);
    assert.match(r.stdout, /\+\/- 7\.8 points/);
  });

  test('round trip: the n found for a half-width achieves it, and one fewer does not', () => {
    for (const [expect, half] of [[0.85, 0.08], [0.5, 0.1], [0.7, 0.05]]) {
      const n = nForHalfwidth(expect, half, 0.95);
      assert.ok(precisionAt(expect, n, 0.95).half <= half);
      assert.ok(precisionAt(expect, n - 1, 0.95).half > half);
    }
  });

  test('points and shares agree', () => {
    assert.equal(
      cli('--precision', '--expect', '85', '--halfwidth', '8').stdout,
      cli('--precision', '--expect', '0.85', '--halfwidth', '0.08').stdout,
    );
  });

  test('small n warns', () => {
    assert.match(cli('--precision', '--expect', '85', '--n', '20').stdout, /directional only/);
  });

  test('needs exactly one of --n / --halfwidth', () => {
    assert.equal(cli('--precision', '--expect', '85').code, 2);
    assert.equal(cli('--precision', '--expect', '85', '--n', '80', '--halfwidth', '8').code, 2);
  });
});

describe('a share against a null', () => {
  test('the report reads as a run quotes it', () => {
    const r = cli('8', '10');
    assert.equal(r.code, 0);
    assert.equal(r.stdout, [
      'n            10   hits 8',
      'share        80.0%',
      '95% CI (Wilson) [49.0, 94.3]  -> inconclusive vs 50%',
      'one-sided z  +1.90   p(> 50%) = 0.029',
      'WARNING: n < 30 -> directional only (framework, stats rule 1). Power the run.',
      '',
    ].join('\n'));
  });

  test('clears and loses are read off the interval, not the point estimate', () => {
    assert.match(cli('150', '200').stdout, /-> clears 50%/);
    assert.match(cli('3', '200').stdout, /-> loses 50%/);
    assert.doesNotMatch(cli('150', '200').stdout, /WARNING/);
  });

  test('--pool sums the batches before testing', () => {
    assert.equal(cli('--pool', '18/25', '22/30').stdout, cli('40', '55').stdout);
  });

  test('fractional hits print as given', () => {
    assert.match(cli('7.5', '12').stdout, /hits 7\.5\b/);
  });

  test('--null reads percents like every other rate', () => {
    assert.equal(cli('8', '10', '--null', '60').stdout, cli('8', '10', '--null', '0.6').stdout);
    assert.match(cli('8', '10', '--null', '60').stdout, /inconclusive vs 60%/);
  });

  test('impossible inputs are usage errors, not a stack trace or a NaN', () => {
    for (const args of [
      ['5', '0'], ['11', '10'], ['5', 'x'], ['5', '10.5'], ['5'], ['--pool', '3-4'], ['--bogus'],
      ['8', '10', '--null', '0'], ['8', '10', '--null', '100'],
      ['--precision', '--expect', '150', '--n', '10'], ['--power', '--bar', '120', '--n', '40'],
      ['--pool', '30/25', '0/30'],
    ]) {
      const r = cli(...args);
      assert.equal(r.code, 2, `${args.join(' ')} → exit ${r.code}`);
      assert.match(r.stderr, /^stats: error:/, args.join(' '));
    }
  });
});

describe('nothing typed is silently dropped', () => {
  test('a flag outside its mode is an error, not ignored', () => {
    for (const args of [
      ['40', '55', '--bar', '60'],
      ['--power', '--bar', '50', '--n', '30', '--null', '0.4'],
      ['--precision', '--expect', '85', '--n', '80', '--bar', '50'],
      ['--power', '--precision', '--bar', '50', '--n', '30'],
    ]) assert.equal(cli(...args).code, 2, args.join(' '));
  });

  test('HITS N and --pool together is an error, not one of them dropped', () => {
    assert.equal(cli('8', '10', '--pool', '1/2').code, 2);
  });

  test('1 means 1% for every rate flag', () => {
    assert.match(cli('--power', '--bar', '1', '--effect', '0.9').stdout, /^bar 1\.0%/);
    assert.match(cli('--precision', '--expect', '50', '--halfwidth', '1').stdout, /\+\/- 1\.0 points/);
  });
});

describe('formatting matches the figures photocull runs quoted', () => {
  test("Python's %g", () => {
    assert.equal(formatG(0.029, 2), '0.029');
    assert.equal(formatG(1.234e-5, 2), '1.2e-05');
    assert.equal(formatG(1, 2), '1');
    assert.equal(formatG(0.5, 2), '0.5');
    assert.equal(formatG(8, 6), '8');
    assert.equal(formatG(7.5, 6), '7.5');
  });

  test('run() returns what the CLI prints', () => {
    assert.equal(run(['8', '10']).out, cli('8', '10').stdout);
  });
});
