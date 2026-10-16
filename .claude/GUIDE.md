# Skill framework — quick guide

Six skills, one loop. **triage** sorts an idea in: things we'd *build* become backlog
entries and go to **implement**, then **verify** in the running app; things we're
merely *assuming* become open decisions, which block whatever depends on them. Work
ends the same way: **land** the branch on main → **ship** the docs → **checkpoint** the
session. Each tracking file has exactly one skill that writes it, so nothing goes stale
or gets double-edited.

There is a seventh, **/eval**, that is deliberately *not* part of that loop: it measures
whether these skills' own prose still works. See [The checks](#the-checks-behind-the-skills).

## The skills

### /triage — "I have an idea"
Sorts a raw idea into the backlog or the decisions register, and drafts the entry.
Writes nothing until you approve.

```
/triage add a sound when an item is placed
/triage I think the API caps us at 100 req/min
/triage groom                  ← re-check blockers, sweep resolved ODs, spot what's about to block
triage the dev notes
```

→ You get: feature or **open decision**? already tracked? + a ready draft. Approve it
and /ship writes it in.

**Groom mode** is the other half. The schema check *detects* rot — stale entries,
dangling queues — and then waits for someone to care. `/triage groom` is that someone:
it reports what's newly unblocked (usually the most valuable output — nothing else
notices), what a `refuted` assumption just voided, which open assumptions are about to
start blocking the queue, and what needs re-dating. It proposes; you decide.

### /implement — "build P#"
Takes one backlog entry (or one milestone of it) to verified code on a feature branch.
Claims the entry `in-progress` on main first (via /ship) so parallel sessions see the
claim; writes code + tests only, never the docs.

```
/implement P4
pick up P3 R1
```

Also how a **spike** gets built — an entry carrying `Resolves: OD-n`, whose deliverable
is the answer to an assumption rather than a feature.

### /verify — "does it actually work?"
Drives the affected flow in the *running app* and reports what was observed — the step
after tests pass and before /land. Also the launch recipe when you just want the app
run or screenshotted. Forked, writes nothing in-repo (throwaway scripts live in the
scratchpad; a flow worth keeping becomes a real committed spec via /implement).

```
/verify                        ← observe the working-tree change end-to-end
run the app and screenshot the main view
```

### /land — "merge it into main"
The integration step: merge one finished branch into main, re-run the full suite on the
merged result, then run /ship's doc flips there. Doc flips happen at land time — never
on the branch — so parallel branches can't conflict on the backlog. Runs forked
(`context: fork`), so the merge/test output doesn't eat the session's context — you get
back a compact landing report, ending in the entry's `Accept:` criteria with a verdict
each. It never flips `shipped`: when the last milestone lands, the entry waits
`in-progress` for **you** to accept it against that report — "ship it" sends /ship to
make the flip.

```
/land feat/p10-long-feedback
land this branch
```

### /ship — "sync the docs"
The pen for the tracked docs — nothing else writes BACKLOG.md, BUILD_ORDER.md, or
ARCHITECTURE.md, and it writes them **on main only**. Flips statuses (claims +
terminal), records open-decision resolutions and sweeps what they unblocked, refreshes
`## Next up`, appends approved /triage drafts. Usually runs as /land's last step.

```
/ship                          ← figure out what shipped from git
mark P5 partial — first milestone landed
yes, ship P5                   ← your acceptance; the only way an entry reaches shipped
resolve OD-3 — the real limit is 40/min
```

It will *propose* spec changes to you but never edit them — those are yours.

### /checkpoint — "wrap up the session"
End-of-session closeout: runs `npm run audit` to find what's dangling (statuses honest,
tree clean, spikes that found an answer but didn't record it, resolutions nobody swept,
unmerged branches accounted for), decides what to do about each, makes tidy commits, and
updates **this branch's section** of `.claude/HANDOFF.md`. HANDOFF holds one section per
in-flight branch — parallel sessions each own theirs — and marks which branches are
ready for /land.

```
/checkpoint
wrap up
```

The audit is a script, not a checklist in the skill, because all five checks are
decidable from git + the docs — and end-of-session is exactly when eyeballing a grep
goes wrong. The skill owns the *response*; the script owns the *computation*.

## The checks behind the skills

The skills are prose, and prose is followed probabilistically. These are the parts that
aren't — they run whether or not anyone remembers them.

| Command | What it holds | When it runs |
|---|---|---|
| `npm test` | every check proven to still bite, the loop walked end-to-end, the skills' own instructions held against rot | pre-commit hook, and CI |
| `npm run check:docs` | the docs stay greppable — the schema every skill's grep depends on | in-session (PostToolUse hook) + `npm test` |
| `npm run check:guards` | the edit-guard is still armed and still covers every write tool | in-session (PostToolUse hook) + `npm test` |
| `npm run audit` | the decidable half of /checkpoint — dangling claims, unswept resolutions, branches with no baton | /checkpoint |
| `npm run eval` | whether the skills' **prose** causes the right decision | never automatically — see below |

