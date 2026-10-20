# Experiments

The research backlog: **measurable questions** we intend to answer, one file per entry
(`X#.md`) in this directory. The process they follow is in the
[framework](../README.md). Empty is a legitimate state: an experiment is filed when
there is a question, never to fill the register.

**Written by:** /research (P13 R1). The shape is enforced by the schema check.

---

## Status vocab

Status vocab: `proposed` / `active` / `answered` / `abandoned` / `deferred` / `played-out`.

| status | meaning |
|--------|---------|
| `proposed` | written up, not started |
| `active` | running, or collecting data now |
| `answered` | ran cleanly; the result is in a run and a finding, whatever it says |
| `abandoned` | stopped for a structural reason (confounded, impractical, the wrong question) |
| `deferred` | valid, deliberately not yet (blocked on data, a feature, an assumption or a decision) |
| `played-out` | further variants sit inside the noise; not worth more runs |

There is no "won". Whether a result clears a rule is the decision's reading, and it is
recorded on the D-n.

## Kind vocab

Kind vocab: `test` / `measure` / `probe`.

What each kind does and owes is in the framework's
[The three kinds](../README.md#the-three-kinds).

---

## Entry template

```markdown
---
id: X1
title: <short title>
status: proposed
kind: measure
drafted: YYYY-MM-DD
feeds: —
depends_on: —
---

## Objective

the question, in one sentence.

## Method

the script or harness, the arms, which inputs, n, and what is held fixed.

## Precision

(measure) the planned n and the interval it buys.

## Cost / risk

time, money, and how much it asks of the user.
```

A `test` carries `## Hypothesis` (the predicted direction and the mechanism) and
`## Power` instead of `## Precision`, and its `feeds:` names the decision it gates. A
`probe` carries `## Budget`.

On close, flip `status:`, and add `closed: YYYY-MM-DD` and `runs:` (the run or runs
that closed it) to the header.

The header is strict, as in the backlog. The keys are:

- `id` (it must match the file name), `title` and `status`.
- `kind`: required while open.
- `drafted`: when its claims were last established.
- `feeds`: the decisions (`D-n`) this result informs, or `—`.
- `depends_on`: `P#` / `A-n` / `D-n`, or `—`.
- `runs`: the `R#` runs it closed on.
- `closed`: the date it closed.

Required sections: `Objective` always; `Method` and `Cost / risk` while open; plus
whatever the kind owes while open.

The schema check holds what the framework's loop depends on:

- **Before the run:**
  - an open `test` must name what it `feeds:`.
  - an open experiment that feeds an open decision requires that decision to carry a
    `## Decision rule`, and the decision's `waiting_on:` to name the experiment. The
    decision side is checked too: an open decision waiting on an `X#` needs the rule,
    and that `X#` must name it in `feeds:`.
- **On close:** an `answered`, `abandoned` or `played-out` experiment must name at
  least one existing run in `runs:`.
