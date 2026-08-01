# Open Decisions

The register of **load-bearing assumptions** — facts the project's correctness depends
on that nobody has actually verified.

Not features (those are [product/BACKLOG.md](product/BACKLOG.md)). Not measurable
questions (those are [research/backlog/](research/backlog/)). An **OD** is something
you are currently *assuming* and would have to change code over if the assumption is
wrong: a third-party API's real behavior, a constant taken from a blog post, a limit
nobody has hit yet, "users won't do X".

**Why this file exists.** Claim discipline (CLAUDE.md) grades a claim as *mechanically
enforced*, *verified*, or *asserted* — but grades it **one sentence at a time, at
write time**. Nothing indexes the asserted ones. So a project accumulates assumptions
it can't enumerate, and the first time anyone notices is when one turns out false and
takes three features with it. This register is that index: the standing list of what
we're standing on.

**Written by:** /triage (adds), /research and /implement (resolve). Unlike the
backlogs, this file has no single pen — an OD can be resolved by whoever resolved it.
What's enforced is the *shape*, by the schema check.

---

## The rule that makes it worth maintaining

> **Never build on an unverified figure.**

A product or research entry whose `Depends on:` names an **open** OD is blocked — not
"proceed with caution", blocked. /implement's DEPENDS GATE refuses it. This is
strictly cheaper than the alternative: work built on a false assumption isn't just
wasted, it's *misleading*, because it ships and looks fine until the assumption is
tested.

The counterpart obligation: **when an OD resolves, sweep the blocked work.** A resolved
OD usually unblocks several entries, and nothing else will notice. /triage's groom mode
and /checkpoint both check for this.

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
  this is a research entry (a measurement), not an OD.
- **Resolution:** — (on close: what was found, how, and the date)
```

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