Nothing installs: Node 18+ and nothing else.

### /eval — running it

`npm run eval` is the only one you can't just fire and read. It measures a model, so
**the session is the transport**: the command writes one prompt file per case, an agent
runs **one subagent per file** and saves each reply verbatim, then
`npm run eval -- --grade <dir>` scores them mechanically.

That procedure is the **/eval** skill — the seventh, off-loop one. It exists because the
steps are executed by an agent rather than a shell, and instructions an agent has to be
told about are instructions that get skipped.

```
/eval                          ← proposes a scope, then drives it
/eval --case depends --reps 1  ← iterating on one gate's wording
did my prompt edit help?
```

Three ways to get a number that looks real and means nothing — the harness catches the
last one, you have to hold the first two:

- **Paraphrasing or trimming the emitted prompt.** It is the artifact under test; hand
  it over whole.
- **Reusing one subagent across reps.** That measures one agent's consistency, not the
  prompt. Reps are independent agents or they aren't reps.
- **Losing a reply.** Dropping unanswered reps silently raises the pass rate, so
  `--grade` refuses to report at all until every reply is present.

It never gates a commit: a probabilistic measurement wired into a commit gate fails for
unrelated reasons and gets switched off, taking the real tests with it. Details and the
honest limits are in [evals/README.md](../evals/README.md).

## Typical days

**Feature idea → shipped:**
```
/triage <idea>  →  /implement P#  →  /verify  →  /land  →  you accept  →  /ship  →  /checkpoint
```

**Assumption discovered → settled:**
```
/triage <assumption>  →  OD-n registered  →  (it blocks P4, which is next up)
   →  /triage groom says spike it  →  /implement P9  →  /land  →  /ship writes
      OD-n's Resolution + sweeps what it unblocked
```

**Parallel sessions** (2–3 at once):

- **One session = one branch = one worktree.** The main checkout belongs to whichever
  session is integrating (/land, /ship, /checkpoint on main); branch sessions never
  edit it.
- **Claims are read from main**, not your checkout — a worktree's BACKLOG.md copy
  predates claims made since you branched. /implement's claim gate does this
  (`git show main:…`).
- **End-to-end runs are serialized — one session at a time.** Browser automation
  reuses whatever server holds the port, so a parallel run silently tests the *other*
  worktree's code and passes anyway. Branch sessions run targeted tests only; the full
  suite runs once, at /land (forked, so its output stays out of your context).
- **Start narrow, end early** (token budget): open with "continue P38 per HANDOFF"
  rather than "what's next?" so the session reads its HANDOFF section instead of
  re-exploring the repo, and /checkpoint + close as soon as its milestone is done — an
  idle open session just accretes context.
- **One /checkpoint at a time**: HANDOFF is a single file; simultaneous writers clobber
  each other (last one wins).

**Starting a fresh session:**
```
read .claude/HANDOFF.md   (or just: "what's next?")
```

## Who writes what (the single-writer map)

| File | Only writer | Where |
|---|---|---|
| `docs/product/BACKLOG.md`, `BUILD_ORDER.md`, `ARCHITECTURE.md` | /ship | **main only** |
| `docs/OPEN_DECISIONS.md` | *no single pen* — shape enforced by the schema check | anywhere |
| `docs/LESSONS.md` | *no single pen* — whoever pays for a lesson writes it | anywhere |
| `.claude/HANDOFF.md` | /checkpoint (own branch's section only) | local, gitignored |
| `src/`, `tests/` | /implement | branch |
| *(nothing tracked — scratchpad scripts, gitignored eval runs)* | /verify, /triage, /eval | — |
| `docs/SPEC.md`, `docs/dev_notes/` | **you** (human-only, hook-enforced) | — |

## Why single-writer

Two agents editing one backlog file produce merge conflicts on `## Next up` every
time, and — worse — a status flip made on a branch is invisible to every other session
until it merges, which is exactly when the claim was supposed to prevent duplicate
work. One pen per file, and doc edits on main only, makes both problems structurally
impossible rather than merely discouraged.

The two exceptions prove the rule. `OPEN_DECISIONS.md` has no owner because an
assumption is settled by whoever hits it — assigning one would just mean the list
never gets worked. `LESSONS.md` has none because a scar belongs to whoever earned it.
Neither is a queue, so neither has a `## Next up` to conflict over; what's enforced is
their *shape*, not their author.
