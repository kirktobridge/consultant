---
name: ship
description: The sole pen for the product docs — flip product-backlog statuses (claims and terminal), tick the build plan, keep the architecture doc's *why* current, and append approved /triage drafts — minimally, without restating code. Runs on main, usually as /land's last step. Use for "mark X shipped", "we shipped Y, update docs", "add the approved draft to the backlog", "flip P# to in-progress", "/ship". Product-side complement to /research (which handles experiments).
---

# Ship — the pen for the product docs

This skill is the pen for the product docs: every edit to them — shipped flips,
`in-progress` claims, intake appends — goes through here, whatever the occasion.
Lightweight: keep the docs honest with the **minimum** edits — usually a status flip +
a one-line note. This is not a rewrite pass.

Project doc discipline governs: **code + tests own the *what*; docs keep the *why*.**
Don't restate signatures or duplicate what the code already says.

## Write gate (the premise gate, pointed outward)

/implement verifies claims it **reads**. This skill is a *pen*, so it owes the same
standard to claims it **writes** — single-writer settles who edits, not what may be
asserted. Before committing any factual claim about the code:

- **Verify it now, at the standard you'd demand of one you read.** A claim written
  today that's wrong on arrival is worse than one that rotted, because the next
  session has no reason to doubt it.
- **A tool's empty result is not evidence.** "grep found none" ≠ "there are none" — a
  proxied/misflagged/wrong-path search returns empty exactly like a true negative.
  Before writing a negative you can't otherwise support, run a **positive control**:
  the same tool against a pattern you *know* matches. If the control comes back empty,
  your tooling lied, not the repo.
- **Never write an exhaustive inventory into prose** — "X and Y are the last remaining
  Z", "nothing else calls W". These rot on contact and nothing can hold them. Write
  the **consequence** ("this needs an exemption list"), not the inventory. If the
  inventory genuinely matters, it belongs in a check
  ([scripts/backlog-schema-check.mjs](../../../scripts/backlog-schema-check.mjs) is
  the idiom), never in a sentence.
- **Label the claim's strength** when it isn't self-evident — *mechanically enforced*
  (a check holds it), *verified* (checked this session; say how), or *asserted*
  (someone's belief). An asserted claim that reads as verified is how drift starts.

**Single-writer contract:** this skill is the sole writer of
[docs/product/BACKLOG.md](../../../docs/product/BACKLOG.md),
[docs/BUILD_ORDER.md](../../../docs/BUILD_ORDER.md), and
[docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md). It writes **nothing else** —
`docs/research/**` belongs to /research; the spec is human-owned (propose diffs, never
edit).

**Edits land on main only.** Feature branches never carry edits to these three files
(two parallel branches touching `## Next up` conflict every time). So: the
`in-progress` claim is committed on main *before* branching — that's what makes it
visible to other sessions — and the terminal flip + Next up refresh happen at land
time, with /ship running as **/land**'s last step after the merge passes tests. Only
work that never leaves main (docs-only, tiny fixes) gets its /ship pass directly.

## Steps
1. **Identify what shipped** — from the user's description or git:
   `git log --oneline -5`, `git diff --stat` if unsure which files/areas changed.
2. **Map to the stale doc(s)** and apply the minimal edit:

| What shipped | Doc | Edit |
|---|---|---|
| Product feature / UX / UI | [docs/product/BACKLOG.md](../../../docs/product/BACKLOG.md) | flip entry `Status:` → `shipped`, or `partial` + note which milestone landed. |
| A deployed research finding | *(not yours)* | **don't edit `docs/research/`** — that's /research's file. Check its `AE#`/`AD#` is closed (`Status` terminal + `Log:` linked); if not, run **/research** to close it. Here, just cross-link the product entry to the `AE#`/`F#`. |
| A build phase completed | [docs/BUILD_ORDER.md](../../../docs/BUILD_ORDER.md) | tick / delete the phase (it's disposable). |
| Structure/architecture changed | [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) | update the *why* **only** — not signatures (its code blocks are illustrative sketches; the source wins). |
| Rules / spec changed | *(human-only)* | **do not edit** the spec — it's human-owned and edit-guard blocks it. Propose the exact diff to the user, and flag that ARCHITECTURE needs its matching update once applied. |

3. **Cross-link** if the shipped item had a research question or dependency.
4. **Verify:** relative links resolve; no stale `proposed`/`deferred`/`partial` left on
   an entry that's now fully shipped. Before writing an "X is still owed" clause into a
   terminal flip, check the obligation against the **diff that actually landed** —
   scope-listed follow-ups whose premise the build voided get dropped with a one-line
   why, not copied forward.
5. **Refresh `## Next up`:** on any product status flip or intake, update the
   `## Next up` block at the top of BACKLOG.md — drop a now-terminal ID, promote the
   next dependency-ready entry (payoff-ranked, ≤5, one-line why). The schema check
   fails CI if the queue dangles or lists a terminal ID.

## When the schema check goes red

Two legitimate causes, and one illegitimate response.

- **A malformed entry** → fix the entry. This is the common case.
- **A convention you're deliberately changing** → update the doc that documents the
  format, `scripts/backlog-schema-check.mjs`, and any skill grep that relies on it,
  **in the same commit**. Schema, enforcement, and docs stay in lockstep or they drift
  apart within a session.
- **Never loosen the check to make a red entry pass.** That inverts the tool: the thing
  that catches drift becomes the thing that ratifies it, and every future reader
  inherits the malformed row as precedent.

## Keep it lightweight (refuse to over-document)
- A status flip + one-line note is usually the whole job. Prefer editing an existing
  line over adding a section.
- If the only *accurate* doc change would be "the code now does X" — **stop.** Code +
  tests own that. No doc edit needed.
- Don't document a feature the spec / architecture docs already cover generically.

## Intake (from /triage)
When /triage hands over an approved **product** draft, append it to
[docs/product/BACKLOG.md](../../../docs/product/BACKLOG.md) under the right epic with
`Status: proposed` and today's `Drafted:` date. No other changes — /triage classifies
and drafts; this skill is just the pen for the product backlog.

## Not this skill
- Merging a branch / testing the merged result → **/land** (this skill is its last
  step, not a replacement for it).
- Running, recording, or **closing** an experiment → **/research** (sole writer of
  `docs/research/`).
- Classifying/drafting a new idea → **/triage**.
- Session wrap-up, commits, handoff → **/checkpoint**.
- A rules/state change → propose the spec diff to the user (human-owned); update
  ARCHITECTURE's *why* yourself once the rule is settled.
