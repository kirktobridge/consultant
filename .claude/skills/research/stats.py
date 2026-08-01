#!/usr/bin/env python3
"""Binomial stats for OpenBlokus arena results — the numbers FINDINGS quotes.

Turns raw win counts into game-share + Wilson 95% CI + a one-sided z-test vs a
null (default 50/50). Use this instead of eyeballing percentages: it is what
enforces method lesson M2 (power the run, then use real tests) — see
docs/research/FINDINGS.md and docs/research/FRAMEWORK.md §"Stats discipline".

Usage:
    python3 stats.py WINS GAMES [--null 0.5] [--conf 0.95]
    python3 stats.py --pool W1/G1 W2/G2 ...      # sum shards, then test the pool
    python3 stats.py --power --bar 52 --effect 54   # -> n where an observed 54% clears 52%
    python3 stats.py --power --bar 52 --n 600       # -> min observed share that clears at n

WINS may be fractional (arena splits ties evenly across co-winners), e.g. 54.5.
--bar/--effect accept percents (52) or shares (0.52).

Power semantics: "required n" is where an *observed* share equal to --effect has its
Wilson lower bound clear --bar. A run whose *true* rate is the effect lands under
that observed share about half the time — pad n (~2x for ~80% power) or plan a
pooled second batch. Run this at entry intake / start gate (backlog `Power:` line).

Examples:
    python3 stats.py 655 1200                    # Run H it=80/d=8 -> 54.6%, CI, p
    python3 stats.py --pool 203/300 232/300 204/240 135/150   # Run I pooled
"""
import argparse
import math
import sys


def wilson(wins: float, n: int, conf: float) -> tuple[float, float, float]:
    """Wilson score interval for a proportion. Returns (phat, lo, hi)."""
    if n <= 0:
        raise ValueError("games must be > 0")
    phat = wins / n
    # two-sided z for the requested confidence (0.95 -> 1.96)
    z = _inv_norm_cdf(1 - (1 - conf) / 2)
    denom = 1 + z * z / n
    center = (phat + z * z / (2 * n)) / denom
    half = (z / denom) * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))
    return phat, center - half, center + half


def z_test(wins: float, n: int, p0: float) -> tuple[float, float]:
    """One-sided z-test that the true rate exceeds p0. Returns (z, p_value)."""
    phat = wins / n
    se = math.sqrt(p0 * (1 - p0) / n)
    z = (phat - p0) / se
    p = 0.5 * math.erfc(z / math.sqrt(2))  # P(Z >= z), upper tail
    return z, p


def _as_share(v: float) -> float:
    """Accept 52 or 0.52 as 52%."""
    return v / 100 if v > 1 else v


def required_n(effect: float, bar: float, conf: float) -> int:
    """Smallest n where an observed share of `effect` has Wilson lower bound > bar."""
    lo_n, hi_n = 1, 2
    while hi_n <= 50_000_000:
        _, lo, _ = wilson(effect * hi_n, hi_n, conf)
        if lo > bar:
            break
        lo_n, hi_n = hi_n, hi_n * 2
    else:
        return -1
    while lo_n + 1 < hi_n:
        mid = (lo_n + hi_n) // 2
        _, lo, _ = wilson(effect * mid, mid, conf)
        if lo > bar:
            hi_n = mid
        else:
            lo_n = mid
    return hi_n


def min_detectable(n: int, bar: float, conf: float) -> float:
    """Smallest observed share whose Wilson lower bound clears bar at this n."""
    lo_p, hi_p = bar, 1.0
    for _ in range(60):
        mid = (lo_p + hi_p) / 2
        _, lo, _ = wilson(mid * n, n, conf)
        if lo > bar:
            hi_p = mid
        else:
            lo_p = mid
    return hi_p


def _inv_norm_cdf(p: float) -> float:
    """Inverse standard-normal CDF (Acklam's rational approximation)."""
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / \
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True, description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wins", nargs="?", type=float)
    ap.add_argument("games", nargs="?", type=int)
    ap.add_argument("--pool", nargs="+", metavar="W/G",
                    help="sum shards given as WINS/GAMES pairs")
    ap.add_argument("--null", type=float, default=0.5, help="null rate (default 0.5)")
    ap.add_argument("--conf", type=float, default=0.95, help="CI confidence (default 0.95)")
    ap.add_argument("--power", action="store_true",
                    help="power planning: --bar + --effect -> required n; --bar + --n -> MDE")
    ap.add_argument("--bar", type=float, help="success bar, e.g. 52 or 0.52")
    ap.add_argument("--effect", type=float, help="hypothesized true share, e.g. 54")
    ap.add_argument("--n", type=int, help="planned games")
    args = ap.parse_args()

    if args.power:
        if args.bar is None or (args.effect is None) == (args.n is None):
            ap.error("--power needs --bar plus exactly one of --effect / --n")
        bar = _as_share(args.bar)
        conf_pct = round(args.conf * 100)
        if args.effect is not None:
            effect = _as_share(args.effect)
            if effect <= bar:
                ap.error("--effect must exceed --bar")
            n = required_n(effect, bar, args.conf)
            print(f"bar {bar*100:.1f}%   effect {effect*100:.1f}%   conf {conf_pct}%")
            if n < 0:
                print("required n   not reachable below 50M games — restate the bar")
                return 1
            print(f"required n   >= {n}   (where an observed share = effect clears the bar)")
            print("NOTE: a run whose TRUE rate is the effect lands under that observed")
            print("      share ~half the time — pad n (~2x for ~80% power) or plan a")
            print("      pooled second batch (M2).")
        else:
            mde = min_detectable(args.n, bar, args.conf)
            print(f"bar {bar*100:.1f}%   n {args.n}   conf {conf_pct}%")
            print(f"min detectable observed share   {mde*100:.1f}%")
            print(f"-> observed shares below that cannot clear the bar at n={args.n};")
            print("   if the hypothesized effect is smaller, resize the run or restate the bar.")
        return 0

    if args.pool:
        wins = sum(float(s.split("/")[0]) for s in args.pool)
        games = sum(int(s.split("/")[1]) for s in args.pool)
    elif args.wins is not None and args.games is not None:
        wins, games = args.wins, args.games
    else:
        ap.error("give WINS GAMES, or --pool W/G ...")
        return 2

    phat, lo, hi = wilson(wins, games, args.conf)
    z, p = z_test(wins, games, args.null)
    verdict = ("clears" if lo > args.null else
               "loses"  if hi < args.null else "inconclusive vs")
    conf_pct = round(args.conf * 100)
    print(f"games        {games}   wins {wins:g}")
    print(f"game-share   {phat*100:.1f}%")
    print(f"{conf_pct}% CI (Wilson) [{lo*100:.1f}, {hi*100:.1f}]  -> {verdict} {args.null*100:.0f}%")
    print(f"one-sided z  {z:+.2f}   p(> {args.null*100:.0f}%) = {p:.2g}")
    if games < 200:
        print("WARNING: n < 200 -> directional only (method lesson M1). Power the run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
