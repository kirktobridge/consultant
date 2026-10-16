---
id: OD-4
title: Does a subagent reading a SKILL.md answer like a session that was given it?
status: open
raised: 2026-08-02
---

## Assumption

a subagent handed `SKILL.md` as **user-turn text** makes the same
decisions as a real session, where the harness injects the skill as *instructions*.
The eval's numbers are only about the skills if this holds.

## Why it matters

every rate `evals/` reports rests on it. If a pasted skill is
followed *less* faithfully than an injected one, the eval under-reports and we would
edit prose that was never the problem; if *more* faithfully, it over-reports and a
real gate failure stays invisible. Both errors point at the prompt, which is why
neither shows up as a suspicious result.

## How to verify

take one case with a sharp expected answer
(`depends-gate-refuses-blocked-entry`), run N reps through the emitted prompt, then
run the same repo state in a session where the skill is actually invoked, and compare
the two rates. A gap wider than the noise floor at that N settles it.
