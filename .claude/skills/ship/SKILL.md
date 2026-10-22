---
name: ship
description: The sole pen for the tracked docs — flip product-backlog statuses (claims and terminal), record decisions the user takes and assumption resolutions, tick the build plan, keep the architecture doc's *why* current, and append approved /triage drafts — minimally, without restating code. Runs on main, usually as /land's last step. Use for "mark X shipped", "we shipped Y, update docs", "add the approved draft to the backlog", "flip P# to in-progress", "resolve A-3", "we decided D-1", "/ship".
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
asserted. The scars behind these rules are in
[docs/LESSONS.md](../../../docs/LESSONS.md). Before committing any factual claim about
the code:

- **Verify it now, at the standard you'd demand of one you read.** A claim written
  today that's wrong on arrival is worse than one that rotted, because the next
  session has no reason to doubt it.
- **A tool's empty result is not evidence.** "grep found none" ≠ "there are none" — a
  proxied/misflagged/wrong-path search returns empty exactly like a true negative. Use
  `node scripts/grep-checked.mjs --control '<pattern you know matches>' '<pattern>' <paths>`
  rather than a bare grep: it searches in-process (so nothing can proxy it) and grades
  its own zero. **Exit 1 = a negative you may write down; exit 2 = the search never
  worked, so the result is not evidence.** Without `--control` it still verifies the
  files were readable, but labels the negative WEAK — don't promote a WEAK negative
  into a doc.
- **Never write an exhaustive inventory into prose** — "X and Y are the last remaining
  Z", "nothing else calls W". These rot on contact and nothing can hold them. Write
  the **consequence** ("this needs an exemption list"), not the inventory. If the
  inventory genuinely matters, it belongs in a check
  ([scripts/backlog-schema-check.mjs](../../../scripts/backlog-schema-check.mjs) is
  the idiom), never in a sentence.
