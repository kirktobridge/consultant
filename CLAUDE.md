# <PROJECT NAME>

<!-- PORTING: one-paragraph description of what this project is and how to run it.
     Keep it short — this file is loaded into every session's context, so every line
     costs tokens on every turn. Link out rather than explain. -->

**Run:** `<start command>`. `<test command>` runs the suite. `<typecheck>` / `<lint>`
for checks. `npm run check:docs` runs the backlog schema + doc-debt checks.

## Canonical docs — read before working

| Doc | What it is |
|-----|------------|
| [docs/SPEC.md](docs/SPEC.md) | **Source of truth for behavior.** Human-owned — propose diffs, never edit. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, folder layout, key types, the *why*. |
| [docs/product/BACKLOG.md](docs/product/BACKLOG.md) | **Product/feature backlog** — the pool of shippable work. |
| [docs/research/FRAMEWORK.md](docs/research/FRAMEWORK.md) | **The experiment process** — read before running or recording one. |
| [.claude/GUIDE.md](.claude/GUIDE.md) | The seven skills and how they hand off. |

## Doc discipline (avoid the re-align treadmill)

- **Single source of truth per fact:** behavior → SPEC, structure/why → ARCHITECTURE,
  plan → BUILD_ORDER, measurable experiments → `docs/research/`, product features →
  `docs/product/BACKLOG.md`. Once code exists, **code + tests own the *what*; docs
  keep the *why*.**
- **ARCHITECTURE code blocks are illustrative sketches** — when they diverge from the
  source, the source wins; don't sync every signature back into the doc.
- **Let tests enforce the spec** so alignment is mechanical, not manual. BUILD_ORDER is
  disposable — tick off / delete phases as they ship.

## Claim discipline (drift you *write*, not drift you inherit)

The premise gate guards claims you **read**. These guard claims you **write** — a
sentence that's wrong on arrival is worse than one that rotted, because nothing signals
it's suspect.

- **A tool's empty result is not evidence.** "grep found none" ≠ "there are none": a
  proxied, misflagged, or wrong-path search returns empty *exactly* like a true
  negative. Before promoting a "none found" to a durable claim, run a **positive
  control** — the same tool against a pattern you know matches. Empty control means
  your tooling lied, not the repo.
- **Never write an exhaustive inventory into prose.** "X and Y are the last remaining
  Z", "nothing else calls W" — unmaintainable, and nothing can hold them. Write the
  **consequence**, not the inventory. If the inventory matters, it belongs in a check.
- **Say how strongly a claim is held** when it isn't obvious: *mechanically enforced*
  (a check holds it), *verified* (checked this session — say how), or *asserted* (a
  belief). An asserted claim that reads as verified is how the next session inherits
  your guess as fact.

**Schema checks run on the way *out*, not just in.** Entry conditions are easy to
remember and exit conditions are easy to skip, so the backlog schema check guards
*both* — open entries carry their fields, and a `won` entry must name where it
deployed. A won result with no owner is inventory, not value.

**Every open entry is dated** (`- **Drafted:** YYYY-MM-DD`) — meaning *when its claims
were last established*. Bumping it after a real re-read is the intended workflow;
bumping it to quiet a failing check is the one abuse no check can catch. The schema
check flags an open entry drafted **before** a dependency it names reached a terminal
state: that dependency usually moved the very code the entry describes. A flag means
*re-verify before building*, not *the entry is wrong*.

## Invariants (easy to get wrong)

<!-- PORTING: list your project's non-negotiable architectural rules here — the ones a
     new contributor (human or agent) would violate by default. /implement references
     this section rather than duplicating it. Give each one the *bug it prevents*,
     not just the rule; a rule with a consequence attached gets followed.

     Example shape:
     - **Rule.** What it is, and the specific failure it prevents. Note whether it's
       enforced by a test/lint rule or only by convention — that difference decides
       how much to trust it.
-->

## Conventions

<!-- PORTING: naming, coordinates, units, formatting — the small stuff that causes
     churn when it's implicit. -->
