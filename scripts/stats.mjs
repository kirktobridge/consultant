// stats — binomial stats for experiments: the numbers a run quotes (P13 R1).
//
// Most measurable questions are proportions: "share of cases where B beats A", "share
// of inputs v0 gets right". This turns HITS out of N into a share + Wilson 95% CI + a
// one-sided z-test against a null (default 0.5; pass the baseline's rate with --null).
// Use it instead of eyeballing percentages (docs/research/README.md, "Stats
// discipline"), and paste its output into the run verbatim.
//
// Ported from photocull's stats.py, so `npm test` needs no Python. The figures it prints
// are pinned by tests/stats.test.mjs: a run quotes them, so they must not move.
//
// Usage:
//   node scripts/stats.mjs HITS N [--null 0.5] [--conf 0.95]
//   node scripts/stats.mjs --pool H1/N1 H2/N2 ...           sum batches, then test the pool
//   node scripts/stats.mjs --power --bar 60 --effect 75     n where an observed 75% clears 60%
//   node scripts/stats.mjs --power --bar 60 --n 40          min observed share that clears at n
//   node scripts/stats.mjs --precision --expect 85 --n 80          the interval a measure gets at n
//   node scripts/stats.mjs --precision --expect 85 --halfwidth 8   n for an interval of +/- 8 points
//
// HITS may be fractional (half credit for a tie). Every rate flag (--null, --bar,
// --effect, --expect, --halfwidth) takes percents or points (60) or a share (0.6): 1 or
// more is percent, so 100% is written 100. A flag the mode doesn't use is an error.
//
// Power: "required n" is where an *observed* share equal to --effect has its Wilson
// lower bound clear --bar. A run whose *true* rate is the effect lands under that
// observed share about half the time: pad n (~2x for ~80% power) or plan a pooled second
// batch. It goes on a test's `## Power`.
//
// Precision (a `measure`, which estimates a share rather than testing it against a
// bar): the Wilson interval an observed share equal to --expect gets at n, and its
// half-width. The interval is widest near 50%, so pass a pessimistic --expect if unsure.
// It goes on a measure's `## Precision`.
//
// Exit: 0 ok | 1 the planned n is not reachable | 2 usage

import { pathToFileURL } from 'node:url';

const MAX_N = 50_000_000;
/** Under this n a result is directional at best (framework, stats rule 1). */
export const SMALL_N = 30;

/** Inverse standard-normal CDF (Acklam's rational approximation). */
export function invNormCdf(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  const tail = (q) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < plow) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > phigh) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Complementary error function (Numerical Recipes' erfcc; fractional error < 1.2e-7). */
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? ans : 2 - ans;
}

/** Wilson score interval for a proportion: { phat, lo, hi }. */
export function wilson(wins, n, conf) {
  if (!(n > 0)) throw new RangeError('n must be > 0');
  const phat = wins / n;
  const z = invNormCdf(1 - (1 - conf) / 2); // two-sided: 0.95 -> 1.96
  const denom = 1 + z * z / n;
  const center = (phat + z * z / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n));
  return { phat, lo: center - half, hi: center + half };
}

/** One-sided z-test that the true rate exceeds p0: { z, p }. */
export function zTest(wins, n, p0) {
  const z = (wins / n - p0) / Math.sqrt(p0 * (1 - p0) / n);
  return { z, p: 0.5 * erfc(z / Math.SQRT2) }; // P(Z >= z), the upper tail
}

/**
 * 52 or 0.52 both mean 52%: a value of 1 or more is percent (points, for --halfwidth),
 * under 1 a share. One rule for every rate flag, so 1 means 1% everywhere; 100% is 100.
 */
export const asShare = (v) => (v >= 1 ? v / 100 : v);

/** Smallest n in [1, MAX_N] where `ok(n)` holds, for a predicate that stays true once true; -1 if none. */
function smallestN(ok) {
  if (ok(1)) return 1;
  let lo = 1, hi = 2;
  while (!ok(hi)) {
    [lo, hi] = [hi, hi * 2];
    if (hi > MAX_N) return -1;
  }
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/** Smallest n where an observed share of `effect` has its Wilson lower bound above bar; -1 if none. */
export const requiredN = (effect, bar, conf) => smallestN((n) => wilson(effect * n, n, conf).lo > bar);

/** Smallest observed share whose Wilson lower bound clears bar at this n; null if not even n/n does. */
export function minDetectable(n, bar, conf) {
  if (!(wilson(n, n, conf).lo > bar)) return null;
  let lo = bar, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (wilson(mid * n, n, conf).lo > bar) hi = mid; else lo = mid;
  }
  return hi;
}

/** The Wilson interval an observed share of `expect` gets at n: { lo, hi, half }. */
export function precisionAt(expect, n, conf) {
  const { lo, hi } = wilson(expect * n, n, conf);
  return { lo, hi, half: (hi - lo) / 2 };
}

