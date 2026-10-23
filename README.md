# Consultant — a doc-driven working loop

A portable system of **loop skills** plus the **documents they read and write**,
extracted from a project where it ran for months across dozens of features. (`/eval`
is maintenance for the suite's own prose, and `/research` runs experiments; both are
off the loop by design.)

It solves one problem: **an agent's durable notes drift from reality, silently.** A
backlog says a feature is unbuilt when it shipped; a claim written from a mistyped grep
reads as fact three sessions later; a feature ships on a premise nobody ever checked.
This suite makes those failures either impossible or loud.

> **The research track:** for claims a test can't catch — performance, ranking, model
> quality, "how often does X happen" — `/research` runs experiments
> ([docs/research/](docs/research/README.md)): an experiment backlog, an append-only run
> log, and findings graded by confidence. /triage routes a measurable question there.
> An empty experiment backlog is a legitimate state: the track waits for a question.

## The three ideas

**1. One pen per file.** Every tracking doc has exactly one skill allowed to write it.
No coordination protocol, no merge conflicts, no two agents "helpfully" editing the
same status line.

**2. The docs are a greppable dataset that happens to be markdown.** Each backlog entry
and each assumption is its own file: a strict `key: value` header (`status:`,
`depends_on:`, …) that the tools read, then a markdown body only people read. Skills
orient by reading header lines — never whole files — and nothing in the prose is ever
mistaken for a field. A schema check asserts the format in CI. You get structured-data
reliability without leaving prose.

