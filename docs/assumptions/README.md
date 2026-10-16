# Assumptions

The register of **load-bearing assumptions** — yes/no facts about the outside world
that the project's correctness depends on, settled by observation, that nobody has
actually verified. One file per entry (`A-n.md`) in this directory.

*Provenance:* until 2026-10-16 this was `docs/decisions/`, "Open Decisions", with IDs
`OD-n`. Numbers were kept (OD-9 is A-9), so an `OD-n` in older commits, older
entries' prose, or a code comment means `A-n`.

Not features — those are [../backlog/](../backlog/README.md). An **assumption** is
something you are currently *assuming* and would have to change code over if the
assumption is wrong: a third-party API's real behavior, a constant taken from a blog
post, a limit nobody has hit yet, "users won't do X".

**An assumption is a unit of doubt, not a unit of work.** Everything else tracked here is
something you'd do; this is something you're standing on without having looked down.
That's why the register has no owner and no priority order — see *Who settles one*
below.

**Why this register exists.** Claim discipline (CLAUDE.md) grades a claim as *mechanically
enforced*, *verified*, or *asserted* — but grades it **one sentence at a time, at
write time**. Nothing indexes the asserted ones. So a project accumulates assumptions
it can't enumerate, and the first time anyone notices is when one turns out false and
takes three features with it. This register is that index: the standing list of what
we're standing on.

**Written by:** /triage drafts, /ship usually holds the pen, but unlike the backlog this
register has **no single writer** — an assumption is settled by whoever hits it. What's enforced is
the *shape*, by the schema check.

---

## The rule that makes it worth maintaining

> **Never build on an unverified figure.**

Work built on a false assumption isn't just wasted, it's *misleading*: it ships, looks
fine, and stays that way until the assumption is finally tested — taking everything
downstream with it.

But "blocked" is graded by how close the work actually is, because a blanket block on
anything touching an open assumption would make filing a blocked idea impossible:

| Where the dependent sits | Effect |
|---|---|
| `proposed`, parked in the pool | **allowed.** This is how you file a blocked idea — /triage calls it *blocked-not-rejected*. |
| listed in the queue ([../backlog/QUEUE.md](../backlog/QUEUE.md)) | **blocked.** The queue means dependency-ready; this entry isn't. |
| `in-progress` / `partial` | **blocked.** Someone is building on it right now. |

The lower two fail the schema check, and /implement's DEPENDS GATE refuses to pick up
any of the three — by the time you're building, parked is no longer where you are.

The counterpart obligation: **when an assumption resolves, sweep the blocked work.** A resolved
assumption usually unblocks several entries, and nothing else will notice. /ship does the
immediate sweep at resolution time; /triage's groom mode and the session-start audit catch the rest.

---

## Who settles one

Nobody, by standing assignment. The register is deliberately ownerless: an assumption
gets checked by whoever runs into it, at the moment it actually costs something. The
value here doesn't depend on anyone working through the list — **enumeration** (you can
count what you're standing on) and the **refuted record** (how often we're wrong)
both pay off even if nothing is ever verified. Only the block creates pressure, and it
applies that pressure exactly when it matters.

So when an assumption does block something, the exit depends on cost and on proximity to the
queue:

```
An open assumption blocks something
  ├─ cheap to settle?          → do it now; write its Resolution, sweep the dependents
  ├─ expensive, dependents at
  │  or near the queue         → promote to a spike P# (below)
  └─ expensive, dependents
     deep in the pool          → leave it open. Correctly parked; nothing is
                                 blocked in practice yet.
```

### Spikes

A **spike** is a product entry whose deliverable is *the answer*, not a feature. It
carries `resolves: A-n` in its header, and its `## Value` names the entries it unblocks —
which is honest value, one step removed. It's built through /implement like anything
else.

The back-pointer is a structured field rather than a sentence on purpose: an obligation
buried in prose is unenforceable by construction (LESSONS [L2](../LESSONS.md)). The schema
check pairs the two and fails if the spike ships while the assumption is still `open` —
the answer landing in code but never in the register is the specific way this goes
wrong.

Only the middle branch produces a spike. That bound is what stops the register from
becoming a generator of speculative work: an assumption is worth paying to settle
exactly when it's about to stop you.

---

## Status vocab

Status vocab: `open` / `verified` / `refuted` / `moot` / `moved`.

| status | meaning |
|--------|---------|
| `open` | still an assumption; blocks anything that depends on it |
| `verified` | checked against reality; the assumption held. Record **how**. |
| `refuted` | checked; the assumption was **wrong**. Record what it actually is, and what that broke. |
| `moot` | the question stopped mattering (design changed, feature dropped) |
| `moved` | not an assumption after all; `moved_to:` names its new home |

`refuted` is the valuable one. Never quietly rewrite a refuted assumption into a verified one
describing the new truth — the record that we believed something false, and for how
long, is what calibrates how much to trust the *rest* of this list.

`moved` is for a misfiled entry: a choice (now a decision), whether our own code works
(now a feature's `Accept`, a test or a /verify run), or a quantity to measure. Don't
delete it: older commits and entries cite its ID, so it stays as a stub whose
`moved_to:` points at the new home. The schema check holds that the home exists, and
fails any open entry still depending on the moved ID.

---

## Entry template

```markdown
---
id: A-1
title: <the question, as a question>
status: open
raised: YYYY-MM-DD
---

## Assumption

what we are currently acting as if is true.

## Why it matters

what breaks if it's false — name the entries or code that rest on it.

## How to verify

the concrete check that would settle it. If you can't name one, you don't have an
assumption — you have a wish. Say so rather than filing it.
```

The header is strict, as in the backlog: every line is a known `key: value`. The keys
are `id` (must match the file name), `title`, `status`, `raised`, `resolved` (the
`YYYY-MM-DD` it closed), and `spiked_as` (the `P#` settling it, so the pairing is
readable from this side too; the schema check reads the spike's `resolves:` half), and
`moved_to` (the new home of a `moved` entry).
Required sections: `Assumption` always; `Why it matters` and `How to verify` while
open. On close, add `resolved:` and a `## Resolution` section — what was found, how,
and what it broke.
