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
| Costs money | no | yes |
| Needs an API key | no | yes |
| Needs `npm install` | no | yes (one dev dependency) |
| A red result means | something is broken | something is *worth looking at* |

Wiring a probabilistic measurement into a commit gate produces a check that fails for
reasons unrelated to the change, and gets disabled within a week — taking the real
tests with it.

## Running it

```bash
npm run eval -- --dry-run     # renders every prompt, self-checks the graders, no API calls
npm install --save-dev @anthropic-ai/sdk
npm run eval                  # all cases, 3 reps
npm run eval -- --case spike  # just the spike-decision cases
npm run eval -- --reps 10 --effort high
```

Credentials resolve the usual way: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an
`ant auth login` profile.

**Start with `--dry-run`.** It renders every prompt and, for each case, feeds the grader
one answer that should pass and one that should fail. A case whose expectations assert
nothing would pass no matter what a model said — the dry run catches that for free,
before you spend anything on it.

## How it works

Each case is a repo state plus a request plus the decision the skill is supposed to
produce. The system prompt is the **real SKILL.md, verbatim** — paraphrasing it would
measure the paraphrase. The repo state is rendered by `tests/helpers/fixture.mjs`, the
same renderer the schema tests use, so every case is a state the checker agrees is legal
or illegal; a failure is never ambiguous between "the model was wrong" and "the fixture
was malformed."

**Grading is mechanical, not an LLM judge.** Cases request a structured decision via
`output_config.format` and the harness asserts on parsed fields. A judge would put a
second probabilistic system between the thing under test and the verdict, and its drift
would be indistinguishable from the drift being measured.

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

## The one dependency

`@anthropic-ai/sdk`, dev-only. It is the only dependency in the repo, and the boundary
is deliberate: the hooks, the three scripts and all 138 tests stay dependency-free and
run on a fresh clone with no install step. Only the eval needs `npm install`, and only
the eval is opt-in.
