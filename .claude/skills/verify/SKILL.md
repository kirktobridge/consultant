---
name: verify
description: Drive the real running app to observe a change working end-to-end — launch it, exercise the affected flow with a throwaway script, and report what was actually observed. Use after any nontrivial product-code change ("verify this", "does it actually work", /verify), and as the launch recipe when asked to run or screenshot the app (/run). Not a substitute for the test suite — it observes behavior the suite doesn't assert.
context: fork
---

# Verify — observe the change working in the real app

The test suite proves the assertions we already wrote; this skill proves the change
actually behaves as intended, by driving the affected flow in the running app and
observing the result. Runs **forked** — derive what changed from `git diff`/`git log`
(don't rely on conversation state) and end with a compact report: what flow you drove,
what you observed, artifacts captured, and any console/server errors verbatim.

Skip (say so, don't fake it) when the diff touches only tests, docs, or config with no
runtime surface. Anything under `src/` has one.

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

Report **observed** facts only:
- the new behavior visibly happened (artifact or asserted state),
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
