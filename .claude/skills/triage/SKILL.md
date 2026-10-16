---
name: triage
description: Classify a raw idea (dev notes, conversation, anywhere) as a product feature or an open decision, and draft the backlog entry — without writing any file. Also grooms the backlog (`/triage groom`) — re-checks blockers, sweeps resolved open decisions, flags assumptions about to block the queue, acts on staleness. Use for "add this idea", "triage the dev notes", "where does this idea belong", "groom the backlog", "what's unblocked now", or /triage. Hands the draft to /ship to write.
---

# Triage — idea intake & classification

Turns raw ideas into correctly-classified, correctly-shaped drafts. This skill **writes
nothing** — [docs/product/BACKLOG.md](../../../docs/product/BACKLOG.md) has exactly one
writer (/ship), and triage stays write-less so that stays true. Output =
classification + draft + which skill should write it.

## Sources
- [docs/dev_notes/OPEN_IDEAS.md](../../../docs/dev_notes/OPEN_IDEAS.md) — the human's
  raw dump. **Read-only** (edit-guard enforces it) and explicitly not a source of
  truth: ideas in it may already be shipped, deferred, or dead. Always check the
  backlog and the decisions register (grep the headings) before drafting — don't
  re-propose what exists.
- Ideas raised in conversation, code review, or the fallout of a build.

## The classification test

One question routes everything:

> **Is this something we'd *build*, or something we're currently *assuming*?**

- **Something to build** → **product feature**. Draft with the product shape (Status /
  Drafted / Value / Scope / **Accept** / Depends on) with `Status: proposed`.
  Destination: the right epic in
  [docs/product/BACKLOG.md](../../../docs/product/BACKLOG.md), written by **/ship**
  (Intake).
- **Something we're assuming** → an **open decision** (`OD-n`,
  [docs/OPEN_DECISIONS.md](../../../docs/OPEN_DECISIONS.md)). The tell: the idea's real
  content is *"we're currently acting as if X is true"* about something largely outside
  our control — a third party's behavior, a constant from a doc page, a limit nobody
  has hit, "users won't do Y". Nothing ships; there's a fact to establish. Draft an OD,
  and **name the entries it blocks** — an OD nobody depends on is trivia; an OD with
  dependents is a gate.
- **Both** (a feature resting on an unchecked assumption) → **split it**: the
  assumption becomes an OD; the delivery becomes a product draft whose `Depends on:`
  names it. This pairing is the system's main idiom — it's how a feature stops shipping
  on a premise nobody checked.

## Drafting `Accept:` — what "right" means, before the build

Every open product entry carries **`Accept:`**: 2–4 sub-bullets, each one thing someone
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
whether X" is usually an **OD**, not a feature. If you can't name a concrete check that
would settle it (`How to verify:`), you don't have an OD either — you have a wish. Say
so rather than filing it.

**Blocked-not-rejected:** an idea that's a fine feature but rests on an open OD is
drafted *and* marked `Depends on: OD-n`, not rejected. It sits in the pool legitimately
— the schema check permits that deliberately. What it forbids is that entry appearing
in `## Next up` or going `in-progress` while the OD is open. Say this in the output, so
the user knows the entry exists and where it's allowed to sit.

## Steps
1. Restate the idea in one sentence; run the classification test out loud.
2. Check for an existing entry:
   ```
   node scripts/grep-checked.mjs -i --control 'Status:' '<keyword>' \
     docs/product/BACKLOG.md docs/OPEN_DECISIONS.md
   ```
   If one exists, the output is "already tracked as `<ID>` — update it via its owner"
   — not a duplicate draft. Use the checked search rather than a bare grep: a false
   negative here creates a duplicate entry, and an empty result from a proxied or
   misdirected search looks exactly like a true negative (LESSONS
   [L1](../../../docs/LESSONS.md)). **Exit 2 means you learned nothing** — re-run
   before concluding the idea is new.
3. Draft the entry in the destination's template, including where it slots (epic for a
   feature; nothing to slot for an OD — the register isn't ordered).
