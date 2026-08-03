# Open Decisions

The register of **load-bearing assumptions** — facts the project's correctness depends
on that nobody has actually verified.

Not features — those are [product/BACKLOG.md](product/BACKLOG.md). An **OD** is
something you are currently *assuming* and would have to change code over if the
assumption is wrong: a third-party API's real behavior, a constant taken from a blog
post, a limit nobody has hit yet, "users won't do X".

**An OD is a unit of doubt, not a unit of work.** Everything else tracked here is
something you'd do; this is something you're standing on without having looked down.
That's why the register has no owner and no priority order — see *Who settles one*
below.

**Why this file exists.** Claim discipline (CLAUDE.md) grades a claim as *mechanically
enforced*, *verified*, or *asserted* — but grades it **one sentence at a time, at
write time**. Nothing indexes the asserted ones. So a project accumulates assumptions
it can't enumerate, and the first time anyone notices is when one turns out false and
takes three features with it. This register is that index: the standing list of what
we're standing on.

**Written by:** /triage drafts, /ship usually holds the pen, but unlike the backlog this
file has **no single writer** — an OD is settled by whoever hits it. What's enforced is
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
| listed in `## Next up` | **blocked.** The queue means dependency-ready; this entry isn't. |
| `in-progress` / `partial` | **blocked.** Someone is building on it right now. |

The lower two fail the schema check, and /implement's DEPENDS GATE refuses to pick up
any of the three — by the time you're building, parked is no longer where you are.

The counterpart obligation: **when an OD resolves, sweep the blocked work.** A resolved
OD usually unblocks several entries, and nothing else will notice. /ship does the
immediate sweep at resolution time; /triage's groom mode and /checkpoint catch the rest.

---

## Who settles one

Nobody, by standing assignment. The register is deliberately ownerless: an assumption
gets checked by whoever runs into it, at the moment it actually costs something. The
value here doesn't depend on anyone working through the list — **enumeration** (you can
count what you're standing on) and the **refuted record** (how often we're wrong)
both pay off even if nothing is ever verified. Only the block creates pressure, and it
applies that pressure exactly when it matters.

So when an OD does block something, the exit depends on cost and on proximity to the
queue:

```
An open OD blocks something
  ├─ cheap to settle?          → do it now; write Resolution:, sweep the dependents
  ├─ expensive, dependents at
  │  or near `## Next up`      → promote to a spike P# (below)
  └─ expensive, dependents
     deep in the pool          → leave it open. Correctly parked; nothing is
                                 blocked in practice yet.
```

### Spikes

A **spike** is a product entry whose deliverable is *the answer*, not a feature. It
carries `**Resolves:** OD-n`, and its `**Value:**` names the entries it unblocks —
which is honest value, one step removed. It's built through /implement like anything
else.

The back-pointer is a structured field rather than a sentence on purpose: an obligation
buried in prose is unenforceable by construction (LESSONS [L2](LESSONS.md)). The schema
check pairs the two and fails if the spike ships while the assumption is still `open` —
the answer landing in code but never in the register is the specific way this goes
wrong.

Only the middle branch produces a spike. That bound is what stops the register from
becoming a generator of speculative work: an assumption is worth paying to settle
exactly when it's about to stop you.

---

## Status vocab

Status vocab: `open` / `verified` / `refuted` / `moot`.

| status | meaning |
|--------|---------|
| `open` | still an assumption; blocks anything that depends on it |
| `verified` | checked against reality; the assumption held. Record **how**. |
| `refuted` | checked; the assumption was **wrong**. Record what it actually is, and what that broke. |
| `moot` | the question stopped mattering (design changed, feature dropped) |

`refuted` is the valuable one. Never quietly rewrite a refuted OD into a verified one
describing the new truth — the record that we believed something false, and for how
long, is what calibrates how much to trust the *rest* of this list.

---

## Entry template

```markdown
### OD-1 — <the question, as a question>
- **Status:** open
- **Raised:** YYYY-MM-DD
- **Assumption:** what we are currently acting as if is true.
- **Why it matters:** what breaks if it's false — name the entries or code that rest on it.
- **How to verify:** the concrete check that would settle it. If you can't name one,
  you don't have an OD — you have a wish. Say so rather than filing it.
