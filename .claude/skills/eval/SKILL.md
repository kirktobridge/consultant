---
name: eval
description: Run the prompt eval — measure whether the skills' own prose still causes the right decisions, by driving each case through an independent subagent and grading the results mechanically. Use for "run the eval", "did my prompt edit help", "check the skills still gate", or /eval. Maintenance for the suite itself, not a step in the build loop; never gates a commit.
---

# Eval — measure the skills' prose

`npm test` holds everything decidable about this repo. It cannot hold the ~640 lines of
**prose** in the other skills, because whether prose causes the right decision is a
property of a model. This skill measures that.

**You are the transport.** `evals/run.mjs` renders prompts and grades replies; it cannot
spawn a subagent, so the run is two commands with your work between them. Background and
the honest limits: [evals/README.md](../../../evals/README.md).

## Steps

### 1. Dry run first — always

```bash
npm run eval -- --dry-run
```

Renders every prompt and, per case, feeds the grader one answer that should pass and one
that should fail. It spawns nothing and costs nothing. A case whose expectations assert
nothing would pass no matter what a model said; this is what catches that. **Non-zero
exit means stop** — a broken case or a renamed skill, and no number you collect
afterwards would mean anything.

### 2. Agree the scope before spending anything

Each rep is a subagent, and subagents cost the session's token budget. All 12 cases at
the default 3 reps is **36 invocations**; a single case ran ~25k tokens.

So propose a scope and confirm it, rather than defaulting to the full run:

```bash
npm run eval -- --case depends --reps 1     # iterating on one gate's wording
npm run eval                                # the full sweep, 3 reps — say what it costs first
```

This writes `evals/runs/<stamp>/prompts/*.md`, one per case-rep, and prints the paths.

### 3. One subagent per prompt file

For each file, read it and pass its **entire contents** to a subagent as the prompt.

Three ways to produce a number that looks real and means nothing. The harness catches
only the third; the first two are yours to hold:

- **Never summarise, trim, or add framing to the prompt.** The file *is* the artifact
  under test — the skill text it contains is verbatim on purpose. Your framing would be
  the thing you measured.
- **Reps are independent subagents.** The same agent answering the same prompt twice
  measures its own consistency. Do not continue one agent across reps, and do not let
  one agent answer several cases.
- **Save every reply verbatim**, including the reasoning above the JSON block, to
  `evals/runs/<stamp>/replies/<same-key>.txt`. Do not tidy a malformed reply into a
  well-formed one — a reply the grader can't parse is a *result*, and editing it is
  fabricating data.

The prompt tells each subagent to use no tools. If one reads the repo anyway, note it:
the fixture state in the prompt is not the state on disk, so that reply answered a
different question and should be re-run rather than graded.

### 4. Grade

```bash
npm run eval -- --grade evals/runs/<stamp> --note 'which model / effort answered'
```

Grading is mechanical — parsed fields against the case's expectations, no LLM judge.
`--note` is the only record of *what* answered, since the harness can't see it.

Exit codes: `0` every case at or above the bar, `1` at least one below, `2` the run
could not be graded at all (missing or stray replies — an incomplete run is not a
measurement).

### 5. Report what it can support

- A rate from a handful of reps is **directional**. Report a drop as *a reason to go
  look at the prompt*, never as evidence that an edit worked or didn't.
- Name the cases below the bar and their `why`, not just the aggregate.
- **The pre-registered bar is not adjustable after the fact.** It lives in the source
  (`BAR`, and each case's `bar` line). Moving it to match a result destroys the only
  thing making this a measurement rather than a description.
- If the prose is genuinely wrong, fixing it is a normal change to that skill —
  re-run the affected case afterwards, and say so plainly if you didn't.

## Not this skill

- Anything that gates a commit → `npm test`. Wiring a probabilistic measurement into a
  commit gate produces a check that fails for unrelated reasons and gets switched off,
  taking the real tests with it. **Never add the eval to `npm test`.**
- Adding a case → an object in `evals/cases.mjs`; the harness never changes.
- Observing the real app behave → **/verify**.
- Deciding whether an idea is a feature or an assumption → **/triage**.
