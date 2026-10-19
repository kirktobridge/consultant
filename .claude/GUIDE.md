# Skill framework — quick guide

Five skills, one loop. **triage** sorts an idea in: things we'd *build* become backlog
entries and go to **implement**, then **verify** in the running app; things we're
merely *assuming* become open assumptions, and choices only you can make become open
decisions; both block whatever depends on them. Work
ends the same way: **land** the branch on main → **ship** the docs. Each tracking file has exactly one skill that writes it, so nothing goes stale
or gets double-edited.

There is a sixth, **/eval**, that is deliberately *not* part of that loop: it measures
whether these skills' own prose still works. See [The checks](#the-checks-behind-the-skills).

## The skills

### /triage — "I have an idea"
Sorts a raw idea into the backlog, the assumptions register or the decisions register,
and drafts the entry.
Writes nothing until you approve.

```
/triage add a sound when an item is placed
/triage I think the API caps us at 100 req/min
/triage should exports count toward the disk cap?
/triage groom                  ← re-check blockers, sweep resolved assumptions, spot what's about to block
triage the dev notes
```

→ You get: feature, **assumption** or **decision**? already tracked? + a ready draft. Approve it
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

Also how a **spike** gets built — an entry whose header carries `resolves: A-n`, whose deliverable
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
merged result, then run /ship's doc flips there. /implement invokes it itself, after
it has taken the land lock and rebased in its worktree, resolving any conflicts
there (`scripts/land.mjs`). Landings and claims share that one lock, so parallel
sessions land one after the other. A conflict stops for you only when the
resolution would keep just one entry's side, or the suite is red after it. Doc flips happen at land time — never
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
The pen for the tracked docs — nothing else writes the backlog (`docs/backlog/`),
the decisions register (`docs/decisions/`), BUILD_ORDER.md, or ARCHITECTURE.md, and it
writes them **on main only**. Flips statuses (claims + terminal), records the decisions
you take and assumption resolutions and sweeps what they unblocked,
refreshes the queue (`docs/backlog/QUEUE.md`), writes approved /triage drafts in as new
entry files. Usually runs as /land's last step.

```
/ship                          ← figure out what shipped from git
mark P5 partial — first milestone landed
yes, ship P5                   ← your acceptance; the only way an entry reaches shipped
resolve A-3 — the real limit is 40/min
we decided D-1: exports count toward the cap
```

It will *propose* spec changes to you but never edit them — those are yours.

### Session start — the audit runs itself
There is no closing ritual: a session ends when its work ends. Instead, every session
**starts** with `npm run audit`, run by a SessionStart hook whose output lands in the
session's context — what the last session left dangling (statuses that don't match
git, an uncommitted tree, a spike that found an answer but didn't record it, a
resolution nobody swept). Start rather than end, because a session that crashed or was
just closed never runs an end-of-session step.

The audit computes; the session and you decide what to do about each finding. Below
the findings it lists every open decision waiting on you, with what it holds back —
not a finding, since nothing was left dangling, but the questions only you can unblock.

### History — `npm run history [P#]`
What happened to an entry, read from git: each commit that names the ID in its subject
(claim, build commit with its close report, merge, landing note), in date order, plus
any branch not yet merged with its latest commit message. Nothing is kept by hand, so
nothing falls behind.

## The checks behind the skills

The skills are prose, and prose is followed probabilistically. These are the parts that
aren't — they run whether or not anyone remembers them.

