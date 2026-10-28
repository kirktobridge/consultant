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

**The pen is `scripts/ship.mjs`** for a claim, a terminal flip, a rejection and
intake. Each command is one checked commit on main under the land lock: it edits the
entry, takes a terminal ID off `MANUAL-ORDER.md`, regenerates the queue, runs the
schema check, and commits, or puts every file back. A claim is
`node scripts/ship.mjs claim <ID> [R#] --trailer "<your commit attribution line>"`;
every command takes that `--trailer`. **Exit 0** → committed. **Exit 1** → refused:
report its message and never hand-edit around it. When it names a dependent it would
leave stale, re-read that entry against the code, bump its `drafted:` in its own
commit, then run the command again. **Exit 2** → it could not run: report it. What the
table below leaves as a hand edit stays one.

*Main* in this skill is the **trunk**: the integration branch `node scripts/trunk.mjs`
names, which is `main` only when the clone has one. Get it from that command; never
write a branch name into a git command.

## Steps
1. **Identify what shipped** — from the user's description or git:
   `git log --oneline -5`, `git diff --stat` if unsure which files/areas changed.
2. **Map to the stale doc(s)** and apply the minimal edit:

| What shipped | Doc | Edit |
|---|---|---|
| A milestone landed, more remain | `docs/backlog/P#.md` | by hand (no command yet): header `status: partial` + a note in the body on which milestone landed. |
| The user accepted a feature | `docs/backlog/P#.md` | `node scripts/ship.mjs shipped <P#> --owner "<their words>"` — **only on the user's word** (below). |
| A bug fix landed | `docs/bugs/B#.md` | it stays `in-progress` (a bug has no milestones) until `node scripts/ship.mjs fixed <B#> --owner "<their words>"`, or `--clears --branch <branch>` from /land (D-7, below). A bug never enters `QUEUE.md`: every open bug is picked up before it (`scripts/next.mjs`). |
| The user rejected a landing | `docs/backlog/P#.md` / `docs/bugs/B#.md` | `node scripts/ship.mjs reject <ID> --owner "<what failed>"`: it stays `in-progress` (below). |
| The user reopened a bug /land marked fixed | `docs/bugs/B#.md` | `node scripts/ship.mjs reject <B#> --owner "<what is still broken>"`: back to `in-progress`, as for a rejection (below). |
| A spike landed (`resolves: A-n`) | `docs/assumptions/A-n.md` | write the assumption's `## Resolution` — what was found, how — add `resolved: YYYY-MM-DD` to its header, and flip its `status:` to `verified` / `refuted` / `moot`. The spike entry's own `shipped` flip follows the same rule as any other. |
| An assumption was misfiled (a choice, our own code's behavior, a quantity) | `docs/assumptions/A-n.md` | `status: moved`, add `resolved:` and `moved_to:` (its new home, filed first), and a one-line `## Resolution` saying why it moved. Repoint the `depends_on:` of every open entry that named it. |
| The user took a decision | `docs/decisions/D-n.md` | `status: decided`, add `decided: YYYY-MM-DD` and `leads_to:` (the `P#` that carries it, or `—`) to the header, and add `## Decided` (the choice), `## Why` and `## Reopen if`; drop `waiting_on:`. **Only on the user's word**, as with `shipped`: recording a choice they didn't make is the one edit here that invents product direction. |
| A decision was replaced | `docs/decisions/D-n.md` | the old one → `status: superseded` + `superseded_by: D-m`; the new choice is a fresh entry. |
| A build phase completed | [docs/BUILD_ORDER.md](../../../docs/BUILD_ORDER.md) | tick / delete the phase (it's disposable). |
| Structure/architecture changed | [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) | update the *why* **only** — not signatures (its code blocks are illustrative sketches; the source wins). |
| Rules / spec changed | *(human-only)* | **do not edit** the spec — it's human-owned and edit-guard blocks it. Propose the exact diff to the user, and flag that ARCHITECTURE needs its matching update once applied. |

3. **Sweep what a resolution unblocked.** If this pass wrote an assumption's Resolution
   or recorded a decision, run `node scripts/groom.mjs --for <A-n|D-n>` after the
   commit. It names every entry, feature or bug, whose `depends_on:` cites it. They
   just changed state and nothing else notices. A `verified` assumption unblocks them; a **`refuted`** one may have *voided* them,
   which is the case worth stopping over. A superseded decision unblocks nothing: its
   dependents re-point to `superseded_by:`. Report its list and its advice. Exit 2 means
   it never ran, which is not an empty list. The deep pass is `/triage groom`.
4. **Verify:** relative links resolve; no stale `proposed`/`deferred`/`partial` left on
   an entry that's now fully shipped. Before writing an "X is still owed" clause into a
   terminal flip, check the obligation against the **diff that actually landed** —
   scope-listed follow-ups whose premise the build voided get dropped with a one-line
   why, not copied forward.
5. **Refresh the queue:** a ship.mjs command does this step itself. After a hand edit
   that flips a product status, run `npm run queue`,
   and commit what it writes in the same commit as the flip. It rewrites
   `docs/backlog/QUEUE.md` by the rule in
   [docs/backlog/README.md](../../../docs/backlog/README.md#the-queue) and names each
   entry in the recorded order that it skipped, with what holds it. Never edit the
   queue by hand. The schema check fails any queue that isn't what the generator
   writes, so it stays red between the flip and the run. When a flip makes an entry
   terminal, also take it off `docs/backlog/MANUAL-ORDER.md` if it is listed there.
   Beyond that, the recorded order changes only on the user's word. Report the new
   queue to the user.

## `shipped` is the user's flip

Every other edit here is bookkeeping; `shipped` is a verdict — *this is what I asked
for* — and only the product owner can give it, because `Accept:` is their definition
of done. So flip an entry to `shipped` only when **the user says so in this
conversation**, after seeing the per-criterion report ("mark P4 shipped", "yes, ship
it"). None of these is the user saying so: /land handing you a merged branch, a green
suite, every criterion observed, a commit message. Invoked from /land, or
with no such word, leave the entry `in-progress` and say it awaits acceptance. That
holds when the hand-off itself says "flip it to shipped": those are /land's words, not
the user's, and /land is never to ask for `shipped` — so report the request as a fault in
the hand-off and leave the entry as it is.

When they do say so, name any criterion that was **not observed** or **not exercised**
before writing the flip — they may be accepting a gap knowingly, and that's theirs to
do, but not unknowingly. Then run `ship.mjs shipped <P#> --owner "<their words>"`:
the `--owner` note is the flip's one-line record of which criteria were accepted on
what, so put their words in it. The script refuses the flip without it.

When they **reject** it instead ("no, that's not it"), the entry stays `in-progress`
and you record the rejection with `ship.mjs reject <ID> --owner "<what failed>"`. It
appends today to the entry's `rejected:`; that commit is what tells
`scripts/landing.mjs` the earlier landing no longer counts, so `next.mjs` and
`status.mjs` read the entry as being built again rather than awaiting acceptance.

## A bug's `fixed`: the user's word, or a report that clears it (D-7)

A bug's contract is its `Repro` and `Expected`, which a report settles without
judgment, so the user decided (D-7) that their word is not the only way to `fixed`.
/land may hand you the flip, and it is written only when **code** says the report
clears the bug, never on /land's say-so: run `node scripts/ship.mjs fixed <B#>
--clears --branch <branch>`, before /land's `finish` removes the branch. It runs
`close-report.mjs --clears` itself and flips only when that exits 0. Refused → the bug
stays `in-progress`, awaiting the user; report /land's request as a fault in the
hand-off. A feature never takes this path: `shipped` stays the user's.

On the user's word, `fixed` follows the `shipped` rule above (`fixed <B#> --owner
"<their words>"`). When they say a bug /land marked fixed is not fixed, reopen it with
`ship.mjs reject <B#> --owner "<what is still broken>"`. That is D-7's reopen
condition, so tell them it was met.

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
When /triage hands over an approved draft, file it with
`node scripts/ship.mjs file <P|B|A|D> --owner "<their approval>" --from <draft>`, one
draft per call. The draft is a scratch file outside the checkout (the script refuses
one git can see): a `---` header with the keys its drafter chose (the register's
`drafts` in `scripts/entries.mjs`; the script names any other), then its sections. The script takes the next free ID,
writes `id:`, the opening status and today's date, and copies the body as it stands.
A draft that names another new entry waits for that one's real ID. An experiment is
/research's.

**Copy `Accept:` verbatim** into the draft file. It is the one field in the shape whose author is the
product owner rather than an agent, and the loop closes by reporting against those exact
words — so tightening the wording, merging two criteria, or "clarifying" one is not an
improvement, it is quietly editing the definition of done. Same standing as the spec:
if a criterion looks wrong, say so and let the user rewrite it. The schema check holds
the count (2–4 bullets), never the meaning.

A **bug** draft's shape is in
[docs/bugs/README.md](../../../docs/bugs/README.md). **Copy `## Repro`
verbatim**, for the same reason as `Accept:`: the reporter's steps are the evidence,
and a tidied repro is one nobody actually ran. No `Value` — don't add one.

If the user answered a **decision** on the spot, file its draft open, then record the
decision (the table's decision row). No other changes —
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
