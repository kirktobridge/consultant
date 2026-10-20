---
name: eval
description: Run the prompt eval. It measures whether the skills' own prose still causes the right decisions. It drives each case through an independent subagent and grades the results mechanically. Use for "run the eval", "did my prompt edit help", "check the skills still gate", or /eval. It maintains the suite itself. It is not a step in the build loop, and it never gates a commit.
---

# Eval — measure the skills' prose

`npm test` holds everything decidable about this repo. It cannot hold the ~640 lines of
**prose** in the other skills, because whether prose causes the right decision is a
property of a model. This skill measures that.

**You are the transport.** `evals/run.mjs` renders prompts and grades replies. It cannot
start a subagent. So the run is two commands, and you do the work between them. For the
background and the honest limits, read [evals/README.md](../../../evals/README.md).

## Steps

### 1. Dry run first — always

```bash
npm run eval -- --dry-run
```

The dry run renders every prompt. For each case, it gives the grader one answer that
should pass and one that should fail. It starts no subagent and costs nothing. A case
whose expectations assert nothing would pass no matter what a model said. The dry run
catches that case. **A non-zero exit means stop.** It signals a broken case or a renamed
skill, and no number you collect afterwards would mean anything.

### 2. Agree the scope before you spend anything

Each rep is a subagent, and subagents cost the session's token budget. A run starts
**one subagent per case per rep**. The dry run prints how many cases render. Multiply
that count by the reps to get the number of subagents.

So propose a scope and get the user's agreement. Do not default to the full run:

```bash
npm run eval -- --case depends --reps 1     # iterating on one gate's wording
npm run eval                                # the full sweep at the default reps — say what it costs first
```

This writes `evals/runs/<stamp>/prompts/*.md`, one per case-rep, and prints the paths.

### 3. One subagent per prompt file

For each file, read it. Give its **entire contents** to a subagent as the prompt.

Three mistakes produce a number that looks real and means nothing. The harness catches
only the third. You must prevent the first two yourself:

- **Never summarise, trim, or add framing to the prompt.** The file *is* the artifact
  under test. The skill text in it is verbatim on purpose. If you add framing, your
  framing would be the thing you measured.
- **Reps are independent subagents.** If the same agent answers the same prompt twice,
  it measures its own consistency. Do not continue one agent across reps. Do not let
  one agent answer several cases.
- **Save every reply verbatim** to `evals/runs/<stamp>/replies/<same-key>.txt`. Include
  the reasoning above the JSON block. Do not tidy a malformed reply into a well-formed
  one. A reply the grader can't parse is a *result*, and editing it fabricates data.

The prompt tells each subagent to use no tools. If a subagent reads the repo anyway,
note it. The fixture state in the prompt is not the state on disk. So that reply
answered a different question. Re-run that case-rep instead of grading the reply.

### 4. Grade

```bash
npm run eval -- --grade evals/runs/<stamp> --note 'which model / effort answered'
```

Grading is mechanical. It compares parsed fields against the case's expectations, with
no LLM judge. `--note` is the only record of *what* answered, because the harness can't
see it.

Exit codes:

- `0`: every case is at or above the bar.
- `1`: at least one case is below the bar.
- `2`: the harness could not grade the run at all, because replies are missing or
  stray. An incomplete run is not a measurement.

### 5. Report what it can support

- A rate from a handful of reps is **directional**. Report a drop as *a reason to
  examine the prompt*. Never report it as evidence that an edit worked or didn't.
- Name each case below the bar and its `why`, not only the aggregate.
- **Do not adjust the pre-registered bar after the fact.** It lives in the source
  (`BAR`, and each case's `bar` line). If you move it to match a result, you destroy
  the only thing that makes this a measurement rather than a description.
- If the prose is genuinely wrong, fix it as a normal change to that skill. Re-run the
  affected case afterwards. If you did not re-run it, say so plainly.

## Not this skill

- Anything that gates a commit → `npm test`. A probabilistic measurement in a commit
  gate produces a check that fails for unrelated reasons. Someone then disables that
  check, and that also disables the real tests. **Never add the eval to `npm test`.**
- Adding a case → add an object in `evals/cases.mjs`. The harness never changes.
- Observing the real app behave → **/verify**.
- Deciding whether an idea is a feature or an assumption → **/triage**.
