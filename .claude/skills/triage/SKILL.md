---
name: triage
description: Classify a raw idea (dev notes, conversation, anywhere) as a product feature, a bug, an assumption or a decision, and draft the entry — without writing any file. Also grooms the backlog (`/triage groom`) — re-checks blockers, sweeps resolved open assumptions, flags assumptions about to block the queue, acts on staleness. Use for "add this idea", "this is broken", "triage the dev notes", "where does this idea belong", "groom the backlog", "what's unblocked now", or /triage. Hands the draft to /ship to write.
---

# Triage — idea intake & classification

Turns raw ideas into correctly-classified, correctly-shaped drafts. This skill **writes
nothing** — the backlog, [docs/backlog/](../../../docs/backlog/README.md), has exactly one
writer (/ship), and triage stays write-less so that stays true. Output =
classification + draft + which skill should write it.

## Sources
- [docs/dev_notes/OPEN_IDEAS.md](../../../docs/dev_notes/OPEN_IDEAS.md) — the human's
  raw dump. **Read-only** (edit-guard enforces it) and explicitly not a source of
  truth: ideas in it may already be shipped, deferred, or dead. Always check the
  backlog and the bugs, assumptions and decisions registers (step 2's search) before drafting — don't
  re-propose what exists.
- Ideas raised in conversation, code review, or the fallout of a build.

## The classification test

Ask in this order, and stop at the first yes:

1. **Is it a yes/no fact about the outside world, settled by observation?** (A third
   party's behavior, a constant from a doc page, a limit nobody has hit, "users won't
   do Y".) → an **assumption** (`A-n`,
   [docs/assumptions/](../../../docs/assumptions/README.md)). The tell: the idea's real
   content is *"we're currently acting as if X is true"* about something largely
   outside our control. Nothing ships; there's a fact to establish. It needs a concrete
   `## How to verify` by observation. **Name the entries it blocks** — an assumption
   nobody depends on is trivia; an assumption with dependents is a gate.
2. **Is it a choice the product owner makes between real options?** → a **decision**
   (`D-n`, [docs/decisions/](../../../docs/decisions/README.md)). The tell: no
   observation settles it, because either answer could be true of the world — what's
   missing is someone choosing. A preference is a decision, not an assumption. It needs
   at least two named `## Options` and what it is `waiting_on:` (IDs it waits on, and/or
   `user`). If the user can answer on the spot, ask, and draft it decided. An open
   decision is never spiked: if it waits on the user, ask them; if it waits on a fact,
   that fact is an assumption and follows its own route.
3. **Is it a question answered from data — a quantity, a rate, "how often does X
   happen"?** That is a measurement, and it is **not** an assumption (no single
   observation settles a rate) or a decision (nobody chooses it). Its home is the
   research track, which **P13** builds and which does not exist yet. Say so to the
   user rather than filing it under 1 or 2; if a decision is waiting on the number,
   draft the decision and name the measurement in its `## Context`.
4. **Is it broken — something that works, or was meant to, seen not to?** → a
   **bug** (`B#`, [docs/bugs/](../../../docs/bugs/README.md)). The tell: someone
   *saw* it fail, and can say what they did and what happened. Draft with the shape the
   bugs README documents — a header (title / `status: open` / `severity` / `reported` /
   depends_on) and a body (`## Repro`, optionally `## Expected` / `## Notes`). Keep the
   reporter's repro steps **as they gave them**; don't tidy them into what you think
   happened. Ask for the severity (`critical` / `major` / `minor`) if they haven't said,
   and **don't write a `Value`** — "it should work" is the whole of a bug's value, and
   inventing a payoff line is the dressing-up this class exists to stop. A suspicion
   nobody has seen fail is not a bug: that's a test or a /verify run (below).
5. **Otherwise it's something to build** → a **product feature**. Draft with the
   product shape [docs/backlog/README.md](../../../docs/backlog/README.md) documents — a
   header (title / `status: proposed` / epic / drafted / depends_on) and a body (Value /
   Scope / **Accept**). Destination: a new `docs/backlog/P#.md` under the right epic,
   written by **/ship** (Intake).