4. Present draft + destination to the user; on approval, hand to **/ship** to write it.
   (An OD draft also goes to /ship as the pen, though the register has no single
   writer — only an enforced shape.)

## Groom mode (`/triage groom`, "groom the backlog")

The schema check *detects* rot and then waits for someone to care. This mode is the
someone. It reads, proposes, and writes nothing — same contract as the rest of the
skill. Run it periodically, and always after an OD resolves.

1. **Re-check every blocked item's blocker.** For each entry with `Depends on:`,
   resolve each ID's current status. A dependency that has gone terminal since the
   entry was drafted means this entry is **unblocked** — say so; that's the highest-
   value output of the pass, because nothing else notices.
2. **Sweep OD resolutions.** For each OD that flipped to `verified`/`refuted` since the
   last groom, list every entry naming it. A `refuted` OD is the urgent case: entries
   resting on it are not merely unblocked, they may be **void or wrong**, and anything
   already shipped on that assumption needs a fresh look.
3. **Spot the assumptions about to bite.** Cross-reference every `open` OD against
   `## Next up` and the entries just behind it. An OD blocking something at the head of
   the queue is about to stop work; an OD blocking only entries deep in the pool costs
   nothing yet. **This is the trigger for the spike decision below** — and nothing else
   in the loop looks for it, because the schema check only fires once the entry has
   *already* been queued or claimed.
4. **Act on staleness flags.** Run the schema check; for every entry it flags as
   drafted before a dependency landed, re-read the entry against the code and report
   one of: *still accurate* (bump `Drafted:` — after a real re-read, never to quiet the
   check), *needs rescoping* (say how), or *void* (say why).
5. **Flag stale claims.** An entry `in-progress` with no branch and no recent commits
   is an abandoned claim — surface it; clearing it back to `proposed` is a /ship flip,
   on the user's word.
6. **Propose, never silently apply.** Re-ranking, demoting, and deleting are the user's
   calls. Say what you'd change and why; let them decide. Priorities that events have
   overtaken are worth naming explicitly — that's usually why a groom was asked for.

Output is a short report: unblocked, newly-void, about-to-block, stale, and abandoned —
each with the one action it needs. Nothing is written until the user picks.

## The spike decision (when an OD is about to block real work)

An OD is a unit of **doubt**, not a unit of work. It has no owner by design: it gets
settled by whoever runs into it, at the moment it actually costs something. So the
question is never "who should verify this?" — it's **"is this assumption obstructing
the queue yet?"**

```
An open OD blocks something
  ├─ cheap to settle (one API call, one probe, one grep)?
  │      → do it now; write **Resolution:**, then sweep what it unblocked
  ├─ expensive, and its dependents are in / entering `## Next up`?
  │      → promote: draft a spike P# (below). It's obstructing real work now.
  └─ expensive, dependents only deep in the pool?
         → leave it open. It is correctly parked; nothing is blocked in practice,
           and spiking it now spends real effort on a hypothetical.
```

That middle branch is the only route to a spike, and the bound is deliberate: it stops
the register from becoming a generator of speculative work. An assumption is worth
paying to settle exactly when it's about to stop you.

**Spike draft shape** — an ordinary product entry, with two specifics:
- `**Value:**` names the entries it unblocks. That satisfies the required Value field
  honestly: unblocking queued work *is* user-facing value, one step removed. Don't
  invent a user story for a probe.
- `**Resolves:** OD-n` — the back-pointer. This is a structured field rather than a
  sentence because an obligation buried in prose is unenforceable by construction
  (LESSONS [L2](../../../docs/LESSONS.md)); the schema check pairs the two and fails if
  the spike ships without the answer being written back.

Say plainly which branch you took and why — "OD-3 is expensive but only P7 depends on
it, and P7 is nowhere near the queue, so it stays parked" is a complete and correct
groom output.

## Not this skill
- Writing the entry → **/ship** (Intake).
- Deciding *when* to build it → the backlog is a pool; sequencing is the user's call.
- Settling an OD → whoever hits the block. If it needs building, it's a spike P# and
  goes through **/implement** like any other entry.
