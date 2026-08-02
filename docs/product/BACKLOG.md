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

1. **P1** — the first real entry. Replace this whole block as soon as you have two or
   three genuine candidates; a queue of one is a queue that will go stale unnoticed.
2. **P3** — the spike that unblocks P2.

Note what is *absent*: P2 is blocked on an open OD, so it is deliberately not queued
here despite being the higher-value item. The spike that unblocks it is queued instead.

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

### P2 — Second example, blocked on an assumption
- **Status:** proposed
- **Drafted:** 2026-08-01
- **Value:** demonstrates the split idiom — a feature whose delivery rests on something
  nobody has checked. The assumption lives in the register as OD-1; this half is the
  delivery.
- **Scope:** the batching behavior, once the real rate limit is known.
- **Depends on:** OD-1 — **open**, so this entry is *blocked-not-rejected*. It stays in
  the pool legitimately; what it may not do is enter `## Next up` or go `in-progress`
  until OD-1 resolves. If OD-1 is `refuted`, re-read this entry before building — a
  refutation can void an entry rather than unblock it.

### P3 — Third example, a spike
- **Status:** proposed
- **Drafted:** 2026-08-01
- **Value:** unblocks P2. A spike's deliverable is *the answer*, not a feature, so its
  Value names what it frees rather than inventing a user story for a probe.
- **Scope:** the smallest thing that settles the question — a throwaway client that
  hammers staging until it 429s, and the number written down. Explicitly out: any of
  the batching work itself, which is P2.
- **Resolves:** OD-1
- **Depends on:** —
- **Notes:** this exists because OD-1 is expensive to settle *and* P2 is near the head
  of the queue. An equally-open assumption blocking only some entry deep in the pool
  gets no spike — it's correctly parked. See `/triage`'s spike decision.
