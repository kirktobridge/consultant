# Product backlog

Curated pool of everything we intend to **build** — the shippable, user-facing side of
the project. Its sibling is [../OPEN_DECISIONS.md](../OPEN_DECISIONS.md), which holds
what we're currently *assuming*: this file is work, that file is doubt. An idea that's
really "we should find out whether X" belongs there, not here.

A backlog is a **prioritized pool, not a committed plan** — its dependency-ready head is
the [Next up](#next-up) block below (the authoritative "what's next to build"); the
shipped build history lives in [../BUILD_ORDER.md](../BUILD_ORDER.md).
[../dev_notes/OPEN_IDEAS.md](../dev_notes/OPEN_IDEAS.md) is the raw, unmaintained
developer dump; this file is the curated version. Rules → [../SPEC.md](../SPEC.md);
structure → [../ARCHITECTURE.md](../ARCHITECTURE.md).

Status vocab: `proposed` / `in-progress` (being built this session/branch) / `partial`
(some milestones shipped) / `shipped` / `deferred` / `abandoned`.

Every open entry carries **`Accept:`** — 2–4 sub-bullets, each one thing someone could
watch pass or fail. `Scope:` is what gets built; `Accept:` is how the product owner
would know it was built right, in their words. The schema check enforces the *count*
(so the field can't degrade into one unfalsifiable sentence), never the wording — /ship
copies it verbatim, and a criterion that looks wrong is the user's to rewrite.

An entry may sit here `proposed` while it `Depends on:` an **open** `OD-n` — that's how
a blocked idea gets filed rather than lost. It may **not** appear in `## Next up` or go
`in-progress` in that state; the schema check enforces the line.

**Written only by /ship**, on main only. See `.claude/GUIDE.md`.

---

## Next up

The **dependency-ready** head of the backlog, highest-payoff first — the authoritative
answer to "what to build next." Refreshed by /ship on status flips + intake. The schema
check fails CI if any ID here is missing, terminal, or resting on an open assumption:
"dependency-ready" is a claim this block makes, so it has to be true.

1. **P4** — acceptance criteria + the acceptance handshake. Highest payoff: it's the
   only entry that closes the loop back to the product owner.
2. **P5** — defects as a third intake class. Extends the same schema-check surface P4
   touches, so it goes second by preference rather than by dependency.
3. **P6** — split "merged" from "released". Independent of the other two; available to
   a parallel session at any time.
4. **P8** — a review step in the loop. Placement, not construction, so it's cheap; last
   because nothing else waits on it.

Note what is *absent*: P7 is the higher-payoff idea of the two remaining, and is
deliberately not queued — it depends on P4 and P6, so the queue would be claiming a
readiness it doesn't have. (Named in plain text on purpose: a **bolded** ID in this
block *is* the queue, as far as the schema check and every skill's grep are concerned.)

---

## Epic: Product-owner interface

<!-- Group entries under `## Epic:` headings that match how you think about the
     product. The schema check doesn't care about epic names — it cares that every
     `### <ID> — Title` heading is well-formed and every open entry carries its
     fields. -->

### P4 — Acceptance criteria, and the acceptance handshake
- **Status:** in-progress
- **Drafted:** 2026-08-03
- **Value:** you say what "right" means before the build, in your own words, and the
  loop closes by reporting against those words. Today it closes without you: the agent
  infers intent from its own diff, and /land flips `shipped` without you saying yes.
- **Scope:**
  - R0: an `**Accept:**` field in the entry shape — 2–4 observable checks. Required on
    open entries by `scripts/backlog-schema-check.mjs`; drafted by /triage; preserved
    verbatim by /ship's intake. Doc + checker + every skill grep move in one commit.
  - R1: /implement treats Accept as part of the contract alongside Scope; /verify drives
    *those criteria* rather than deriving the flow from `git diff`, and reports
    per-criterion observed / not-observed.
  - R2: the handshake — /land reports per criterion and stops short of the terminal
    flip; `shipped` becomes a flip the user authorizes.
  - Out: any criteria-authoring UI, and criteria for defects (that's P5).
- **Accept:**
  - An open entry with no `Accept:` is rejected by `npm run check:docs`, and the
    message names the field.
  - An `Accept:` that is one unfalsifiable sentence is rejected too — presence alone
    doesn't pass.
  - At close, /implement reports each criterion as observed or not-observed, rather
    than summarising the diff.
  - No entry reaches `shipped` without me saying so.
- **Depends on:** —
- **Notes:** shares the entry-shape/schema-check surface with **P5** — first claimant
  builds the checker change, the second extends it. One risk, held as *asserted*: a
  required field can degrade into ceremony (Value restated as a bullet list). Not filed
  as an OD deliberately — no check settles it before the field exists, and an OD
  settleable only post-build would park this entry outside `## Next up` permanently,
  inverting the register. R0 instead ships an eval case measuring whether the augmented
  /triage prose yields observable criteria.

### P5 — Defects as a third intake class
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** you report "this is broken" and it lands with repro and severity intact,
  instead of being dressed as a feature with an invented `Value:` line. Urgent breakage
  can jump the queue without corrupting what the queue means.
- **Scope:**
  - R0: a `D#` id class with its own shape (Status / Reported / Repro / Severity /
    Depends on; no `Value:` required). /triage's classification test gains a third
    branch — build it / assuming it / **it's broken**. Schema check learns the shape.
  - R1: queue semantics — severity above a bar bypasses `## Next up` ordering rather
    than being ranked into it; /implement accepts a `D#`, and its DEPENDS GATE still
    applies.
  - Out: anything resembling a bug tracker — no external sync, no duplicate detection.
- **Accept:**
  - Reporting "this is broken" produces a `D#` entry keeping my repro steps and a
    severity, with no invented `Value:` line.
  - A `D#` above the severity bar gets picked up next without being ranked into
    `## Next up`.
  - /implement accepts a `D#` id, and still refuses one blocked by an open OD.
- **Depends on:** —
- **Notes:** one shape decision to settle at build time — a distinct `D#` heading
  (recommended: greps stay separable, and `Value:`-not-required becomes enforceable by
  id class) versus `P#` with a `Kind:` field. Shares the schema-check surface with P4.

### P6 — Split "merged" from "released"
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** the backlog stops saying `shipped` about something no user can reach.
  Today `shipped` means merged; the event you actually care about — it's live — has no
  representation at all.
- **Scope:**
  - R0: status vocab gains `released` downstream of `shipped`, with both meanings
    stated here; checker and /ship's flip table updated in the same commit.
  - R1: a `/release` skill holding the project's real deploy procedure as a PORTING
    slot (the idiom is /verify's launch recipe), plus the version recorded on the entry.
  - Out: rollback automation, CI wiring, changelog generation.
- **Accept:**
  - An entry that is merged but not deployed reads `shipped`, and no entry reads
    `released` until it is actually reachable.
  - `/release` flips it to `released` and records which version went out.
  - A project with no deploy step passes the doc check with nothing ever `released`,
    and is never nagged about it.
- **Depends on:** —
- **Notes:** must degrade gracefully for projects with no deploy step — `released` stays
  an optional terminal state, never one the audit nags for, or the check loses
  credibility in exactly the projects that ported it fastest.

### P7 — A status view for the product owner
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** you can ask "where are we?" and get an answer without reading markdown —
  what landed, what's in flight and since when, what's blocked and on what. Today the
  only continuity artifact is HANDOFF, which is agent session-state, gitignored, and
  scoped per branch.
- **Scope:** a read-only `/status` that composes what already exists (backlog statuses,
  OD blocks, `npm run audit`, git) into a short report addressed to the product owner
  rather than to the next session. Out: any new tracked file — if it needs storage,
  it's the wrong design.
- **Accept:**
  - I can ask "where are we?" and get the answer without opening a markdown file.
  - It names what is in flight and how long it has been there.
  - It names what is blocked and which assumption is blocking it.
  - Running it leaves every tracked file unchanged.
- **Depends on:** P4, P6 — both unshipped, so this entry is *blocked-not-rejected*. It
  reports on acceptance state and released-vs-merged, neither of which exists yet; it
  stays in the pool legitimately and may not enter `## Next up` until they land.

### P8 — A review step in the loop
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** code quality gets a defined moment instead of falling through the gap
  between the suite's skills. /verify punts it to "a code-review skill", and the suite
  ships no such skill — so nothing reviews the diff today.
- **Scope:** wire the harness's existing `/code-review` (and `/security-review` where
  the diff warrants) into a named point between /implement step 4 and /land, with the
  rule for when it is skippable. Out: writing a reviewer — this is placement, not
  construction.
- **Accept:**
  - The loop has one named point where the diff gets reviewed, and /implement's
    close-out points at it.
  - The rule for skipping it names a condition I could check, not a judgement call.
- **Depends on:** —
