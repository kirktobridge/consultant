# Research framework

How this project runs and records experiments. One template, one status vocabulary,
one set of stats rules — so results are comparable and mistakes aren't re-made. This
file owns the *process*; [FINDINGS.md](FINDINGS.md) owns the *conclusions*.

**Scope:** this framework is for **experiments** — measurable questions with a
pre-registered success bar. Shippable **features** (UI, UX, whose success is
"usability" not a metric) go in the [product backlog](../product/BACKLOG.md), not
here. If an entry can't state a success criterion without writing "N/A", it's a
product item.

## The loop

```
idea → backlog entry (objective + hypothesis + method + success)
     → run it → append a record to log/
     → distil the durable claim into FINDINGS.md
     → update the backlog entry's status
```

Backlog = questions we intend to answer. Log = append-only lab notebook of what we
actually ran (never rewritten — a wrong run stays, annotated). Findings = the curated
answers, presentation-ready.

## Backlog entry template

Each planned experiment is one block in a `backlog/*.md` file:

```markdown
### <id> — <short title>
- **Status:** proposed
- **Drafted:** YYYY-MM-DD
- **Scope:** <see Scope below> — required while the entry is open.
- **Objective:** the question in one sentence — what decision does the answer change?
- **Hypothesis:** predicted direction + the mechanism (why we expect it).
- **Method:** harness, contestants/configs, N trials, seeds, what's held fixed.
- **Success criteria:** the metric + the bar to act (e.g. "adopt if the share CI
  clears 52% over ≥600 trials"). State this *before* running.
- **Power:** planned n and the minimum detectable effect at the bar
  (`stats.py --power`) — the bar must be reachable by the Method's n.
- **Cost / risk:** rough compute + whether it's a code change or pure benchmark.
- **Log:** — (link to the run record once executed)
```

Objective, hypothesis, and success criteria are the load-bearing three: pre-committing
to what would count as a win is what stops M1/M2 (below) from biting.

On close, a `won` entry also carries:

```markdown
- **Deploys as:** <product P#, a named retune-in-place task, or "no deployment surface">
```

Once the result actually lands, that line **leads** with the marker:
`- **Deploys as:** shipped — P42 …`. The leading position is load-bearing — see the
schema check.

## Log entry template

Each completed run is one block appended to a `log/*.md` file:

```markdown
### Run <letter/id> — <title> (<seeds/trials summary>)
<one line: what question, from which backlog id>
<tuning-type results (ratios, budgets, curves) add: **Measured under:** system
state — commit sha or shorthand — so a later step-change can find what it stales>

| config | trials | metric | 95% CI | p |
...table...

**Read:** what the numbers say, noise-aware.
**Decision:** adopt / no-win / abandoned / needs-more-trials + why.
```

## Status vocabulary

Shared by backlog and log. A backlog entry moves through these; a finding cites the
terminal one.

Status vocab: `proposed` / `active` / `won` / `no-win` / `abandoned` / `deferred` /
`played-out`.

| status | meaning |
|--------|---------|
| `proposed` | written up, not started |
| `active` | currently running / in progress |
| `won` | resolved, cleared its success bar → adopted |
| `no-win` | resolved, ran cleanly, didn't clear the bar (parity or loss) |
| `abandoned` | stopped for a structural reason (impractical, confounded, wrong objective) |
| `deferred` | valid, intentionally not-yet — blocked on another feature or budget |
| `played-out` | further variants sit inside the noise band; not worth more trials |

## Stats discipline (non-negotiable)

See the method lessons M1–M5 in [FINDINGS.md](FINDINGS.md) for the runs that teach
these. Each one is written there as a *lesson from a specific failure*, not a maxim —
keep it that way, because a rule with a scar attached gets followed.

1. **Average over repetitions.** Single-seed tables mislead. Report **mean ±
   sample-std** over N seeds, with a seeded RNG so it's reproducible.
2. **Cancel positional bias.** Rotate which arm occupies which position; credit
   results by name; split ties evenly.