- **Resolution:** — (on close: what was found, how, and the date)
```

An OD being settled by a spike also gains a `- **Spiked as:** P9` line, so the pairing
is readable from this side too. The schema check reads the `Resolves:` half.

---

## Register

### OD-1 — Example open decision (delete once you have real ones)
- **Status:** open
- **Raised:** 2026-08-01
- **Assumption:** the third-party rate limit is 100 req/min, per a doc page that
  doesn't say when it was last updated.
- **Why it matters:** the batching design in P2 is sized to it. If the real limit is
  lower we get throttled in production; if much higher we over-engineered.
- **How to verify:** run the client against staging until it 429s, record the actual
  ceiling and the reset window.
- **Spiked as:** P3 — expensive to settle, and P2 is near the head of the queue, so it
  earned a spike rather than staying parked.
- **Resolution:** —

### OD-3 — Does Claude Code anchor hook matchers against the tool name?
- **Status:** open
- **Raised:** 2026-08-02
- **Assumption:** a hook `matcher` is matched **unanchored** — i.e. the matcher `Edit`
  would also fire for `MultiEdit`, because the tool name contains it. We do not know
  this; the docs we have say only that matchers are regexes.
- **Why it matters:** `scripts/verify-guards.mjs` decides whether a guard still covers
  every write tool. It currently takes the **conservative** reading and requires
  anchored coverage, so a matcher of `Edit` is reported as *not* covering `MultiEdit`.
  If the harness really is unanchored we are merely strict — we demand
  `Edit|Write|MultiEdit` be spelled out, which is clearer anyway. If we had assumed
  unanchored and the harness anchors, a narrowed matcher would leave `MultiEdit`
  genuinely unguarded while the check reported *armed*. Only one of those two errors is
  recoverable, which is why the assumption is written down rather than picked.
- **How to verify:** set a throwaway PreToolUse hook with matcher `Edit` that logs the
  tool name, then trigger a `MultiEdit` and read the log.
- **Resolution:** —

### OD-4 — Does a subagent reading a SKILL.md answer like a session that was given it?
- **Status:** open
- **Raised:** 2026-08-02
- **Assumption:** a subagent handed `SKILL.md` as **user-turn text** makes the same
  decisions as a real session, where the harness injects the skill as *instructions*.
  The eval's numbers are only about the skills if this holds.
- **Why it matters:** every rate `evals/` reports rests on it. If a pasted skill is
  followed *less* faithfully than an injected one, the eval under-reports and we would
  edit prose that was never the problem; if *more* faithfully, it over-reports and a
  real gate failure stays invisible. Both errors point at the prompt, which is why
  neither shows up as a suspicious result.
- **How to verify:** take one case with a sharp expected answer
  (`depends-gate-refuses-blocked-entry`), run N reps through the emitted prompt, then
  run the same repo state in a session where the skill is actually invoked, and compare
  the two rates. A gap wider than the noise floor at that N settles it.
- **Resolution:** —

### OD-2 — Example resolved decision, showing a refutation
- **Status:** refuted
- **Raised:** 2026-08-01
- **Assumption:** timestamps from the upstream feed are UTC.
- **Why it matters:** every stored record's ordering depends on it.
- **How to verify:** compare a known event's feed timestamp against wall clock.
- **Resolution:** 2026-08-01 — **wrong.** They are venue-local with no offset field,
  which silently mis-ordered anything spanning a DST change. Fixed in the ingest layer;
  the constant lives in one place now. Kept as `refuted` rather than rewritten,
  because "we shipped on this for a while" is the useful part of the record.
