---
name: land
description: Merge one finished feature branch into main, verify the merged result (full test suite), then run /ship's doc flips on main — the integration step between branch work (/implement) and the user's acceptance. Also lands an ad-hoc `adhoc/…` branch, which has no entry. Use for "land this branch", "merge to main", "integrate feat/…", "land adhoc/…", or /land.
context: fork
---

# Land — merge a finished branch into main

One branch per invocation. This is the **only skill that merges**. It writes no docs
itself — /ship, invoked as the last step, is the pen.

Runs **forked** (`context: fork`) so the merge/test churn never lands in the main
session's context. Consequences: everything needed must come from git (it does —
don't rely on conversation state), and the main session sees **only your final
message** — end with a compact report: merge sha, test totals, doc flips made, branch
deleted or not, and on failure *exactly* what failed and what state main was left in.
Then the **acceptance handshake**: the branch's per-criterion report, each `Accept:`
criterion verbatim with its verdict and evidence — not a diff summary — and, if the
entry's last milestone just landed, the question it is now waiting on: *"P# landed
and is `in-progress` until you accept it. Ship it?"* (a bug: *"B# landed; is it
fixed?"*). A criterion the branch reported
as *not exercised — observable after landing* is yours to check: look at main now,
and give it a verdict of its own with the evidence. Name every criterion that is
not observed or not exercised first; that is what the user is accepting despite.

## Preconditions (stop if any fail)

*Main* in this skill is the **trunk**: the integration branch `node scripts/trunk.mjs`
names, which is `main` only when the clone has one. Get it from that command; never
write a branch name into a git command (`<trunk>` below).

- You are in the main checkout, and it is clean. The session left its worktree
  before invoking you.
- The branch holds the land lock (`node scripts/land.mjs lock status`) and is
  rebased onto main. /implement did both in its worktree, resolving any conflicts
  there. If it doesn't hold the lock, the branch skipped that step: send it back
  through /implement's close, because a rebase can't happen from here.
- The branch carries its **per-criterion close report** — /implement writes it into
  the feature commit's message: each `Accept:` criterion, verbatim, as observed /
  not observed / not exercised. Read it with `git log <trunk>..<branch>`. No report →
  stop: the user is about to be asked to accept against it, and you cannot write it
  from here (you never saw the build). Send the branch back through /verify.
  Then read `node scripts/land.mjs report <branch>`. If conflicts were resolved and
  no commit after the resolution carries a fresh report, the verdicts describe the
  code from before the resolution: mark each one *observed before conflict
  resolution* in the handshake.

## An ad-hoc branch (`adhoc/<slug>`)

A change too small to be an entry (a prose rewrite, a doc fix) lands through the same
lock, rebase, merge and suite, from a branch `node scripts/worktree.mjs start --adhoc
<slug>` cut. It has no entry, so the close-report precondition, step 3 and the
acceptance handshake do not apply: there is nothing to report against, nothing for
/ship to flip, and nothing for the user to accept. Everything else holds, the lock
and the rebase included.

What it owes instead is a record. Step 1 is `node scripts/land.mjs merge <branch>
--adhoc "<what changed, one line>"`, plus `--relates <ID,…>` when the change touches
existing entries; the merge commit carries them as `Ad-hoc:` and `Relates:` trailers.
Write the `<what>` from `git log <trunk>..<branch>`, and the `Relates:` IDs from what
those commits name. land.mjs refuses the merge without `--adhoc`, and refuses a
`Relates:` ID that has no entry in any register. Your report gives the merge sha, the
trailers, the suite result and the cleanup.

The precondition holds as written for every `feat/` branch: no close report, no
landing, whatever the size of the change.

## Steps
1. `node scripts/land.mjs merge <branch>`, wrapped in `time`. It merges `--no-ff`
   (the merge message carries the conflict report), runs the full suite on the
   merged result, and on red puts main back where it was — **main is never left
   broken**. A merge conflict here can't happen to a rebased branch under the lock.
   If it does, something moved main without the lock: say so.
2. Red, or any refusal → `node scripts/land.mjs lock release <branch>` so the other
   sessions aren't held up, report exactly what failed and that main is untouched,
   and stop.
3. Run **/ship** on main: `partial` + the milestone if milestones remain, queue
   (`docs/backlog/QUEUE.md`) refresh, any BUILD_ORDER / ARCHITECTURE touch-up. **Never `shipped`.** If this was
   the entry's last milestone, it stays `in-progress`: whether it shipped is the
   product owner's call, made against the report below, and a forked skill cannot
   ask them. Tests green and every criterion observed are evidence for that call,
   not the call. A bug (`B#`, branch `feat/b<#>-…`) has no milestones and no
   `partial`: it stays `in-progress` until the user accepts the fix, and `fixed` is
   their flip as `shipped` is. If the branch was a **spike** (`resolves: A-n`), /ship also
   writes the assumption's `Resolution:` and flips its status — the answer landing in the code
   without landing in the register is the exact failure the pairing check exists for.
   Name the resolution in your final report, and say if it was a **refutation**: that
   may void other entries rather than unblock them, and the main session needs to know
   before it picks the next thing up.
4. `node scripts/land.mjs finish <branch>`: removes the worktree and the branch,
   drops the landing record, and releases the lock. That's the last step, because
   /ship's flips in step 3 are commits on main and need the lock too. Your report
   includes the conflicts from `land.mjs report` (taken before finish): file, both
   sides, the resolution.

## Not this skill
- Doc edits → **/ship** (invoked as step 3, never replaced).
- Building the feature → **/implement**.
- Deciding an entry shipped → **the user**, then /ship writes it.