3. **Report two readouts** where a per-position rate and an overall share can diverge.
4. **Power the run, then use real tests.** Wilson 95% CI + one-sided z vs the null —
   not eyeballed percentages. A result at n < ~200 is `directional` at best. Size the
   run *before* starting: `stats.py --power` turns bar + hypothesized effect into the
   required n — a bar the planned n cannot clear is a mis-registered bar.
5. **Pre-register the bar.** Decide the success threshold before seeing results.
6. **Interrogate confounds.** Ask what the harness holds fixed. A suspiciously flat
   result may be the harness, not the world — rerun with the confound removed before
   concluding.
7. **Anchor externally, early.** A new track names its outside-world readout *before*
   self-relative runs accumulate; where a standing external readout exists, report
   against it, not only against the incumbent.

## Confidence labels (used in FINDINGS)

- `replicated` — multiple independent runs agree.
- `significant` — one well-powered run, CI clear of the null.
- `directional` — small sample or uncontrolled comparison; a hint, not a fact.

A finding that changes a shipped default before replication is labelled
`significant, replication-pending`, and the owed batch is tracked on **both** sides of
the doc split — `scripts/doc-debt-check.mjs` enforces the pairing.

## Scope

**PORTING:** this section makes "a measurement is bound to the context it was taken
in" mechanical rather than aspirational. Replace the vocabulary below with your
project's axis of variation — platforms, tenants, datasets, model versions, product
variants — or, if there is genuinely only one context, keep `default` / `mechanism`
and the rule still earns its keep the day a second context appears.

A tuned constant is scoped to the context it was measured in, so the claim has to say
which. A constant is presumed scope-bound until measured otherwise; a mechanism is
presumed portable but still says so — the point is to make the transfer question
explicit, not to assume either answer.

| scope | meaning |
|---------|---------|
| `default` | the primary configuration |
| `variant-a` | a named alternate configuration |
| `variant-b` | another named alternate configuration |
| `both` | measured on (or claimed for) more than one |
| `mechanism` | a mechanism-level claim — technique, throughput, methodology — presumed to transfer, with no constant riding on the context |

Two places carry it, and
[scripts/backlog-schema-check.mjs](../../scripts/backlog-schema-check.mjs) enforces
both: every **open** backlog entry carries a **Scope:** line, and every finding from
the configured cutoff on carries a bold tag on its Confidence line, e.g. **(default)**.

## Harnesses

**PORTING:** one row per measurable domain. The point of the table is that a reader
can go from "I want to measure X" to a runnable command without asking anyone.

| domain | harness | entry |
|--------|---------|-------|
| *(your primary metric)* | *(headless benchmark)* | `npm run bench` |
| regression guard | a fast subset that runs every test cycle | `tests/…` |
| profiling | CPU/memory profile scripts | `scripts/profile-*.ts` |

**Experiment configs:** an experiment's setup lives in `scripts/experiments/<id>.json`
and runs via the harness's `--config` flag. Never edit the hardcoded baselines in the
harness for a run — those are the standing comparison. Commit the config alongside the
log record so every run is reproducible.

**Heavy / sharded sweeps — reuse, don't re-derive.** When one process is too slow,
shard with existing tooling rather than rebuilding it. Oversubscribing cores is safe
**only** for fixed-work engines — CPU contention then moves wall-time, never the
measured quantity; never shard a wall-clock-budgeted arm. Cost is real: **`time` every
batch and size n from a measured probe, never a guess** — the estimate lies too.

**Commit the shards.** A sweep's raw result files are the *evidence* for every number
it produces, and they are cheap to keep. Send them to an in-repo directory, never
`/tmp` or a dotted scratch dir: in the original project a sweep's shards went to an
uncommitted scratch dir and were lost, forcing a ~53 CPU-hour re-run to recover
ratings that had already been published — and until then, no committed number could be
checked against anything.

New domains add their own harness row here and their own `log/*.md` + `backlog/*.md`
files following the same templates.