- **Label the claim's strength** when it isn't self-evident — *mechanically enforced*
  (a check holds it), *verified* (checked this session; say how), or *asserted*
  (someone's belief). An asserted claim that reads as verified is how drift starts.

**Single-writer contract:** this skill is the sole writer of the backlog —
every entry file in [docs/backlog/](../../../docs/backlog/README.md), plus its
`QUEUE.md` and `README.md` — [docs/bugs/](../../../docs/bugs/README.md),
[docs/decisions/](../../../docs/decisions/README.md) (the user decides; this skill
records), [docs/BUILD_ORDER.md](../../../docs/BUILD_ORDER.md), and
[docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md). It writes **nothing else** — the
spec is human-owned (propose diffs, never edit).

[docs/assumptions/](../../../docs/assumptions/README.md) is the exception: it has **no
single pen** — an assumption gets settled by whoever hits it — and this skill is simply
the usual hand doing the writing. What's enforced there is the *shape*, by the schema
check, not the author.

**Edits land on main only.** Feature branches never carry edits to these files
(two parallel branches touching the queue conflict every time). So: the
`in-progress` claim is committed on main *before* branching — that's what makes it
visible to other sessions — and the terminal flip + queue refresh happen at land
time, with /ship running as **/land**'s last step after the merge passes tests. Only
work that never leaves main (docs-only, tiny fixes) gets its /ship pass directly.

*Main* in this skill is the **trunk**: the integration branch `node scripts/trunk.mjs`
names, which is `main` only when the clone has one. Get it from that command; never
write a branch name into a git command.

## Steps
1. **Identify what shipped** — from the user's description or git:
   `git log --oneline -5`, `git diff --stat` if unsure which files/areas changed.
2. **Map to the stale doc(s)** and apply the minimal edit:

| What shipped | Doc | Edit |
|---|---|---|
| Product feature / UX / UI | `docs/backlog/P#.md` | header `status: partial` + a note in the body on which milestone landed; or `status: shipped` plus `shipped: YYYY-MM-DD` — **only on the user's word** (below). |
| A bug fix landed | `docs/bugs/B#.md` | it stays `in-progress` (a bug has no milestones); `status: fixed` — **only on the user's word**, the same rule as `shipped` (below). A bug never enters `QUEUE.md`: every open bug is picked up before it (`scripts/next.mjs`). |
| The user rejected a landing | `docs/backlog/P#.md` / `docs/bugs/B#.md` | stays `in-progress`; append today's date to `rejected:` (add the key if absent) and a one-line note on what failed (below). |
| A spike landed (`resolves: A-n`) | `docs/assumptions/A-n.md` | write the assumption's `## Resolution` — what was found, how — add `resolved: YYYY-MM-DD` to its header, and flip its `status:` to `verified` / `refuted` / `moot`. The spike entry's own `shipped` flip follows the same rule as any other. |
| An assumption was misfiled (a choice, our own code's behavior, a quantity) | `docs/assumptions/A-n.md` | `status: moved`, add `resolved:` and `moved_to:` (its new home, filed first), and a one-line `## Resolution` saying why it moved. Repoint the `depends_on:` of every open entry that named it. |
| The user took a decision | `docs/decisions/D-n.md` | `status: decided`, add `decided: YYYY-MM-DD` and `leads_to:` (the `P#` that carries it, or `—`) to the header, and add `## Decided` (the choice), `## Why` and `## Reopen if`; drop `waiting_on:`. **Only on the user's word**, as with `shipped`: recording a choice they didn't make is the one edit here that invents product direction. |
| A decision was replaced | `docs/decisions/D-n.md` | the old one → `status: superseded` + `superseded_by: D-m`; the new choice is a fresh entry. |
| A build phase completed | [docs/BUILD_ORDER.md](../../../docs/BUILD_ORDER.md) | tick / delete the phase (it's disposable). |
| Structure/architecture changed | [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) | update the *why* **only** — not signatures (its code blocks are illustrative sketches; the source wins). |
| Rules / spec changed | *(human-only)* | **do not edit** the spec — it's human-owned and edit-guard blocks it. Propose the exact diff to the user, and flag that ARCHITECTURE needs its matching update once applied. |

3. **Sweep what a resolution unblocked.** If this pass wrote an assumption's Resolution
   or recorded a decision, name every entry whose `depends_on:` cites it — they just
   changed state and nothing else notices. A `verified` assumption unblocks them; a **`refuted`** one may have *voided* them,
   which is the case worth stopping over. Report the list; the deep pass is
   `/triage groom`.
4. **Verify:** relative links resolve; no stale `proposed`/`deferred`/`partial` left on
   an entry that's now fully shipped. Before writing an "X is still owed" clause into a
   terminal flip, check the obligation against the **diff that actually landed** —
   scope-listed follow-ups whose premise the build voided get dropped with a one-line
   why, not copied forward.
5. **Refresh the queue:** on any product status flip or intake, update
   `docs/backlog/QUEUE.md`. When a flip makes a queued entry terminal, edit the queue
   **before** the entry. The schema check runs after every edit, and the queue may
   leave out an open entry but may not list a terminal one, so the other order goes
   red between the two edits. Drop a now-terminal ID, promote the next
   dependency-ready entry, ≤5, `N. **P#** — one-line why`. **Rank it yourself**, by the
   rule in [docs/backlog/README.md](../../../docs/backlog/README.md#the-queue): most
   open entries unblocked through the `depends_on` graph first, ties in existing order.
   Report the ranking to the user; don't ask them for it. The file
   holds the queue and nothing else; notes about what's absent go nowhere. The schema
   check fails CI if the queue dangles, lists a terminal ID, or carries any other line.

## `shipped` is the user's flip

Every other edit here is bookkeeping; `shipped` is a verdict — *this is what I asked
for* — and only the product owner can give it, because `Accept:` is their definition
of done. A bug's `fixed` is the same verdict against its `Repro` and `Expected`, under
the same rule. So flip an entry to `shipped` only when **the user says so in this
conversation**, after seeing the per-criterion report ("mark P4 shipped", "yes, ship
it"). None of these is the user saying so: /land handing you a merged branch, a green
suite, every criterion observed, a commit message. Invoked from /land, or
with no such word, leave the entry `in-progress` and say it awaits acceptance. That
holds when the hand-off itself says "flip it to shipped": those are /land's words, not
the user's, and /land is never to ask for `shipped` — so report the request as a fault in
the hand-off and leave the entry as it is.

When they do say so, name any criterion that was **not observed** or **not exercised**
before writing the flip — they may be accepting a gap knowingly, and that's theirs to
do, but not unknowingly. The flip's one-line note records which criteria were accepted
on what.

When they **reject** it instead ("no, that's not it"), the entry stays `in-progress`
and you record the rejection: append today's date to `rejected:` in its header
(`rejected: 2026-10-20, 2026-10-21`; add the key if absent) and add a one-line note on
what failed, in one commit on main. Append, never replace: a second rejection the same
day must still change the value. That commit is what tells
`scripts/landing.mjs` the earlier landing no longer counts, so `next.mjs` and
`status.mjs` read the entry as being built again rather than awaiting acceptance.

## When the schema check goes red

Two legitimate causes, and one illegitimate response.

- **A malformed entry** → fix the entry. This is the common case.
- **A convention you're deliberately changing** → update the README that documents
  the format, `scripts/backlog-schema-check.mjs` (and `scripts/entries.mjs`, which
  reads the header), and any skill lookup that relies on it,
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
When /triage hands over an approved **product** draft, write it as a new
`docs/backlog/P#.md` (the next free number) in the shape
[docs/backlog/README.md](../../../docs/backlog/README.md) documents: a header with
`status: proposed`, the right `epic:`, and today's `drafted:` date; the body's
sections below it.

**Copy `Accept:` verbatim.** It is the one field in the shape whose author is the
product owner rather than an agent, and the loop closes by reporting against those exact
words — so tightening the wording, merging two criteria, or "clarifying" one is not an
improvement, it is quietly editing the definition of done. Same standing as the spec:
if a criterion looks wrong, say so and let the user rewrite it. The schema check holds
the count (2–4 bullets), never the meaning.

An approved **bug** draft becomes a new `docs/bugs/B#.md` (the next free number) with
`status: open`, its `severity:` and today's `reported:` date, in the shape
[docs/bugs/README.md](../../../docs/bugs/README.md) documents. **Copy `## Repro`
verbatim**, for the same reason as `Accept:`: the reporter's steps are the evidence,
and a tidied repro is one nobody actually ran. No `Value` — don't add one.

An approved **assumption** draft becomes a new `docs/assumptions/A-n.md` with `status: open` and
today's `raised:` date. An approved **decision** draft becomes a new
`docs/decisions/D-n.md` with `status: open`, today's `raised:` date and its
`waiting_on:` — or `decided`, if the user answered on the spot. No other changes —
/triage classifies and drafts; this skill is just the pen.

A drafted entry whose `depends_on:` names an open assumption or decision goes **into
the pool, not into the queue**. That's not a workaround — the queue means dependency-ready, and this
one isn't. The schema check enforces the distinction.

## Not this skill
- Merging a branch / testing the merged result → **/land** (this skill is its last
  step, not a replacement for it).
- Classifying/drafting a new idea → **/triage**.
- A rules/state change → propose the spec diff to the user (human-owned); update
  ARCHITECTURE's *why* yourself once the rule is settled.
