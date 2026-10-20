# Findings

What we measured and now believe, one file per finding (`F#.md`) in this directory.
Each finding is distilled from logged [runs](../runs/README.md) and carries **claim →
the run it came from → how strongly it is held**. The process is in the
[framework](../README.md). Method lessons, which record how we fooled ourselves, go to
[LESSONS.md](../../LESSONS.md), not here.

Empty is a legitimate state. A finding exists only once a run backs it, so one written
ahead of its run would be invented.

**Written by:** /research (P13 R1). The shape is enforced by the schema check.

---

## Status vocab

Status vocab: `current` / `retracted`.

| status | meaning |
|--------|---------|
| `current` | held now, at its confidence |
| `retracted` | no longer held; kept, with `## So what` saying what replaced it, so the ID still resolves |

## Confidence vocab

Confidence vocab: `replicated` / `significant` / `directional`.

What each label means is in the framework's
[Confidence labels](../README.md#confidence-labels).

---

## Entry template

```markdown
---
id: F1
title: <the claim, short>
status: current
confidence: directional
recorded: YYYY-MM-DD
runs: R-1
---

## Claim

what we now believe, with the n it rests on and the inputs it was measured on. A
measured constant is bound to the inputs it was measured on.

## So what

what it changes, or why it changes nothing.
```

The header is strict. The keys are `id` (must match the file name), `title`, `status`,
`confidence`, `recorded` (the date it was written) and `runs` (the `R-n` runs it came
from). Every key is required on every finding, a retracted one too. `runs:` must name
at least one existing run. `Claim` and `So what` are always required.
