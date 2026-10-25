# Product backlog

Curated pool of everything we intend to **build** — the shippable, user-facing side of
the project. One file per entry (`P#.md`) in this directory. Its sibling is
[../assumptions/](../assumptions/README.md), which holds what we're currently *assuming*:
this register is work, that one is doubt. An idea that's really "we should find out
whether X" belongs there, not here. A choice only the product owner can make belongs in
[../decisions/](../decisions/README.md).

A backlog is a **prioritized pool, not a committed plan** — its dependency-ready head is
[QUEUE.md](QUEUE.md) (the authoritative "what's next to build"); the shipped build
history lives in [../BUILD_ORDER.md](../BUILD_ORDER.md) and in git (`npm run history`).
[../dev_notes/OPEN_IDEAS.md](../dev_notes/OPEN_IDEAS.md) is the raw, unmaintained
developer dump; this register is the curated version. Rules → [../SPEC.md](../SPEC.md);
structure → [../ARCHITECTURE.md](../ARCHITECTURE.md).

Status vocab: `proposed` / `in-progress` (being built this session/branch) / `partial`
(some milestones shipped) / `shipped` / `deferred` / `abandoned`.

Plan vocab: `yes` (the build stops for an approved plan before any code) / `no`.

**Written only by /ship**, on main only. See `.claude/GUIDE.md`.

---

## Entry shape

A **header** the tools read, then a **body** only people read. The schema check
(`npm run check:docs`) holds both.

```markdown
---
id: P7
title: A status view for the product owner
status: proposed
epic: Product-owner interface
drafted: YYYY-MM-DD
plan: no
depends_on: P4, A-3
---

## Value

what the user gets, in their terms.

## Scope

what gets built; what's out.

## Accept

- one thing someone could watch pass or fail.
- another.

## Notes

Plan: no — one script and its tests.

anything else.
```

**The header is strict.** Every line between the `---` fences is a `key: value` field,
and only these keys exist:

| key | holds |
|---|---|
| `id` | `P#` — must match the file name |
| `title` | one line |
| `status` | a word from the vocab above |
| `epic` | the group it belongs to (below) |
| `drafted` | `YYYY-MM-DD` — when its claims were last established; required while open |
| `plan` | `yes` or `no` — whether the build stops for an approved plan; required while open |
| `depends_on` | comma-separated `P#` / `A-n` / `D-n`, or `—` |
| `resolves` | the `A-n` a spike answers (see [../assumptions/](../assumptions/README.md)) |
| `shipped` | `YYYY-MM-DD` the user accepted it |
| `rejected` | comma-separated `YYYY-MM-DD`, one per landing the user rejected, oldest first; landings before the commit that last changed it no longer count (`scripts/landing.mjs`) |

An unknown key, a line that isn't `key: value`, or a value of the wrong type fails the
check with the file and line. ID lists hold IDs only — *why* something depends on
something goes in the body (a `## Depends on` section is the convention). That is the
whole point of the split: **nothing in the body is ever read as a field**, so an entry
can describe `status: shipped` or `depends_on: A-3` in prose without becoming it.

**The body** is `## ` sections. Required: `Value` always; `Scope` and `Accept` while
open. Anything else (`Notes`, `Depends on`, `Shipped`) is free.

Every open entry carries **`Accept`** — 2–4 top-level bullets, each one thing someone
could watch pass or fail. `Scope` is what gets built; `Accept` is how the product owner
would know it was built right, in their words. The schema check enforces the *count*
(so the field can't degrade into one unfalsifiable sentence), never the wording — /ship
copies it verbatim, and a criterion that looks wrong is the user's to rewrite.

Every open entry also carries **`plan:`**, set by /triage when it drafts the entry and
changed only by rescoping through /ship. `yes` means /implement writes a plan (files to
touch, order, risks) and waits for the product owner's approval before any code. Its
reason goes under `## Notes` as a line `Plan: yes|no — reason`; entries filed before
the field carry it inside a sentence there instead. `no` is a floor, not a ceiling: a build that turns out bigger
than drafted still stops for a plan.

An entry may sit here `proposed` while it depends on an **open** `A-n` or `D-n` — that's how a
blocked idea gets filed rather than lost. It may **not** appear in the queue or go
`in-progress` in that state; the schema check enforces the line. A `moved` assumption or
a `superseded` decision is not something to wait on: an open entry naming one fails at
any status, `proposed` included, until its `depends_on:` is re-pointed to the `moved_to:`
/ `superseded_by:` home.

A `P#` dependency blocks too, read through the whole graph: an entry may go
`in-progress` or `partial` only once every `P#` it depends on, directly or through
another entry, is `shipped` — `partial` and `in-progress` don't count as met, and a
`deferred` or `abandoned` dependency never will be. A dependency cycle fails outright.
All of this is *mechanically enforced* by the schema check.

## The queue

[QUEUE.md](QUEUE.md) is the **dependency-ready** head of the backlog, highest-payoff
first — the authoritative answer to "what to build next." Generated by `npm run
queue`, which /ship runs on status flips + intake. It holds numbered items (`N. **P#** — why`) and nothing else; any other
line fails the check, so a note naming an ID can never queue it. The check also fails
if a queued ID is missing, terminal, or resting on an open assumption, or if it depends
(directly or through another entry) on an unshipped `P#` that isn't queued above it:
"dependency-ready" is a claim the queue makes, so it has to be true.

**Bugs never enter the queue** (P5, on the user's word, 2026-10-19). Every open,
dependency-ready `B#` is picked up *before* the queue's head, most severe first, so
ranking one against features would only hide it. `node scripts/next.mjs` gives the
answer to "what next" with bugs included; a `B#` line in QUEUE.md fails the check
(*mechanically enforced*).

**Ranking is computed, not judged** (user decision, 2026-10-16). `npm run queue`
([scripts/queue.mjs](../../scripts/queue.mjs), whose header holds the rule) writes the
queue, and /ship runs it on every refresh. Recorded order first, then computed: ready
entries in the owner's recorded order ([MANUAL-ORDER.md](MANUAL-ORDER.md), D-3) go
first, in that order, and the generator ranks the rest by what they unblock. The
recorded order is IDs only, and /ship writes it on the owner's word. An entry in it
that isn't ready stays out of the queue. The schema check fails a queue that isn't what
the generator writes, naming the IDs that differ (*mechanically enforced*). So a hand
reorder that breaks the ranking fails, and so do a ready entry left out and a note.
Two tied entries swapped by hand pass, because ties keep the file's order.

## Epics

The `epic:` values in use, and what each groups:

- **Product-owner interface** — what the person steering the loop sees and decides.
- **The checking machinery** — the suite's own tooling, the checks the skills orient
  off. Work here is not user-facing, but a silent failure in it is invisible
  everywhere else.
- **What the loop tracks** — the kinds of thing the registers hold, and where each one
  goes.
