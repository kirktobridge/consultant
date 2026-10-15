# Porting this suite to your project

Everything here is generic except a handful of clearly-marked spots. This guide is the
list of those spots, in the order worth doing them, plus the judgement calls where
copying blindly will hurt.

Search the tree for `PORTING` to find every marked block:

```bash
grep -rn "PORTING" --include=*.md --include=*.mjs --include=*.py .
```

---

## Step 0 — check you're on the right variant

This suite is **build-only**: everything routes through one question — *would we
build this, or are we assuming it?*

A retired variant carried a second, **measurable** track: `/research`, an experiment
framework, an append-only run log, and findings graded
`replicated`/`significant`/`directional`. Its routing question was *can this state a
pre-registered success criterion — a metric plus a bar?* It survives as the tag
`measurement-track`, frozen before this suite's tests, eval, and `Accept:` field.

**Consider porting from it** if your project makes claims that could be wrong in a way
a test won't catch — performance work, model/prompt quality, ranking, pricing, anything
tuned. The measurable track is what stops "it feels faster" from becoming a committed
default. Expect to port by hand: the snapshot is unmaintained, and nothing here checks
it.

**Stay here** if you genuinely ship only features. Don't bolt a half-hearted research
backlog onto this later: one nobody runs is worse than none, because the next session
reads it as live.

**Prerequisite: Node 18+ on `PATH`, and nothing else.** The hooks, the scripts, the
tests and the eval harness are all dependency-free ESM with no build step, so
`npm install` is never required and everything runs on a fresh clone. The hooks invoke `node` directly, which means this holds
even if your project is written in something else — a Go or Python codebase still needs
Node present for the guard and the checks to fire. That is the one thing this suite
imposes on your stack; if it is unacceptable, the scripts are small enough to port, and
`tests/` is what tells you whether the port is faithful.

## Step 1 — the human-owned files (do this first, it's the cheapest win)

Edit [.claude/edit-blocklist](.claude/edit-blocklist): list the docs whose authority is
yours — spec, requirements, raw idea dumps. The hook makes "human-owned" real rather
than aspirational; a skill told not to edit a file mostly complies, a hook always does.

Note the blocklist matches on **basename as well as path**, so a bare `edit-blocklist`
pattern blocks any file of that name anywhere on disk — including in other checkouts.
Prefer path-qualified patterns. (This bit us while extracting this very template.)

Verify the guard is live:

```bash
echo '{"tool_input":{"file_path":"docs/SPEC.md"}}' | node .claude/edit-guard.mjs; echo "exit=$? (expect 2)"
```

## Step 2 — name your things

| Placeholder | Means | Where |
|---|---|---|
| `P#` | product backlog IDs | BACKLOG.md, all skills, schema check |
| `OD-n` | open decisions (unverified assumptions) | OPEN_DECISIONS.md, schema check |
| `L#` | lessons | LESSONS.md |
| `docs/SPEC.md` | your human-owned source of truth | blocklist, /ship, /implement |
| `main` | integration branch | /land, /implement, /checkpoint |

Keep `P#` and `OD-n` **globally unique** — the schema check enforces it, and the
cross-pointers (`Depends on: OD-3`, `Resolves: OD-3`) are unparseable without it.

## Step 3 — seed the open-decisions register

[docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md) is the cheapest high-value thing to
fill in, and it works on day one — unlike the backlog, you already know its contents.

Spend twenty minutes listing what your project currently *assumes* and nobody has
checked: a third-party API's real rate limit or error semantics, a constant someone
took from a blog post, a scaling limit never actually hit, "users won't do X". Each
becomes an `OD-n` with a `How to verify:` line. If you can't name a concrete check, you
don't have an OD — you have a wish; leave it out.

Three things make it more than a wiki page:
- an `open` OD **blocks** work that depends on it, graded by how close that work is
  (see *What NOT to change*) — enforced by the schema check and /implement's DEPENDS
  GATE;
- `/triage groom` sweeps resolutions, so settling one OD surfaces everything it
  unblocked, and flags assumptions about to start blocking. Nothing else in the loop
  notices either;
- an assumption that's expensive *and* blocking the queue becomes a **spike** `P#`,
  paired to the OD by `Resolves:` and held by the schema check.

Keep `refuted` entries as `refuted`. Rewriting one into a `verified` entry describing
the new truth destroys the most useful signal in the file — that we believed something
false, and for how long, which is what calibrates trust in everything still `open`.

