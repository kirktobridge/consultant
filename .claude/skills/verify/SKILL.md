---
name: verify
description: Drive the real running app to observe a change working end-to-end — launch it, drive the backlog entry's Accept criteria with a throwaway script, and report each criterion as observed / not observed / not exercised. Use after any nontrivial product-code change ("verify this", "does it actually work", /verify), and as the launch recipe when asked to run or screenshot the app (/run). Not a substitute for the test suite — it observes behavior the suite doesn't assert.
context: fork
---

# Verify — observe the change working in the real app

The test suite proves the assertions we already wrote; this skill proves the change
actually behaves as intended, by driving the affected flow in the running app and
observing the result. Runs **forked**, so it rebuilds its context from the repo, never
from conversation state.

**What to drive comes from the entry's `Accept:`, not the diff.** Take the backlog ID
from the argument (`/verify P4`), or else from the branch name (`feat/p<#>-…`), and
read the whole entry:
`cat docs/backlog/<ID>.md`. Its
`Accept` criteria are the flows — each is something the product owner said they could
watch pass or fail, so drive *that*, in their terms. The diff (`git diff`/`git log`)
plays a supporting role: it tells you where a criterion's flow lives, and what else the
change touched that might have broken. It never decides what "working" means — a flow
derived from the diff can only confirm the change does what the change does.

No ID resolvable (an ad-hoc fix, not a backlog entry) → fall back to deriving the flow
from the diff, and say in the report that there were no criteria to drive.

End with a compact report: **each criterion, verbatim, as observed / not observed / not
exercised** (a later milestone owns it), with the evidence or what was seen instead;
then artifacts captured and any console/server errors verbatim.

Skip the *driving* (say so, don't fake it) when the diff touches only tests, docs, or
config with no runtime surface — anything under `src/` has one. The criteria are still
listed, each as *not observed — no runtime surface to drive*; a skipped run never
reports a criterion as observed.

## Why this exists as a separate step

A green suite and a working feature are different claims. The suite asserts what
someone thought to assert *before* the change; the gap between "typecheck passes" and
"a user can do the thing" is where shipped bugs live. This skill closes that gap by
insisting on **observed** evidence, and by refusing the downgrade — "tests pass, looks
fine" is not a verify result.

---

## Launch recipe — PORTING: REPLACE THIS ENTIRE SECTION

This is the most project-specific part of the suite. Everything above and below is
portable; this block is not. Write your project's actual launch procedure here, at
this level of specificity — vague instructions produce vague verification.

Cover, as applicable:

- **How to start it**, with the exact command and port, and pin the port
  (`--strictPort` or equivalent). *A stale server on the expected port serves old
  code and passes* — the single most common way a verify run lies. If the port is
  taken, find and kill it; never silently fall back to another port.
- **Which services are needed for which flows** — don't boot the whole stack to check
  a client-side change; do boot the backend for anything touching persistence.
- **Readiness probes** — the command whose success means "actually up" (e.g.
  `curl -s localhost:8000/health`), not a fixed sleep.
- **Logs**: run services in the background, capture logs to the scratchpad, and
  **check them at the end** — a clean-looking UI with a stack trace in the server log
  is not verified.
- **Determinism flags** — anything that removes animation delays, randomness, or
  artificial think-time, so a script can drive the app reliably. Note when the flag
  must be *omitted* (when the change is about that timing itself).
- **Teardown** — kill what you started; leave a pre-existing user-started server alone.

## Driving the app — PORTING: ADAPT

Drive with a **throwaway script in the scratchpad** (never a committed spec; a flow
worth keeping becomes a real spec via the normal build flow). For a web UI that means
headless browser automation; for a CLI, a shell transcript; for a service, a sequence
of requests.

- Capture before/after evidence around the key action (screenshot, response body,
  DOM state) and attach the decisive one to the report.
- Capture console and unhandled errors — **zero errors is part of the bar**.
- Keep a **canonical flows** list here: the two or three paths worth driving, with the
  exact selectors/commands. Note when they were last confirmed, and point at the
  committed specs as the living selector reference — when a selector 404s, the spec is
  the truth, not this file.

---

## What "verified" means

Report **observed** facts only, per criterion:
- the behavior each `Accept:` criterion names visibly happened (artifact or asserted
  state) — a criterion you didn't drive is *not exercised*, never observed by
  inference from a neighbouring one,
- the old behavior is gone, if the change removed one,
- logs and console are clean.

If the flow can't be driven (feature behind unmerged state, server won't start),
report that as **not verified** with the blocker — never downgrade to "tests pass,
looks fine".

## Not this skill
- Running the suite / typecheck / lint → that's /implement step 4's first bullet; do
  not duplicate it here.
- Judging code quality → a code-review skill.
- Merging or doc flips → **/land**, **/ship**.
- Settling an open decision → that's a **spike** `P#` built through /implement. This
  skill observes *your change* working; a spike investigates something you didn't
  build. The habit is the same, the trigger isn't.
