# Lessons

The expensive ones — failures that cost enough to be worth a standing rule.

Each is written as **the failure first, the rule second**. Keep that shape. A rule with
its scar attached gets followed; a decontextualized maxim gets skipped exactly when
it's inconvenient, which is exactly when it was load-bearing.

This file is prose, not a tracked dataset — no schema, no status vocabulary, no
checker. It has no single pen: whoever pays for a new lesson writes it. Add one only
when something actually went wrong; a lesson invented pre-emptively is a maxim wearing
a costume.

Referenced by the write gates in [/ship](../.claude/skills/ship/SKILL.md)
and [/implement](../.claude/skills/implement/SKILL.md), and by the claim-discipline
section of [CLAUDE.md](../CLAUDE.md).

---

### L1 — An empty tool result is not evidence

Two proxied greps once "proved" no entry was in a given state. Nine were. A search that
is misconfigured, proxied, or pointed at the wrong path returns empty *exactly* like a
true negative, and nothing downstream can tell the two apart — least of all the session
that reads the resulting claim three days later and has no reason to doubt it.

**Rule:** *mechanically enforced.* Search with
[`scripts/grep-checked.mjs`](../scripts/grep-checked.mjs), which will not report a zero
it cannot back:

```
node scripts/grep-checked.mjs --control '<pattern you know matches>' '<pattern>' <paths>
  exit 0  matches — self-validating
  exit 1  clean negative, control passed — safe to write down
  exit 2  CONTROL FAILED — the search never worked; NOT evidence of absence
```

This was prose in four skills for a while, and prose was the wrong medium: the whole
point of L1 is that *skipping the control looks exactly like doing it*, so a rule
telling you to do it is unenforceable by construction. Two things had to become
properties of the tool instead:

- **The search runs in-process.** The original failure was a *proxied* grep — shelling
  out and adding a control would still route through the thing that lied.
- **Every zero carries its control.** A negative is graded VERIFIED (an explicit
  control matched) or WEAK (only readability confirmed). Don't promote a WEAK negative
  into a doc.

The rule survives in the write gates as *which flag to pass*, not as an exhortation.

### L2 — An obligation with no owner is inventory

A validated result sat undeployed behind an unchanged default, because the work that
produced it closed cleanly and nothing named who would carry it forward. Meanwhile the
entry that would have carried it shipped without it. Every gate passed, because nothing
read the pointer aimed at it.

The general shape: an obligation recorded on one side of a boundary, with nothing on
the other side accountable for it. It never fails loudly — it just quietly doesn't
happen, and the record looks complete from either side alone.

**Rule:** an obligation that crosses entries names its counterpart in a **structured
field**, not in prose, so a check can hold the pair. In this suite that is a spike
`P#`'s `Resolves: A-n` and the assumption's `Resolution:` — paired by
[the schema check](../scripts/backlog-schema-check.mjs). Intent buried in a sentence
("we should settle this eventually") is unenforceable by construction: nothing can
grep it and nobody is accountable for it.

### L3 — A check that stopped looking passes exactly like a check that found nothing

The corollary of L1, aimed at this repo's own machinery. A checker whose parser silently
stops matching — a renamed field, a changed heading shape, a regex narrowed one
character too far — reports success. Green means "found no violations", which is
indistinguishable from "looked for nothing".

**Rule:** *mechanically enforced.* `npm test` feeds every check input that is known bad
and asserts it fails — see [tests/](../tests/). Proving a check bites was a manual ritual
for a while, performed once and then thrown away, which is the same failure one level up:
the proof existed only in a transcript. Two supports:

- **The tests assert the failure *messages*, not just the exit codes.** The wording is
  the interface skills act on; a violation reworded into something vague keeps every
  check green while removing the reason anyone obeys it.
- **The entry count is a positive control printed on every run.**
  `OK (n entries across m file(s))` — a number that quietly drops means the parser
  broke, not that drift left.

The corollary for tests themselves: a fixture that renders a *present but meaningless*
field (`- **Value:** null`) makes a missing-field test pass while proving nothing. The
test suite is a check, and checks can stop looking too.