| Command | What it holds | When it runs |
|---|---|---|
| `npm test` | every check proven to still bite, the loop walked end-to-end, the skills' own instructions held against rot | pre-commit hook, and CI |
| `npm run check:docs` | the docs stay greppable — the schema every skill's grep depends on | in-session (PostToolUse hook) + `npm test` |
| `node scripts/backlog-schema-check.mjs --graph` | what blocks what: open entries with no open blocker ranked by how much they unblock, the chain behind each blocked one, prose blockers ([below](#the-dependency-graph)) | /triage groom; any "what's next?" |
| `npm run check:guards` | the edit-guard is still armed and still covers every write tool | in-session (PostToolUse hook) + `npm test` |
| `npm run audit` | what the last session left dangling — claims that don't match git, unswept resolutions, uncommitted work | session start (SessionStart hook) |
| `npm run history` | each entry's commits and close reports, and unmerged branches | on demand |
| `npm run eval` | whether the skills' **prose** causes the right decision | never automatically — see below |

Nothing installs: Node 18+ and nothing else.

### The dependency graph

`node scripts/backlog-schema-check.mjs --graph` reads the `depends_on:` and
`waiting_on:` headers and prints what can start now (no open blocker; most-unblocking
first, counting everything downstream), the chain behind each blocked entry, and the
blockers that name no entry — a decision `waiting_on: user` — which it lists but cannot
follow, so they never hold an entry out of "start now".

`--graph --json` is the contract other tools read, the same shape as photocull's
`doc_check.py --graph --json`, so one renderer serves both. `tests/graph.test.mjs`
fails if the output and this block disagree, so change both together (and bump
`version` when a consumer would break). `from` blocks `to`; `field` is the header the
edge is written in (on `to`); edges and prose cover every entry as written, closed ones
included, and `open` says whether the entry's status is an open one in its register.

```json
{
  "version": 1,
  "entries": [{"id": "P19", "register": "product", "status": "proposed", "open": true, "title": "Session start says what's next"}],
  "edges": [{"from": "P11", "to": "P19", "field": "depends_on"}],
  "prose": [{"id": "D-1", "field": "waiting_on", "text": "user"}]
}
```

Graph registers: `product` / `assumptions` / `decisions`.

Graph fields: `depends_on` / `waiting_on`.

### /eval — running it

`npm run eval` is the only one you can't just fire and read. It measures a model, so
**the session is the transport**: the command writes one prompt file per case, an agent
runs **one subagent per file** and saves each reply verbatim, then
`npm run eval -- --grade <dir>` scores them mechanically.

That procedure is the **/eval** skill — the sixth, off-loop one. It exists because the
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
/triage <idea>  →  /implement P#  →  /verify  →  /land  →  you accept  →  /ship
```

**Assumption discovered → settled:**
```
/triage <assumption>  →  A-n registered  →  (it blocks P4, which is next up)
   →  /triage groom says spike it  →  /implement P9  →  /land  →  /ship writes
      A-n's Resolution + sweeps what it unblocked
```

**A choice only you can make:**
```
/triage <choice>  →  D-n registered (options, waiting_on: user)  →  blocks what depends on it
   →  every session's audit lists it  →  you decide  →  /ship records Decided / Why /
      leads_to  →  the P# it leads to is built
```

**Parallel sessions** (2–3 at once):

- **One session = one branch = one worktree**, and /implement provisions it
  (`scripts/worktree.mjs start`, after the claim). The main checkout belongs to
  whichever session is integrating (/land, /ship on main); branch sessions never
  edit it.
- **Claims are read from main**, not your checkout — a worktree's copy of the backlog
  predates claims made since you branched. /implement's claim gate does this
  (`git grep … main -- docs/backlog/`).
- **End-to-end runs are serialized — one session at a time.** Browser automation
  reuses whatever server holds the port, so a parallel run silently tests the *other*
  worktree's code and passes anyway. Branch sessions run targeted tests only; the full
  suite runs once, at /land (forked, so its output stays out of your context).
- **Start narrow, end early** (token budget): open with "continue P38" rather than
  "what's next?" — `npm run history P38` is the cheap re-entry — and close as soon as
  the milestone is done; an idle open session just accretes context.

**Starting a fresh session:**
```
the audit has already run — read it, then: npm run history P#   (or just: "what's next?")
```

## Who writes what (the single-writer map)

| File | Only writer | Where |
|---|---|---|
| `docs/backlog/` (entries, `docs/backlog/QUEUE.md`), `docs/decisions/`, `BUILD_ORDER.md`, `ARCHITECTURE.md` | /ship (you decide; it records) | **main only** |
| `docs/assumptions/` | *no single pen* — shape enforced by the schema check | anywhere |
| `docs/LESSONS.md` | *no single pen* — whoever pays for a lesson writes it | anywhere |
| `src/`, `tests/` | /implement | branch |
| *(nothing tracked — scratchpad scripts, gitignored eval runs)* | /verify, /triage, /eval | — |
| `docs/SPEC.md`, `docs/dev_notes/` | **you** (human-only, hook-enforced) | — |

## Why single-writer

Two agents editing the backlog produce merge conflicts on the queue every
time, and — worse — a status flip made on a branch is invisible to every other session
until it merges, which is exactly when the claim was supposed to prevent duplicate
work. One pen per file, and doc edits on main only, makes both problems structurally
impossible rather than merely discouraged.

The two exceptions prove the rule. `docs/assumptions/` has no owner because an
assumption is settled by whoever hits it — assigning one would just mean the list
never gets worked. `LESSONS.md` has none because a scar belongs to whoever earned it.
Neither is a queue, so neither has a queue file to conflict over; what's enforced is
their *shape*, not their author.