If your project genuinely has no unverified assumptions, you haven't looked yet.

## Step 4 — the launch recipe (/verify)

[.claude/skills/verify/SKILL.md](.claude/skills/verify/SKILL.md) has a section marked
**REPLACE THIS ENTIRE SECTION**. It is the most project-specific file in the suite and
the one where vagueness costs most: a verify step that says "start the app and look at
it" produces verification theatre.

Be specific about:
- the exact start command **with a pinned port** — a stale server on the expected port
  serves old code and passes, which is the most common way a verify run lies;
- a readiness probe, not a sleep;
- where logs go, and that you read them at the end;
- flags that remove animation/think-time so a script can drive the app;
- two or three canonical flows with real selectors.

## Step 5 — wire the checks in

The repo ships a minimal [package.json](package.json):

```jsonc
"scripts": {
  "test": "node --test \"tests/**/*.test.mjs\" && npm run check:docs && npm run check:guards",
  "check:docs": "node scripts/backlog-schema-check.mjs --all",
  "check:guards": "node scripts/verify-guards.mjs --all",
  "audit": "node scripts/session-audit.mjs",
  "install-git-hooks": "ln -sf ../../.claude/hooks/pre-commit .git/hooks/pre-commit"
}
```

Add your project's own tests to the `test` line, and run the lot before every commit:

```bash
npm run install-git-hooks    # symlinks .claude/hooks/pre-commit into .git/hooks/
```

Keep `tests/` — it is what stops the checks rotting into decoration. Two of its files
carry most of that weight and are worth understanding before you trim anything:

- **`loop.test.mjs`** walks a fake project through the whole process — file a blocked
  draft, fail to queue it, spike the assumption, resolve, re-read, build, ship, refresh
  — asserting what is legal at each step. It is the executable statement of how the
  system behaves, and it catches what per-rule tests structurally cannot: interactions.
- **`process.test.mjs`** holds the *skills' instructions*, which are prose and rot the
  moment a file moves. Every command a skill tells you to run must exist, every handoff
  must name a real skill, every link must resolve, and the single-writer map must agree
  with the skills it describes. This one exists because two renames silently invalidated
  instructions in four skills while this suite was being built.

What `tests/` structurally cannot cover is the ~640 lines of **prose** in the skills,
because whether prose causes the right decision is a property of a model. That is
[`evals/`](evals/README.md) — `npm run eval`, opt-in, and deliberately **not** in
`npm test`: a probabilistic measurement wired into a commit gate fails for reasons
unrelated to the change and gets switched off, taking the real tests with it.

It answers with **subagents from the session you are already in** — no API key, no SDK,
so the repo still installs nothing at all. The cost of that choice is that `run.mjs`
can't spawn them itself: `npm run eval` writes one prompt file per case, the session
runs one subagent per file and saves each reply, and `npm run eval -- --grade <dir>`
scores them. Keep the emitted prompt **unedited** when you hand it over; it is the
artifact under test.

That procedure is the **/eval** skill — the seventh, and the one that is *not* part of
the loop. Keep it if you expect to edit the skills' prose; delete
`.claude/skills/eval/` and `evals/` together if you don't, and don't leave one without
the other. Subagents cost your session's token budget, so a full sweep is worth
scoping before you start rather than after.

`check:guards` belongs in `test` specifically, and not only in the hook — see *The
three placements of `verify-guards`* below. `audit` stays out deliberately: it reads
session state, where an uncommitted tree is normal rather than a failure.

The PostToolUse hooks already run the doc and guard checks in-session, the moment an
edit touches a tracked file — feeding violations back while the context to fix them is
still live. CI is the durability half, for edits made outside a session.

## Step 6 — start your own LESSONS.md

[docs/LESSONS.md](docs/LESSONS.md) ships with three lessons that are genuinely
domain-independent — keep them. Add yours only when something actually goes wrong. A
lesson invented pre-emptively is a maxim in costume, and maxims are what this file
format exists to avoid.

---

## What NOT to change

These look arbitrary and are not. Each was paid for.

**Graduated OD blocking, not all-or-nothing.** An entry may sit `proposed` in the pool
while resting on an `open` assumption; the same entry in `## Next up` or flipped
`in-progress` fails. The obvious implementation — block anything that depends on an
open OD — makes it impossible to *file* a blocked idea, which is exactly what /triage
is told to do. A check that's permanently red teaches people to ignore it, and then it
stops holding the case it was built for.