**"Does our own code work?" is never an entry.** It's a feature's `Accept`, a test,
or a /verify run. Filing it as an assumption parks a question the suite could answer
today. Once someone has *seen* it not work, it's no longer a question: it's a bug (4).

**Split mixed ideas.** A feature resting on an unchecked assumption becomes an `A-n`
plus a product draft whose `depends_on:` names it. This pairing is the system's main
idiom — it's how a feature stops shipping on a premise nobody checked. A feature that
can't be built until a choice is made splits the same way, into a `D-n` and a feature
whose `depends_on:` names it.

## Drafting `Accept:` — what "right" means, before the build

Every open product entry carries **`Accept`**: 2–4 bullets, each one thing someone
could watch pass or fail. The schema check counts them, so a draft without them is not
filable.

These are the **product owner's** words, not a restatement of Scope. Scope says what
gets built; Accept says how you'd know it was built right — and the two come apart more
often than they look like they would. Ask for them in the user's terms and write down
what you're told; where the user hasn't said, propose criteria and let them correct you.
That correction is the whole point of the field.

A criterion is **observable** when you could hand it to someone with no knowledge of the
diff and they'd reach the same verdict. Two tests, both cheap:

- **Name the check, not the quality.** "the field is required" → *what would you run?*
  "an entry saved without it is rejected, and the message names the field."
- **Could it fail?** If no realistic build could miss it, it isn't a criterion. "it
  works", "the user is happy", "the code is clean" — none of these can come back false,
  which is why the count check exists.

The failure this field degrades into is **ceremony**: Value chopped into a bullet list,
present, counted, and worthless. When the honest answer is "the criteria are just
Scope restated", say so to the user and ask what they'd actually check — don't fill the
field to satisfy the checker.

