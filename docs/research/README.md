# Research

How this project runs and records **experiments**: questions a test can't answer.
"Is it faster?", "is the new ranking better?" and "how often does X happen?" are claims
about a quantity. Filed as features, they get invented Accept criteria. Filed as
assumptions, they have no way to be measured. This track gives them a home with a
discipline: one template, one status vocabulary and one set of stats rules, so results
are comparable and the same mistakes aren't made twice. Ported from photocull's
research framework (D-1).

This file owns the *process*. The three registers own the records:

| Register | IDs | What it holds |
|----------|-----|---------------|
| [experiments/](experiments/README.md) | `X#` | questions we intend to answer, one file each, with the kind and what it owes |
| [runs/](runs/README.md) | `N#` | the lab notebook: one file per run, **append-only** (a wrong run stays, marked `retracted`) |
| [findings/](findings/README.md) | `F#` | what we now believe, each finding with a confidence label and the run it came from |

**Where a question belongs:** a yes/no fact about the outside world is an assumption
([../assumptions/](../assumptions/README.md)). A choice is a decision
([../decisions/](../decisions/README.md)). Whether our own code works is a feature's
Accept criterion, or a test. A question answered from data, which needs a number, is an
experiment. An experiment answers a question; **it does not decide anything.** Whether a
result is good enough to act on is the **decision rule** of the decision it `feeds:`,
and that rule is written on the decision before the run.

**Written by:** /research (P13 R1). The shapes are enforced by the schema check
(`npm run check:docs`).

---

## The three kinds

| kind | what it does | plans | owes before it runs |
|------|--------------|-------|---------------------|
| `test` | compares arms to gate a change ("is B better than A?") | `## Power`: the planned n and the smallest effect it can detect at the rule's threshold | `## Hypothesis`, `## Power`, and `feeds:` a D-n whose `## Decision rule` is written |
| `measure` | estimates a quantity ("what share of X does v0 get right?") | `## Precision`: the planned n and the interval it buys | `## Precision`; and if a decision waits on it, `feeds:` that decision, with its rule written |
| `probe` | explores ("can this signal be seen at all?") | `## Budget`: the time or effort it may spend before it stops | `## Budget` |

A probe's findings are `directional`, whatever its n, and never change a default by
themselves. A lead from a probe becomes a test or a measure before anything is built on
it.

The `Kind vocab` line lives in [experiments/README.md](experiments/README.md), next to
the template. The schema check reads it from there.

## The loop

```
question → experiment X# (kind + objective + method + power / precision / budget)
         → (a test, or a measure a decision waits on) the decision rule goes on that D-n first,
           and the D-n's waiting_on: names the X#
         → run it → a new runs/N#.md (never an edit to an old one)
         → distil the durable claim into findings/F#.md, citing the run
         → close the experiment (answered + closed: + runs:); for each D it feeds,
           report what the rule now says to /ship, which records the decision
```

Experiments are the questions we intend to answer. Runs are the append-only lab
notebook. Findings are the curated answers. Decisions, and what they lead to, live in
[../decisions/](../decisions/README.md), written by /ship.

What an experiment leads to is not recorded on the experiment. The decision it feeds
carries `leads_to:`. That keeps the consequence owned on the side that acts (LESSONS
[L2](../LESSONS.md)).

## Stats discipline

1. **Plan the run.** Size a test by its power and a measure by its precision before
   starting. A threshold the planned n can't clear is a mis-registered rule. A small n,
   or a result from one narrow slice of inputs, is `directional` at best.
2. **The rule comes before the result.** A test, and a measure a decision waits on, runs
   only once the decision rule is written on the D-n it feeds. A threshold chosen after
   the numbers are in fits the numbers. The schema check holds this while both are open.
3. **The external readout decides.** Agreement between two of our own scores proves
   nothing about what a user wants. Report against the external judgement (the user's
   picks, a known ground truth), never against another internal metric.
4. **Paired comparisons.** When two arms run on the same inputs, count only the inputs
   where they disagree, and test the share each wins against 50%.
5. **An oracle input measures one stage, not the pipeline.** A result on hand-picked
   inputs says nothing about automatically chosen ones. Name which stages were oracle
   in the run.
6. **Interrogate confounds.** Say what the harness holds fixed and what it can't.
7. **Compute, don't eyeball.** Intervals and p-values come from the stats helper (P13
   R1), and its output goes into the run verbatim.
8. **Record the command, not just the script.** A run's exact command line and commit
   go in its `## Measured under`. That is what makes it reproducible.

## Confidence labels

Every finding carries one. The `Confidence vocab` line lives in
[findings/README.md](findings/README.md).

- `replicated`: independent runs, on different inputs, agree.
- `significant`: one planned run (a powered test, or a measure at its planned
  precision) on enough inputs, from more than one source; for a test, the interval is
  clear of the rule's threshold.
- `directional`: small, single-source, oracle-assisted or unplanned. A lead, not a fact.
