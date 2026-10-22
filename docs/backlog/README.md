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

An entry may sit here `proposed` while it depends on an **open** `A-n` or `D-n` — that's how a
blocked idea gets filed rather than lost. It may **not** appear in the queue or go
`in-progress` in that state; the schema check enforces the line.

A `P#` dependency blocks too, read through the whole graph: an entry may go
`in-progress` or `partial` only once every `P#` it depends on, directly or through
another entry, is `shipped` — `partial` and `in-progress` don't count as met, and a
`deferred` or `abandoned` dependency never will be. A dependency cycle fails outright.
All of this is *mechanically enforced* by the schema check.

## The queue

[QUEUE.md](QUEUE.md) is the **dependency-ready** head of the backlog, highest-payoff
first — the authoritative answer to "what to build next." Refreshed by /ship on status
flips + intake. It holds numbered items (`N. **P#** — why`) and nothing else; any other
line fails the check, so a note naming an ID can never queue it. The check also fails
if a queued ID is missing, terminal, or resting on an open assumption, or if it depends
(directly or through another entry) on an unshipped `P#` that isn't queued above it:
"dependency-ready" is a claim the queue makes, so it has to be true.

**Bugs never enter the queue** (P5, on the user's word, 2026-10-19). Every open,
dependency-ready `B#` is picked up *before* the queue's head, most severe first, so
ranking one against features would only hide it. `node scripts/next.mjs` gives the
answer to "what next" with bugs included; a `B#` line in QUEUE.md fails the check
(*mechanically enforced*).

**Ranking is the agent's job, not the user's** (user decision, 2026-10-16). /ship
ranks on every refresh by one rule: the dependency-ready entry that unblocks the most
open entries goes first, counted transitively through the `depends_on` graph. Ties keep
their existing order, so an entry already in the queue stays ahead of a newcomer. Each
item's *why* names what it unblocks. The user can still overrule any ranking, and an
overrule is recorded, not re-asserted (D-3): ready entries in the owner's recorded
order go first, in that order, and the rule above orders the rest. Until P24 lands,
the recorded order is the list in D-3's `## Decided`, and this ranking is *asserted*,
not checked; P24 generates it from the graph.

## Epics

The `epic:` values in use, and what each groups:

- **Product-owner interface** — what the person steering the loop sees and decides.
- **The checking machinery** — the suite's own tooling, the checks the skills orient
  off. Work here is not user-facing, but a silent failure in it is invisible
  everywhere else.
- **What the loop tracks** — the kinds of thing the registers hold, and where each one
  goes.