/** Smallest n whose Wilson half-width at an observed share of `expect` is <= half; -1 if none. */
export const nForHalfwidth = (expect, half, conf) =>
  smallestN((n) => precisionAt(expect, n, conf).half <= half);

/** Python's `{x:.<prec>g}`, so the figures read as they did in photocull's runs. */
export function formatG(x, prec) {
  if (x === 0) return '0';
  const [mant, exp] = x.toExponential(prec - 1).split('e');
  const e = Number(exp);
  const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (e < -4 || e >= prec) return `${trim(mant)}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  return trim(x.toFixed(prec - 1 - e));
}

const pct = (share, places = 1) => (share * 100).toFixed(places);
const signed = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

export class UsageError extends Error {}

/**
 * The valued flags: which modes take each, and the range its value must lie in once
 * read (rates through asShare). A flag outside its mode is an error, not ignored: a
 * --bar typed into a share test would otherwise be dropped silently, and the run would
 * quote a verdict against a null nobody chose.
 */
const FLAGS = {
  null: { modes: ['share'], rate: true, ok: (v) => v > 0 && v < 1, range: 'strictly between 0% and 100%' },
  conf: { modes: ['share', 'power', 'precision'], ok: (v) => v > 0 && v < 1, range: 'strictly between 0 and 1' },
  bar: { modes: ['power'], rate: true, ok: (v) => v >= 0 && v < 1, range: 'from 0% up to, not including, 100%' },
  effect: { modes: ['power'], rate: true, ok: (v) => v > 0 && v <= 1, range: 'above 0%, at most 100%' },
  expect: { modes: ['precision'], rate: true, ok: (v) => v >= 0 && v <= 1, range: 'from 0% to 100%' },
  halfwidth: { modes: ['precision'], rate: true, ok: (v) => v > 0 && v < 1, range: 'strictly between 0 and 100 points' },
  n: { modes: ['power', 'precision'], int: true, ok: (v) => v > 0, range: 'a positive whole number' },
};

function num(raw, what) {
  const v = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(v)) throw new UsageError(`${what}: not a number: ${raw}`);
  return v;
}

function int(raw, what) {
  const v = num(raw, what);
  if (!Number.isInteger(v)) throw new UsageError(`${what}: not a whole number: ${raw}`);
  return v;
}

/** HITS out of N, checked: N a positive whole number, HITS within [0, N]. */
function share(rawHits, rawN, what) {
  const n = int(rawN, `${what} N`);
  if (!(n > 0)) throw new UsageError(`${what}: N must be > 0`);
  const hits = num(rawHits, `${what} HITS`);
  if (hits < 0 || hits > n) throw new UsageError(`${what}: HITS must be between 0 and N (got ${hits} of ${n})`);
  return { hits, n };
}

/**
 * argv → { mode, opts, hits, n }, with every value checked and every rate a share. All
 * validation lives here, so each mode in run() can trust what it is handed.
 */
export function parse(argv) {
  const opts = {};
  const positional = [];
  let mode = 'share';
  let pool = null;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--power' || tok === '--precision') {
      if (mode !== 'share') throw new UsageError('--power and --precision are separate modes; give one');
      mode = tok.slice(2);
      continue;
    }
    if (tok === '--pool') {
      pool = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) pool.push(argv[++i]);
      if (pool.length === 0) throw new UsageError('--pool needs at least one H/N');
      continue;
    }
    if (tok.startsWith('--')) {
      const [flag, inline] = tok.slice(2).split(/=(.*)/s);
      const spec = FLAGS[flag];
      if (!spec) throw new UsageError(`unrecognized argument: ${tok}`);
      const raw = inline ?? argv[++i];
      if (raw === undefined) throw new UsageError(`--${flag} needs a value`);
      const v = spec.int ? int(raw, `--${flag}`) : num(raw, `--${flag}`);
      opts[flag] = spec.rate ? asShare(v) : v;
      if (!spec.ok(opts[flag])) throw new UsageError(`--${flag} must be ${spec.range} (got ${raw})`);
      continue;
    }
    positional.push(tok);
  }

  for (const flag of Object.keys(opts)) {
    if (!FLAGS[flag].modes.includes(mode)) {
      throw new UsageError(`--${flag} does nothing ${mode === 'share' ? 'in a share test' : `with --${mode}`}`);
    }
  }
  opts.conf ??= 0.95;

  if (mode === 'power') {
    if (opts.bar === undefined || (opts.effect === undefined) === (opts.n === undefined)) {
      throw new UsageError('--power needs --bar plus exactly one of --effect / --n');
    }
    if (opts.effect !== undefined && opts.effect <= opts.bar) throw new UsageError('--effect must exceed --bar');
  }
  if (mode === 'precision' && (opts.expect === undefined || (opts.n === undefined) === (opts.halfwidth === undefined))) {
    throw new UsageError('--precision needs --expect plus exactly one of --n / --halfwidth');
  }
  if (mode !== 'share') {
    if (pool || positional.length) throw new UsageError(`--${mode} takes no HITS N or --pool`);
    return { mode, opts };
  }

  opts.null ??= 0.5;
  if (pool && positional.length) throw new UsageError('give HITS N or --pool, not both');
  if (pool) {
    let hits = 0, n = 0;
    for (const pair of pool) {
      const parts = pair.split('/');
      if (parts.length !== 2) throw new UsageError(`--pool: not H/N: ${pair}`);
      const b = share(parts[0], parts[1], `--pool ${pair}`);
      hits += b.hits;
      n += b.n;
    }
    return { mode, opts, hits, n };
  }
  if (positional.length !== 2) throw new UsageError('give HITS N, or --pool H/N ...');
  return { mode, opts, ...share(positional[0], positional[1], 'HITS N') };
}

/** Run the CLI over argv. Returns { code, out } so tests need no subprocess for logic. */
export function run(argv) {
  const lines = [];
  const say = (s) => lines.push(s);
  const done = (code) => ({ code, out: lines.length ? lines.join('\n') + '\n' : '' });
  const { mode, opts, hits, n } = parse(argv);
  const confPct = Math.round(opts.conf * 100);

  if (mode === 'power') {
    const { bar } = opts;
    if (opts.effect !== undefined) {
      const req = requiredN(opts.effect, bar, opts.conf);
      say(`bar ${pct(bar)}%   effect ${pct(opts.effect)}%   conf ${confPct}%`);
      if (req < 0) {
        say('required n   not reachable below 50M trials — restate the bar');
        return done(1);
      }
      say(`required n   >= ${req}   (where an observed share = effect clears the bar)`);
      say('NOTE: a run whose TRUE rate is the effect lands under that observed');
      say('      share ~half the time — pad n (~2x for ~80% power) or plan a');
      say('      pooled second batch.');
    } else {
      const mde = minDetectable(opts.n, bar, opts.conf);
      say(`bar ${pct(bar)}%   n ${opts.n}   conf ${confPct}%`);
      if (mde === null) {
        say(`min detectable observed share   none — even ${opts.n}/${opts.n} cannot clear the bar;`);
        say('   resize the run or restate the bar.');
        return done(1);
      }
      say(`min detectable observed share   ${pct(mde)}%`);
      say(`-> observed shares below that cannot clear the bar at n=${opts.n};`);
      say('   if the hypothesized effect is smaller, resize the run or restate the bar.');
    }
    return done(0);
  }

  if (mode === 'precision') {
    const { expect } = opts;
    if (opts.n !== undefined) {
      const { lo, hi, half } = precisionAt(expect, opts.n, opts.conf);
      say(`expect ${pct(expect)}%   n ${opts.n}   conf ${confPct}%`);
      say(`${confPct}% CI (Wilson) [${pct(lo)}, ${pct(hi)}]   half-width +/- ${pct(half)} points`);
      if (opts.n < SMALL_N) say('WARNING: n < 30 -> directional only (framework, stats rule 1).');
    } else {
      const req = nForHalfwidth(expect, opts.halfwidth, opts.conf);
      say(`expect ${pct(expect)}%   half-width +/- ${pct(opts.halfwidth)} points   conf ${confPct}%`);
      if (req < 0) {
        say('required n   not reachable below 50M trials');
        return done(1);
      }
      say(`required n   >= ${req}`);
    }
    return done(0);
  }

  const { phat, lo, hi } = wilson(hits, n, opts.conf);
  const { z, p } = zTest(hits, n, opts.null);
  const nullPct = pct(opts.null, 0);
  const verdict = lo > opts.null ? 'clears' : hi < opts.null ? 'loses' : 'inconclusive vs';
  say(`n            ${n}   hits ${formatG(hits, 6)}`);
  say(`share        ${pct(phat)}%`);
  say(`${confPct}% CI (Wilson) [${pct(lo)}, ${pct(hi)}]  -> ${verdict} ${nullPct}%`);
  say(`one-sided z  ${signed(z)}   p(> ${nullPct}%) = ${formatG(p, 2)}`);
  if (n < SMALL_N) say('WARNING: n < 30 -> directional only (framework, stats rule 1). Power the run.');
  return done(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('usage: node scripts/stats.mjs HITS N [--null P] [--conf C] | --pool H/N ... |\n' +
      '       --power --bar B (--effect E | --n N) | --precision --expect E (--n N | --halfwidth H)\n' +
      'See the header of scripts/stats.mjs for what each mode means.');
    process.exit(0);
  }
  try {
    const { code, out } = run(argv);
    process.stdout.write(out);
    process.exit(code);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`stats: error: ${err.message}\nusage: node scripts/stats.mjs --help`);
    process.exit(2);
  }
}
