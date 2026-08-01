# Product backlog

Curated pool of **product / feature** ideas we want to build — the shippable,
user-facing side of the project. Sibling to [../research/](../research/): research owns
*questions* (measurable, data-answered); this owns *features* (user value + UX
milestones). When a feature can't state a success bar without writing "N/A", it belongs
here, not in research.

A backlog is a **prioritized pool, not a committed plan** — its dependency-ready head is
the [Next up](#next-up) block below (the authoritative "what's next to build"); the
shipped build history lives in [../BUILD_ORDER.md](../BUILD_ORDER.md). Source pipeline
mirrors research: [../dev_notes/OPEN_IDEAS.md](../dev_notes/OPEN_IDEAS.md) is the raw,
unmaintained developer dump; this file is the curated version. Rules →
[../SPEC.md](../SPEC.md); structure → [../ARCHITECTURE.md](../ARCHITECTURE.md).

Status vocab: `proposed` / `in-progress` (being built this session/branch) / `partial`
(some milestones shipped) / `shipped` / `deferred` / `abandoned`. Product features
don't carry a hypothesis or a success bar — that's what distinguishes them from a
research entry.

**Written only by /ship**, on main only. See `.claude/GUIDE.md`.

---

## Next up

The dependency-ready head of the backlog, highest-payoff first — the authoritative
answer to "what to build next." Refreshed by /ship on status flips + intake; the schema
check fails CI if any ID here is missing or terminal.

1. **P1** — the first real entry. Replace this whole block as soon as you have two or
   three genuine candidates; a queue of one is a queue that will go stale unnoticed.

---

## Epic: Foundations

<!-- Group entries under `## Epic:` headings that match how you think about the
     product. The schema check doesn't care about epic names — it cares that every
     `### <ID> — Title` heading is well-formed and every open entry carries its
     fields. -->

### P1 — Example product entry (delete once you have real ones)
- **Status:** proposed
- **Drafted:** 2026-08-01
- **Value:** why a user is better off. One or two sentences, in user terms — not
  "refactor X" but "the thing a person can now do". If you can't write this line, the
  entry isn't ready.
- **Scope:** what's in, what's explicitly out. If the work is big, break it into
  milestones (R0/R1/R2) — /implement builds **one milestone per invocation**, so
  milestones are the unit of a session's work.
  - R0: the smallest shippable slice.
  - R1: the next one.
- **Depends on:** — (a `P#`, an `AE#`/`AD#`, or nothing. /implement's DEPENDS GATE
  reads this and refuses to build on an unshipped dependency.)
- **Notes:** anything a future reader needs that the code won't say.

### P2 — Second example, showing a research dependency
- **Status:** deferred
- **Drafted:** 2026-08-01
- **Value:** demonstrates the split idiom: a feature whose delivery is blocked on an
  unproven signal. The measurable half lives in the research backlog as AE1; this half
  is the delivery.
- **Scope:** the UI/UX for surfacing the signal, once the signal is validated.
- **Depends on:** AE1 (must close `won`; if it closes `no-win`, this entry is
  abandoned, not built).
