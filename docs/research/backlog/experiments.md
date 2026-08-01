# Experiment backlog

Planned and deferred **measurable** experiments, one [FRAMEWORK](../FRAMEWORK.md)
block each, ordered by expected payoff. `AE#` = engine//core experiments, `AD#` =
a second domain (rename both namespaces to fit your project; keep them distinct so
IDs stay globally unique).

**Written only by /research.** /ship never edits this file. See `.claude/GUIDE.md`.

Status vocab: `proposed` / `active` / `won` / `no-win` / `abandoned` / `deferred` /
`played-out` — defined in [FRAMEWORK.md](../FRAMEWORK.md#status-vocabulary).

---

## Next up

Dependency-ready head, highest-payoff first. Refreshed by /research at every close;
the schema check fails if an ID here is missing or terminal.

1. **AE1** — the first real experiment. (Replace this example.)

---

### AE1 — Example experiment (delete once you have real ones)
- **Status:** proposed
- **Drafted:** 2026-08-01
- **Scope:** default
- **Objective:** the question in one sentence — and, crucially, *what decision the
  answer changes*. An experiment whose answer changes no decision is a curiosity, not
  a backlog entry.
- **Hypothesis:** predicted direction **plus the mechanism**. "X will be faster"
  is not a hypothesis; "X will be faster because it avoids the per-item allocation"
  is, and it's falsifiable in a second way (check the allocation count).
- **Method:** harness, arms/configs, N trials, seeds, what's held fixed.
- **Success criteria:** the metric and the bar, pre-registered. e.g. "adopt if the
  share CI clears 52% over ≥600 trials."
- **Power:** planned n = 600; minimum detectable effect at the bar = … (from
  `stats.py --power --bar 52 --n 600`). The bar must be reachable at this n.
- **Cost / risk:** rough compute; code change or pure benchmark.
- **Log:** —

### AD1 — Example of a second-domain entry
- **Status:** deferred
- **Drafted:** 2026-08-01
- **Scope:** mechanism
- **Objective:** shows a second research domain with its own ID namespace and its own
  `log/` file.
- **Hypothesis:** —
- **Method:** blocked until the harness for this domain exists — which, per the
  new-track gate in /triage, is itself the first entry of the track.
- **Success criteria:** —
- **Power:** —
- **Cost / risk:** —
- **Log:** —