A note on the boundary, because it's the one people get wrong: "we should find out
whether X" is usually an **assumption**, not a feature — when X is a yes/no fact about
the world. "How often does X happen" is a measurement (question 3), and "should we X"
is a decision. If you can't name a concrete check that would settle it (its `How to
verify`), you don't have an assumption either — you have a wish. Say so rather than
filing it.

**Blocked-not-rejected:** an idea that's a fine feature but rests on an open assumption
or decision is drafted *and* marked `depends_on: A-n` / `D-n`, not rejected. It sits in
the pool legitimately — the schema check permits that deliberately. What it forbids is
that entry appearing in the queue or going `in-progress` while that is open. Say this in the output, so
the user knows the entry exists and where it's allowed to sit.

## Steps
1. Restate the idea in one sentence; run the classification test out loud.
2. Check for an existing entry:
   ```
   node scripts/grep-checked.mjs -i --control '^status:' '<keyword>' \
     docs/backlog docs/bugs docs/assumptions docs/decisions
   ```
   If one exists, the output is "already tracked as `<ID>` — update it via its owner"
   — not a duplicate draft. Use the checked search rather than a bare grep: a false
   negative here creates a duplicate entry, and an empty result from a proxied or
   misdirected search looks exactly like a true negative (LESSONS
   [L1](../../../docs/LESSONS.md)). **Exit 2 means you learned nothing** — re-run
   before concluding the idea is new.
3. Draft the entry in the destination's template, including where it slots (epic for a
   feature; its severity for a bug; nothing to slot for an assumption or a decision —
   those registers aren't ordered).
4. Present draft + destination to the user; on approval, hand to **/ship** to write it.
   (An assumption draft also goes to /ship as the pen, though the register has no single
   writer — only an enforced shape. A decision's pen is /ship alone.)

## Groom mode (`/triage groom`, "groom the backlog")

The schema check *detects* rot and then waits for someone to care. This mode is the
someone. It reads, proposes, and writes nothing — same contract as the rest of the
skill. Run it periodically, and always after an assumption resolves or a decision is
taken.

1. **Re-check every blocked item's blocker.** For each entry with a `depends_on:`,
   resolve each ID's current status. A dependency that has gone terminal since the
   entry was drafted means this entry is **unblocked** — say so; that's the highest-
   value output of the pass, because nothing else notices.
2. **Sweep assumption resolutions.** For each assumption that flipped to `verified`/`refuted` since the
   last groom, list every entry naming it. A `refuted` assumption is the urgent case: entries
   resting on it are not merely unblocked, they may be **void or wrong**, and anything
   already shipped on that assumption needs a fresh look. **Decisions waiting on the
   user** are the user's own queue: list each open `D-n` whose `waiting_on:` includes
   `user`, with the entries it holds back. A decision taken unblocks its dependents the
   same way a verified assumption does.
3. **Spot the assumptions about to bite.** Cross-reference every `open` assumption against
   the queue (`docs/backlog/QUEUE.md`) and the entries just behind it. An assumption blocking something at the head of
   the queue is about to stop work; an assumption blocking only entries deep in the pool costs
   nothing yet. **This is the trigger for the spike decision below** — and nothing else
   in the loop looks for it, because the schema check only fires once the entry has
   *already* been queued or claimed.
4. **Act on staleness flags.** Run the schema check; for every entry it flags as
   drafted before a dependency landed, re-read the entry against the code and report
   one of: *still accurate* (bump `drafted:` — after a real re-read, never to quiet the
   check), *needs rescoping* (say how), or *void* (say why).
5. **Flag stale claims.** An entry `in-progress` with no branch and no recent commits
   is an abandoned claim — surface it; clearing it back to `proposed` is a /ship flip,
   on the user's word.
6. **Propose, never silently apply.** Demoting and deleting are the user's calls.
   Re-ranking isn't: the queue's ranking rule
   ([docs/backlog/README.md](../../../docs/backlog/README.md#the-queue)) decides it, so
   a groom that finds the queue out of order says so and hands the fix to /ship. For
   the rest, say what you'd change and why; let them decide. Priorities that events
   have overtaken are worth naming explicitly — that's usually why a groom was asked for.

Output is a short report: unblocked, newly-void, about-to-block, stale, and abandoned —
each with the one action it needs. Nothing is written until the user picks.

## The spike decision (when an assumption is about to block real work)

An assumption is a unit of **doubt**, not a unit of work. It has no owner by design: it gets
settled by whoever runs into it, at the moment it actually costs something. So the
question is never "who should verify this?" — it's **"is this assumption obstructing
the queue yet?"**

```
An open assumption blocks something
  ├─ cheap to settle (one API call, one probe, one grep)?
  │      → do it now; write its Resolution, then sweep what it unblocked
  ├─ expensive, and its dependents are in / entering the queue?
  │      → promote: draft a spike P# (below). It's obstructing real work now.
  └─ expensive, dependents only deep in the pool?
         → leave it open. It is correctly parked; nothing is blocked in practice,
           and spiking it now spends real effort on a hypothetical.
```

That middle branch is the only route to a spike, and the bound is deliberate: it stops
the register from becoming a generator of speculative work. An assumption is worth
paying to settle exactly when it's about to stop you.

**Spike draft shape** — an ordinary product entry, with two specifics:
- `## Value` names the entries it unblocks. That satisfies the required Value field
  honestly: unblocking queued work *is* user-facing value, one step removed. Don't
  invent a user story for a probe.
- `resolves: A-n` in the header — the back-pointer. This is a structured field rather than a
  sentence because an obligation buried in prose is unenforceable by construction
  (LESSONS [L2](../../../docs/LESSONS.md)); the schema check pairs the two and fails if
  the spike ships without the answer being written back.

Say plainly which branch you took and why — "A-3 is expensive but only P7 depends on
it, and P7 is nowhere near the queue, so it stays parked" is a complete and correct
groom output.

## Not this skill
- Writing the entry → **/ship** (Intake).
- Deciding *when* to build it → /ship ranks the queue by the rule in
  [docs/backlog/README.md](../../../docs/backlog/README.md#the-queue).
- Settling an assumption → whoever hits the block. If it needs building, it's a spike P# and
  goes through **/implement** like any other entry.
