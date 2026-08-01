# Agent skill suite — a doc-driven working loop

A portable system of **seven Claude Code skills** plus the **documents they read and
write**, extracted from a project where it ran for months across dozens of features and
experiments.

It solves one problem: **an agent's durable notes drift from reality, silently.** A
backlog says a feature is unbuilt when it shipped; a claim written from a mistyped grep
reads as fact three sessions later; a validated result sits undeployed because nothing
named who owned it. This suite makes those failures either impossible or loud.

## The three ideas

**1. One pen per file.** Every tracking doc has exactly one skill allowed to write it.
No coordination protocol, no merge conflicts, no two agents "helpfully" editing the
same status line.

**2. The docs are a greppable dataset that happens to be markdown.** Skills orient by
grepping `### <ID>` headings and `**Status:**` lines — never by reading whole files.
That grep is only as trustworthy as the format is uniform, so a schema check asserts
the format in CI. You get structured-data reliability without leaving prose.

**3. Claims carry their strength.** Findings are already graded (`replicated` /
`significant` / `directional`). The same rigour applies to prose claims about code:
*mechanically enforced*, *verified* (say how), or *asserted*. And a negative claim
("nothing else calls this") requires a **positive control** first — an empty result
from a broken tool is indistinguishable from a true negative.

Grading claims one sentence at a time still leaves the *asserted* ones unindexed, so
[docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md) is the standing register of them —
assumptions the project rests on that nobody has verified. An `open` one **blocks** the
work that depends on it, in CI and at /implement's gate. Never build on an unverified
figure.

## The loop

```
                          ┌──────────┐
     raw idea ──────────► │ /triage  │  classifies, drafts, writes nothing
                          └────┬─────┘
        ┌──────────────────────┼──────────────────────┐
 metric+bar?│ YES              │ NO          it's an │ ASSUMPTION
            ▼                  ▼                      ▼
      ┌───────────┐      ┌─────────────┐     ┌──────────────────┐
      │ /research │      │ /implement  │     │ OPEN_DECISIONS   │
      │  AE#/AD#  │      └──────┬──────┘     │  OD-n — blocks   │
      └─────┬─────┘             ▼            │  what depends    │
            │  run → log →  ┌───────────┐    │  on it           │
            │  FINDINGS →   │  /verify  │    └──────────────────┘
            │  close        └─────┬─────┘
            └──────────────┬──────┘
                           ▼
                      ┌─────────┐
                      │  /land  │  merge, full suite on merged result (forked)
                      └────┬────┘
                           ▼
                      ┌─────────┐
                      │  /ship  │  status flips, Next up, architecture *why*
                      └────┬────┘
                           ▼
                    ┌─────────────┐
                    │ /checkpoint │  dangling-state audit, commits, HANDOFF baton
                    └─────────────┘
```

The fork at the top is the whole design. *Can this state a success criterion — a metric
and a bar?* Yes → prove it. No → build it. *Is it neither — just something we're
assuming?* → register it, and it blocks whatever rests on it until someone checks.
Ideas that are both experiment and feature get **split**, with the product entry's
`Depends on:` naming the experiment — which is how a feature stops shipping on an
assumption nobody measured.

## What's in the box

```
.claude/
  GUIDE.md              human-facing guide to the seven skills
  settings.json         hooks: edit-guard (Pre), doc-debt-check (Post)
  edit-guard.py         blocks writes to human-owned files
  edit-blocklist        which files those are            ← edit for your project
  skills/{triage,research,implement,verify,land,ship,checkpoint}/SKILL.md
  skills/research/stats.py    Wilson CI + z-test + power (portable as-is)
docs/
  product/BACKLOG.md          features (P#)              ← written only by /ship
  OPEN_DECISIONS.md           unverified assumptions (OD-n) — an open one blocks
  research/FRAMEWORK.md       the experiment process (the authority)
  research/backlog/           questions (AE#/AD#)        ← written only by /research
  research/log/               append-only run records
  research/FINDINGS.md        curated claims (F#) + method lessons (M#)
  dev_notes/OPEN_IDEAS.md     your raw dump              ← human-only, hook-blocked
scripts/
  backlog-schema-check.mjs    the keystone: asserts the docs stay greppable
  doc-debt-check.mjs          cross-track obligations stay paired
PORTING.md                    how to adapt all of this
```

## Try it

```bash
node scripts/backlog-schema-check.mjs     # → backlog-schema: OK (4 entries across 2 backlog(s))
node scripts/doc-debt-check.mjs --all     # → silent, exit 0
python3 .claude/skills/research/stats.py 340 640
python3 .claude/skills/research/stats.py --power --bar 52 --effect 54
```

The template ships with example entries that pass the checks, so you can see the shape
before replacing them.

## Then read

1. **[PORTING.md](PORTING.md)** — the marked spots, in order, plus what not to change
   and why.
2. **[.claude/GUIDE.md](.claude/GUIDE.md)** — the day-to-day view: what each skill
   does, typical days, the parallel-session rules.
3. **[docs/research/FRAMEWORK.md](docs/research/FRAMEWORK.md)** — the experiment
   process, if you're keeping the measurable track.

## Provenance

Extracted from a real project's `.claude/` and `docs/`. The gates read like paranoia
until you notice each cites the specific failure that bought it — a feature shipped
missing a won experiment's delta because nothing read the pointer aimed at it; an entry
built on a premise two other entries had already voided; sweep evidence lost to a
scratch dir, costing a ~53 CPU-hour re-run of already-published numbers. The method
lessons in `FINDINGS.md` keep that shape deliberately: **the failure first, the rule
second.** A rule with its scar attached gets followed; a decontextualized maxim gets
skipped exactly when it's inconvenient.
