# Runs

The lab notebook: one file per run (`N#.md`) in this directory. **Append-only.** A new
run is a new file. An old one is never rewritten to fit what was later learned. A wrong
run stays, flipped to `retracted`, with a line in its `## Read` saying why. Conclusions
go to [findings/](../findings/README.md), not here. The process is in the
[framework](../README.md).

Empty is a legitimate state: a run is recorded when one has happened, never before.

**Written by:** /research (P13 R1). The shape is enforced by the schema check.

---

## Status vocab

Status vocab: `answered` / `inconclusive` / `abandoned` / `retracted`.

A run's status is its outcome. Nothing about a run is open.

| status | meaning |
|--------|---------|
| `answered` | ran cleanly; it answers its experiment's question, whatever the answer |
| `inconclusive` | ran cleanly, but the interval is too wide to say; it usually needs more data |
| `abandoned` | stopped part-way, for a structural reason given in `## Read` |
| `retracted` | later found to be wrong (a harness bug, a confound); kept, with why |

---

## Entry template

```markdown
---
id: N1
title: <title> (<n summary>)
status: answered
ran: YYYY-MM-DD
experiment: X1
---

## Measured under

the commit sha, the inputs, the versions, and the exact command.

## Results

| arm | n | metric | 95% CI | p |
|---|---|---|---|---|

## Read

what the numbers say, read with the noise in mind; what could still be the harness
rather than the world; and, for each decision the experiment feeds, what its rule now
says.
```

The header is strict. The keys are `id` (must match the file name), `title`, `status`,
`ran` (the date it ran) and `experiment` (the `X#` it answers). Each of them is
required, and `experiment:` must name an existing experiment. All three sections are
required.