**3. Claims carry their strength.** Every durable claim about the code says how strongly
it's held — *mechanically enforced* (a check holds it), *verified* (checked this
session, and how), or *asserted* (someone's belief). An asserted claim that reads as
verified is how the next session inherits your guess as fact. And a negative claim
("nothing else calls this") requires a **positive control** first — an empty result
from a broken tool is indistinguishable from a true negative.

Grading claims one sentence at a time still leaves the *asserted* ones unindexed, so
[docs/assumptions/](docs/assumptions/README.md) is the standing register of them —
assumptions the project rests on that nobody has verified. Never build on an unverified
figure. Its sibling, [docs/decisions/](docs/decisions/README.md), holds the choices only
the product owner can make, so they stop hiding inside features; an open one blocks the
same way.

## The loop

```
                          ┌──────────┐
     raw idea ──────────► │ /triage  │  classifies, drafts, writes nothing
                          └────┬─────┘
              ┌────────────────┴────────────────┐
      would we│BUILD it?           are we just  │ASSUMING it?
              ▼                                 ▼
       ┌─────────────┐                ┌──────────────────────┐
       │ /implement  │                │  docs/assumptions/   │
       └──────┬──────┘                │  A-n — blocks what   │
              ▼                       │  depends on it, in   │
        ┌───────────┐                 │  proportion to how   │
        │  /verify  │                 │  close that work is  │
        └─────┬─────┘                 └──────────┬───────────┘
              │                                  │ blocking the queue?
              │         ┌────────────────────────┘ → spike P#, back to
              │         │                            /implement
              ▼         ▼
          ┌─────────────────┐
          │      /land      │  merge, full suite on merged result (forked)
          └────────┬────────┘
                   ▼
             ┌─────────┐
             │  /ship  │  status flips, assumption resolutions, the queue, architecture *why*
             └─────────┘

  every session starts with the dangling-state audit (a SessionStart hook);
  `npm run history P#` reads an entry's story back out of git
```

The fork at the top is the whole design. *Would we build this, or are we assuming it?*
Build it → the backlog. Assuming it → register it, and it blocks whatever rests on it
until someone checks. Ideas that are both get **split**, with the feature's
`Depends on:` naming the assumption — which is how a feature stops shipping on a
premise nobody verified.

**The register is deliberately ownerless.** An assumption gets settled by whoever runs
into it, when it actually costs something — not by a standing assignee working a list.
Two of its three payoffs (you can *enumerate* what you're standing on; a `refuted` entry
tells you how often you're wrong) work even if nothing is ever verified. Only the block
creates pressure, and it applies that pressure exactly when it matters.

So an assumption escalates to real work — a **spike** `P#`, whose deliverable is the
answer rather than a feature — only when its dependents reach the queue. An
assumption blocking something deep in the pool is correctly parked. That bound is what
keeps the register from becoming a generator of speculative work.

## What's in the box

```
.claude/
  GUIDE.md              human-facing guide to the loop skills, and the checks
  settings.json         hooks: session audit (Start), edit-guard (Pre), schema check (Post)
  edit-guard.mjs        blocks writes to human-owned files
  edit-blocklist        which files those are            ← edit for your project
  skills/{triage,implement,verify,land,ship}/SKILL.md
  skills/eval/SKILL.md  off-loop: drives evals/ with subagents
docs/
  SPEC.md                     what "correct" means       ← human-only, hook-blocked
  ARCHITECTURE.md             the *why*                  ← written only by /ship
  BUILD_ORDER.md              the phased plan, disposable
  backlog/                    features, one file per P#  ← written only by /ship
    QUEUE.md                  what's next — the queue and nothing else
  bugs/                       what's broken, one file per B# ← written only by /ship
  assumptions/                unverified assumptions, one file per A-n — no single pen
  decisions/                  the product owner's choices, one file per D-n ← written only by /ship
  research/                   questions answered from data: the framework, experiments (X#),
                              runs (N#, append-only) and findings (F#)
  LESSONS.md                  the expensive failures, each with the rule it bought
  dev_notes/OPEN_IDEAS.md     your raw dump              ← human-only, hook-blocked
scripts/
  backlog-schema-check.mjs    the keystone: asserts the docs stay greppable
  entries.mjs                 the one strict reader for entry headers
  verify-guards.mjs           asserts the enforcement layer is still armed
  grep-checked.mjs            a search whose negative results are worth something
  titles.mjs                  every entry's ID, status and title — read before triage
  session-audit.mjs           what the last session left dangling (runs at session start)
  history.mjs                 each entry's commits and close reports, from git
tests/                        every check proven to still bite, the loop
                              walked end-to-end on a fake project, and the skills'
                              own instructions held against rot
evals/                        the prompt half — does reading a SKILL.md cause the
                              right decision? Answered by subagents, opt-in, never
                              gates a commit.
PORTING.md                    how to adapt all of this
```

Three enforcement layers, and which one a rule belongs in is the main design question
here: a **hook** fires whether or not anyone asked; a **script** is deterministic but
must be called; a **prompt** costs context every time and is followed probabilistically.
A rule that's decidable from artifacts *and* whose violation is silent has no business
being prose — that's how L1 stopped being an exhortation and became `grep-checked`.

## Try it

```bash
npm install                  # no dependencies — this exists to arm the git hooks
npm test                     # → the suite, then the schema + guard checks
npm run eval -- --dry-run    # → renders every eval prompt, self-checks the graders
npm run check:docs           # → backlog-schema: OK …
npm run audit                # → session-audit: clean … (or the findings, with actions)
npm run history P16          # → P16's claim, build + close report, merge, landing note
npm run check:guards         # → verify-guards: armed (2 hooks verified, blocklist intact)

# a negative you can trust, vs one you can't — note the exit codes
node scripts/grep-checked.mjs --control '^status:' 'AE[0-9]' docs/   # exit 1: VERIFIED negative
node scripts/grep-checked.mjs --control '^status:' 'AE[0-9]' docs/nope/  # exit 2: NOT evidence

echo '{"tool_input":{"file_path":"docs/SPEC.md"}}' | node .claude/edit-guard.mjs
                             # → BLOCKED …, exit 2
```

The tracked docs carry this repo's own live entries rather than placeholders, so what
you see is the shape in use. To adopt the suite, don't copy this tree: run
`node scripts/export.mjs <dir>`, which writes the suite alone, with one seed entry per
register where this repo's entries were (`npm run test:clean` proves that copy passes
its own suite). The idioms a fresh backlog won't
show you (a feature blocked on an assumption, the spike that unblocks it) are specified
in [docs/assumptions/](docs/assumptions/README.md)'s entry template and exercised by
the tests, which is where they're held rather than merely illustrated.

## Then read

1. **[PORTING.md](PORTING.md)** — the marked spots, in order, plus what not to change
   and why.
2. **[.claude/GUIDE.md](.claude/GUIDE.md)** — the day-to-day view: what each skill
   does, typical days, the parallel-session rules.
3. **[docs/LESSONS.md](docs/LESSONS.md)** — the failures the gates were bought with.

## Provenance

Extracted from a real project's `.claude/` and `docs/`. The gates read like paranoia
until you notice each cites the specific failure that bought it — an entry built on a
premise two other entries had already voided; two proxied greps that "proved" no entry
was in a given state when nine were; a validated result left undeployed because nothing
named who owned it. [docs/LESSONS.md](docs/LESSONS.md) keeps that shape deliberately:
**the failure first, the rule second.** A rule with its scar attached gets followed; a
decontextualized maxim gets skipped exactly when it's inconvenient.
