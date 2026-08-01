---
name: triage
description: Classify a raw idea (dev notes, conversation, anywhere) as a measurable experiment, a product feature, or an open decision, and draft the backlog entry — without writing any file. Also grooms the backlogs (`/triage groom`) — re-checks blockers, sweeps resolved open decisions, acts on staleness flags. Use for "add this idea", "triage the dev notes", "where does this idea belong", "groom the backlog", "what's unblocked now", or /triage. Hands the draft to /research (research backlog) or /ship (product backlog) to write.
---

# Triage — idea intake & classification

Turns raw ideas into correctly-classified, correctly-shaped backlog drafts. This skill
**writes nothing** — each backlog file has exactly one writer (/research for
`docs/research/`, /ship for `docs/product/BACKLOG.md`), and triage stays write-less so
that stays true. Output = classification + draft + which skill should write it.

## Sources
- [docs/dev_notes/OPEN_IDEAS.md](../../../docs/dev_notes/OPEN_IDEAS.md) — the human's
  raw dump. **Read-only** (edit-guard enforces it) and explicitly not a source of
  truth: ideas in it may already be shipped, deferred, or dead. Always check both
  backlogs (grep the headings) before drafting — don't re-propose what exists.
- Ideas raised in conversation, code review, or the fallout of a finding.

## The classification test

This single question routes everything downstream, so run it out loud:

> **Can this state a pre-registered success criterion — a metric plus a bar?**

- **Yes** (a rate vs a baseline, a throughput number, a latency ceiling, an accuracy
  target) → **measurable experiment**. Draft with FRAMEWORK.md's backlog template
  (Objective / Hypothesis / Method / Success criteria / Power / Cost / Log) with
  `Status: proposed`. Destination: the right `docs/research/backlog/*.md`, written by
  **/research** (Phase P).
- **No** — success is "usability", "feel", "it exists" → **product feature**. Draft
  with the product shape (Status / Value / Scope / Depends on / Drafted) with
  `Status: proposed`. Destination: the right epic in
  [docs/product/BACKLOG.md](../../../docs/product/BACKLOG.md), written by **/ship**
  (Intake).
- **Both** (a feature resting on an unproven signal) → **split it**: the measurable
  question becomes a research draft; the delivery becomes a product draft whose
  `Depends on:` names the research ID. This pairing is the system's main idiom — a
  feature that ships on an unvalidated assumption is how you get a shipped default
  nobody can defend.
- **Neither — it's an assumption, not a question or a feature** → an **open decision**
  (`OD-n`, [docs/OPEN_DECISIONS.md](../../../docs/OPEN_DECISIONS.md)). The tell: the
  idea's real content is *"we're currently assuming X"* about something outside our
  control — a third-party's behavior, a constant from a doc page, a limit nobody has
  hit. It isn't an experiment (there's no hypothesis to test, just a fact to look up)
  and it isn't a feature (nothing ships). Draft an OD entry, and name the entries it
  blocks — an OD nobody depends on is trivia; an OD with dependents is a gate.

**Blocked-not-rejected:** an idea that's a fine feature but rests on an open OD is
drafted *and* marked `Depends on: OD-n`, not rejected. The schema check and
/implement's DEPENDS GATE will hold it until the assumption is verified — which is the
point. Say so in the output, so the user knows the entry exists but won't be built yet.

**New-track check:** if a research draft opens a new domain or claim-type (it would
start a new `backlog/*.md`, or need a kind of measurement no existing harness
produces), ask: *what external reference validates this track?* If there's no answer,
**the anchor infrastructure becomes the first drafted entry** — not a footnote on this
one. Self-relative measurement drifts: a track can improve against its own past for
many runs and still be wrong in absolute terms, and only an outside readout catches
that. Don't let a new track repeat it.

**Scope check:** every research draft names the context it will run in — a `Scope:`
line (vocabulary in FRAMEWORK.md's `## Scope`; the schema check rejects an open entry
without one). A *constant* is presumed scope-bound until measured otherwise; a
*mechanism* is presumed portable but still says so. If the draft's validation corpus
is one configuration while the question is about another, that mismatch is the draft's
first problem, not a caveat — say which, in the entry.

## Steps
1. Restate the idea in one sentence; run the classification test out loud.
2. Check for an existing entry
   (`grep -in "<keyword>" docs/research/backlog/*.md docs/product/BACKLOG.md`).
   If one exists, the output is "already tracked as `<ID>` — update it via its owner"
   — not a duplicate draft. **Positive-control the grep** (see the write gate in
   /ship): an empty result from a proxied or misdirected search looks exactly like a
   true negative, and a false negative here creates a duplicate entry.
3. Draft the entry in the destination's template, including where it slots
   (payoff order for research; epic for product).
4. Present draft + destination to the user; on approval, hand to /research or /ship
   to write it. (An OD draft goes to whichever pen the user prefers — the decisions
   register has no single writer, only an enforced shape.)

## Groom mode (`/triage groom`, "groom the backlog")

The schema check *detects* rot and then waits for someone to care. This mode is the
someone. It reads, proposes, and writes nothing — same contract as the rest of the
skill. Run it periodically, and always after an OD resolves.

1. **Re-check every blocked item's blocker.** For each entry with `Depends on:`,
   resolve each ID's current status. A dependency that has gone terminal since the
   entry was drafted means this entry is **unblocked** — say so; that's the highest-
   value output of the pass, because nothing else notices.
2. **Sweep OD resolutions.** For each OD that flipped to `verified`/`refuted` since
   the last groom, list every entry naming it. A `refuted` OD is the urgent case:
   entries resting on it are not merely unblocked, they may be **void or wrong**, and
   anything already shipped on that assumption needs a fresh look.
3. **Act on staleness flags.** Run the schema check; for every entry it flags as
   drafted before a dependency landed, re-read the entry against the code and report
   one of: *still accurate* (bump `Drafted:` — after a real re-read, never to quiet
   the check), *needs rescoping* (say how), or *void* (say why).
4. **Flag stale claims.** An entry `in-progress` with no branch and no recent commits
   is an abandoned claim — surface it; /checkpoint clears it.
5. **Propose, never silently apply.** Re-ranking, demoting, and deleting are the
   user's calls. Say what you'd change and why; let them decide. Priorities that
   events have overtaken are worth naming explicitly — that's usually why a groom was
   asked for.

Output is a short report: unblocked, newly-void, stale, and abandoned — each with the
one action it needs. Nothing is written until the user picks.

## Not this skill
- Writing the entry → **/research** (Phase P) or **/ship** (Intake).
- Deciding *when* to build it → the backlogs are pools; sequencing is the user's call.
- Verifying an OD → whoever does the work; /research if it needs a measurement.