**The spike bound.** An expensive assumption becomes real work only when its dependents
reach the queue. Without that bound the register turns into a generator of speculative
investigations, and the cheapest thing about it — that you can *list* what you're
standing on without doing anything about it — is lost.

**`Resolves:` as a field, not a sentence.** The pairing between a spike and its
assumption is checkable only because it's structured. "We should settle this
eventually" in prose is unenforceable by construction: nothing can grep it and nobody
is accountable for it. See LESSONS L2.

**Collected, not fail-fast.** Checks that can produce several independent loose ends
gather them all. Failing on the first hit hides the rest — and in the original, the case
a check existed for was masked by an unrelated earlier hit.

**Doc flips on main only.** Tempting to let a branch flip its own status. Don't: two
branches touching `## Next up` conflict every time, and a claim made on a branch is
invisible to other sessions until it merges — exactly when it was supposed to prevent
duplicate work.

**`grep-checked` instead of `grep`, for negatives.** "grep found none" and "the tool is
misconfigured" are indistinguishable from the output alone; in the original project two
proxied greps "proved" no entry was in a given state, and nine were. The tool searches
in-process (nothing can proxy it) and refuses to report a zero it can't back — exit 2
means *not evidence*, not *none found*. Portable as-is; it has no project-specific
content. See LESSONS L1.

**The three placements of `verify-guards`.** `.claude/settings.json` is deliberately
*not* in the edit blocklist — blocking it would stop Claude managing hooks and
permissions, which is a legitimate thing to want. The cost is that an agent can disarm
the guard by editing the file that declares it, so the check runs in three places with
deliberately different reach:

| where | reach | can it be disabled by the edit it catches? |
|---|---|---|
| `npm test` / CI | every clone, every run | **no** — lives in package.json |
| PostToolUse hook | this session, immediately | yes — it is declared in settings.json |
| `.claude/hooks/pre-commit` | this clone, if installed | yes — `--no-verify`, or never installing it |

Only the first is a guarantee; the other two are fast feedback. A check declared inside
the thing it guards is not a guard. Do not "simplify" by keeping only the hook.

Pre-commit rather than post-commit, for the same reason: post-commit runs after the
commit exists, so it can only narrate a state it was too late to prevent. Install with
`npm run install-git-hooks`.

**The audit as a script, not a checklist.** /checkpoint's five end-of-session checks
live in `scripts/session-audit.mjs` because they are fully decidable, and because a
model re-deriving them by hand at the end of a long session is exactly when eyeballing
a grep goes wrong. The skill owns the *response*; the script owns the *computation*.
Resist folding judgement into it — "is this claim abandoned or just paused" has to stay
a question asked of a human.

**Dating open entries.** Cheap, and it's what makes /implement's premise gate
*affordable*: re-verify the entries older than their dependencies rather than all of
them.

**The entry count in the check's success line.** `OK (n entries across m file(s))` is a
positive control printed on every run. A checker whose parser silently stops matching
reports success exactly like a clean tree; a count that drops without files being
deleted is the tell. See LESSONS L3.

## Evolving the schema

The format lives in three places — the doc that documents it, the checker that enforces
it, and every skill's grep that relies on it. **Change all three in the same commit.**

The failure mode to refuse: loosening the check so a malformed entry passes. That
inverts the tool — the thing that catches drift becomes the thing that ratifies it. A
red check is either a bad entry (fix the entry) or a real convention change (change all
three). It is never "the check is being annoying."

When you do change it, **prove it still bites**: feed the checker input you know is bad
and confirm it fails, before trusting a green run on real input.

---

## Adapting to a different topology

**Solo, no parallel sessions?** Keep single-writer (it prevents doc drift regardless);
you can relax flips-on-main and skip HANDOFF's per-branch sectioning.

**Trunk-based, no feature branches?** /land collapses into "run the suite, then /ship".
Keep the claim flip — it still prevents two sessions racing the same entry.

**Team of humans + agents?** The backlog is already the coordination surface. Consider
making `Drafted:` staleness a hard CI failure rather than a flag.

**No app to drive?** /verify still applies — "drive the real thing" means running the
CLI, hitting the endpoint, importing the built package. What it forbids is substituting
"the suite is green" for observation, and that's domain-independent.
