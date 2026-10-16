# Evals — measuring the prompt half

`tests/` covers everything decidable: the checkers, the tools, the document state
machine, the skills' own cross-references. What it cannot cover is the ~640 lines of
**prose** in `.claude/skills/*/SKILL.md`, because whether that prose causes the right
decision is a property of a model, not of a file.

This directory measures that. **It is not a test**, and the difference decides where it
runs:

| | `npm test` | `npm run eval` |
|---|---|---|
| Deterministic | yes | no |
| Gates a commit | yes (pre-commit hook) | **never** |
| Runs unattended | yes | no — the session is the transport |
| Costs | local CPU | one subagent per case-rep, against your session's token budget |
| Needs an API key | no | no |
| Needs `npm install` | no | no |
| A red result means | something is broken | something is *worth looking at* |

**On cost:** subagents are not free, they are just not *separately billed*. A full run
is one subagent per case per rep — three times the case count at the default 3 reps
(`--dry-run` prints the count); one smoke-test case ran ~25k tokens. What the subagent transport actually removed is the API key, the SDK, and the
second bill — not the expense. Budget a run, and prefer `--reps 1` while iterating on a
prompt.

Wiring a probabilistic measurement into a commit gate produces a check that fails for
reasons unrelated to the change, and gets disabled within a week — taking the real
tests with it.

## The transport: subagents

The answers come from **subagents spawned by the Claude Code session you are already
in**. No API key, no SDK, no dependency — which is why the repo still installs nothing.

The consequence is that `run.mjs` is a **renderer and a grader, not a client**: a Node
process cannot spawn a subagent, so a run is two commands with the session's work
between them.

```bash
npm run eval -- --dry-run       # renders every prompt, self-checks the graders, spawns nothing
npm run eval                    # → writes evals/runs/<stamp>/prompts/*.md
#   … the session runs one subagent per prompt file and saves each reply verbatim
#     to evals/runs/<stamp>/replies/<same-key>.txt …
npm run eval -- --grade evals/runs/<stamp>

npm run eval -- --case spike    # just the spike-decision cases
npm run eval -- --reps 1        # each rep is one more subagent
npm run eval -- --note 'opus-5, effort high'   # recorded in the summary line
```

`--emit` is the default because the emitted prompt is the artifact under test: it is
handed to the subagent **whole and unedited**. Summarising it, or wrapping it in your
own framing, measures your framing.

**Reps of the same case must be independent subagents.** One agent answering the same
prompt twice measures its own consistency, not the prompt.

**Start with `--dry-run`.** It renders every prompt and, for each case, feeds the grader
one answer that should pass and one that should fail. A case whose expectations assert
nothing would pass no matter what a model said — the dry run catches that for free.

Run directories are gitignored and regenerate from `cases.mjs` at any time.

## How it works

Each case is a repo state plus a request plus the decision the skill is supposed to
produce. The prompt contains the **real SKILL.md, verbatim** — paraphrasing it would
measure the paraphrase. The repo state is rendered by `tests/helpers/fixture.mjs`, the
same renderer the schema tests use, so every case is a state the checker agrees is legal
or illegal; a failure is never ambiguous between "the model was wrong" and "the fixture
was malformed."

The prompt tells the subagent to **use no tools**. This matters more than it looks: the
fixture state in the prompt is not the state on disk, so a single `Read` of the real
backlog entry would silently answer a different question and the grade would be
meaningless rather than wrong.

**Grading is mechanical, not an LLM judge.** The reply must end with one fenced `json`
block; the harness parses it and asserts on the fields. A judge would put a second
probabilistic system between the thing under test and the verdict, and its drift would
be indistinguishable from the drift being measured.

A reply the harness cannot parse **fails** — it is never skipped. So does a run with a
missing reply, which refuses to report a rate at all: dropping unanswered reps quietly
raises the pass rate, which is LESSONS L3 wearing a different hat.

Adding a case means adding an object to `cases.mjs`. The harness never changes.

## What it can and cannot tell you

**Can:** whether a gate fires — that /implement refuses an entry resting on an open
assumption, that /triage routes an assumption to the register rather than the backlog,
that /ship won't edit the spec, that the spike decision respects queue proximity in both
directions. Several cases come in pairs precisely so a "gate" that just refuses
everything doesn't read as a pass.

**Cannot:** whether a model executes a ten-step plan correctly once the decision is
made. That's dominated by harness and tooling, not by the words in a skill.

**Also cannot: tell you a prompt edit helped.** Grading a rate rigorously — how many
repetitions, what counts as a real difference, when a result is worth acting on — is
exactly the discipline the measurable track carries, and this branch deleted it. What's
here is deliberately modest: a bar registered in the source before any run, N
repetitions, a flat pass rate. Read a drop as a reason to go look at the prompt. For
anything stronger, use the `/research` variant on `master`.

## Two things the subagent transport gives up

Worth stating rather than discovering later. Both are consequences of not using the API,
and both push the same direction — a low score is a reason to *look*, not a proof.

1. **SKILL.md arrives as user-turn text, not as a system prompt.** A subagent has no
   system prompt to set. In a real session the skill is injected as instructions, which
   is a slightly stronger position than the one being measured here.
2. **The reply format is a convention, not a schema.** `output_config.format` would
   guarantee the shape; a fenced block only asks for it. The harness compensates by
   grading an unparseable reply as a failure, so the error can only cost you points —
   never buy them.
