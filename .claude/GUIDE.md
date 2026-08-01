# Skill framework — quick guide

Seven skills, one loop with two tracks. **triage** sorts an idea in: product features
— the usual case — go to **implement**, then **verify** in the running app; measurable
questions go to **research** and are proven on a harness instead. Both tracks end the
same way: **land** the branch on main → **ship** the docs → **checkpoint** the session.
Each tracking file has exactly one skill that writes it, so nothing goes stale or gets
double-edited.

## The skills

### /triage — "I have an idea"
Sorts a raw idea into the right backlog and drafts the entry. Writes nothing until you
approve.

```
/triage add a sound when an item is placed
/triage what if we pruned symmetric first moves
/triage groom                  ← re-check blockers, sweep resolved ODs, act on staleness
triage the dev notes
```

→ You get: research, product, or **open decision**? already tracked? + a ready draft.
Approve it and /research or /ship writes it in.

**Groom mode** is the other half. The schema check *detects* rot — stale entries,
dangling queues — and then waits for someone to care. `/triage groom` is that someone:
it reports what's newly unblocked (usually the most valuable output — nothing else
notices), what a `refuted` assumption just voided, and what needs re-dating. It
proposes; you decide.

### /research — "run the experiment"
The whole experiment loop for `docs/research/`: pick a backlog entry, run the harness,
log the run, distil the finding, close the entry. Owns all of `docs/research/`.

```
/research                     ← what's open, what's next
/research run AE9             ← start an experiment
/research record              ← log results
/research findings            ← distil + close the loop
```

Run setups go in `scripts/experiments/<id>.json` — never edited into the harness.

### /implement — "build P#"
Takes one product-backlog entry (or one milestone of it) to verified code on a feature
branch. Claims the entry `in-progress` on main first (via /ship) so parallel sessions
see the claim; writes code + tests only, never the docs.

```
/implement P4
pick up P3 R1
```

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
back a compact landing report.

```
/land feat/p10-long-feedback
land this branch
```

### /ship — "sync the docs"
The pen for the product docs — nothing else writes BACKLOG.md, BUILD_ORDER.md, or
ARCHITECTURE.md, and it writes them **on main only**. Flips statuses (claims +
terminal), refreshes `## Next up`, appends approved /triage drafts. Usually runs as
/land's last step.

```
/ship                          ← figure out what shipped from git
mark P5 partial — first milestone landed
add the approved draft to the backlog
```

It will *propose* spec changes to you but never edit them — those are yours.

### /checkpoint — "wrap up the session"
End-of-session closeout: checks nothing is dangling (statuses honest, tree clean,
unmerged branches accounted for), makes tidy commits, and updates **this branch's
section** of `.claude/HANDOFF.md`. HANDOFF holds one section per in-flight branch —
parallel sessions each own theirs — and marks which branches are ready for /land.

```
/checkpoint
wrap up
```

## Typical days

**Measurable idea → answered:**
```
/triage <idea>  →  /research run AE#  →  /research record  →  /research findings  →  /land  →  /checkpoint
```

**Product/UI idea → shipped:**
```
/triage <idea>  →  /implement P#  →  /verify  →  /land  →  /checkpoint
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
| `docs/research/` (backlog, log, FINDINGS) | /research | branch or main |
| `docs/product/BACKLOG.md`, `BUILD_ORDER.md`, `ARCHITECTURE.md` | /ship | **main only** |
| `docs/OPEN_DECISIONS.md` | *no single pen* — shape enforced by the schema check | anywhere |
| `.claude/HANDOFF.md` | /checkpoint (own branch's section only) | local, gitignored |
| `src/`, `tests/` | /implement | branch |
| *(nothing — scratchpad scripts only)* | /verify, /triage | — |
| `docs/SPEC.md`, `docs/dev_notes/` | **you** (human-only, hook-enforced) | — |

## Why single-writer

Two agents editing one backlog file produce merge conflicts on `## Next up` every
time, and — worse — a status flip made on a branch is invisible to every other session
until it merges, which is exactly when the claim was supposed to prevent duplicate
work. One pen per file, and product-doc edits on main only, makes both problems
structurally impossible rather than merely discouraged.
