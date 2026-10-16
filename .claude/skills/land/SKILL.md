---
name: land
description: Merge one finished feature branch into main, verify the merged result (full test suite), then run /ship's doc flips on main — the integration step between branch work (/implement) and the user's acceptance. Use for "land this branch", "merge to main", "integrate feat/…", or /land.
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
and is `in-progress` until you accept it. Ship it?"* Name every criterion that is
not observed or not exercised first; that is what the user is accepting despite.

## Preconditions (stop if any fail)
- Working tree clean (`git status --short`).
- Tests were green at the branch's last commit; if in doubt, re-run on the branch.
- The branch carries its **per-criterion close report** — /implement writes it into
  the feature commit's message: each `Accept:` criterion, verbatim, as observed /
  not observed / not exercised. Read it with `git log main..<branch>`. No report →
  stop: the user is about to be asked to accept against it, and you cannot write it
  from here (you never saw the build). Send the branch back through /verify.

## Steps
1. `git checkout main` (pull first if there's a remote), then
   `git merge --no-ff <branch>` — keeps the merge-commit convention.
2. **Conflicts → stop and show them.** Never auto-resolve silently. With the
   flips-on-main discipline (see /ship) doc conflicts should be rare, so a conflict is
   a signal something skipped the process — say so.
3. Verify the merged result: the full test suite + typecheck, wrapped in `time`. Red →
   undo the merge (`git reset --merge ORIG_HEAD`), report what failed, and leave main
   untouched — **never leave main broken**.
4. Run **/ship** on main: `partial` + the milestone if milestones remain, queue
   (`docs/backlog/QUEUE.md`) refresh, any BUILD_ORDER / ARCHITECTURE touch-up. **Never `shipped`.** If this was
   the entry's last milestone, it stays `in-progress`: whether it shipped is the
   product owner's call, made against the report below, and a forked skill cannot
   ask them. Tests green and every criterion observed are evidence for that call,
   not the call. If the branch was a **spike** (`resolves: OD-n`), /ship also
   writes the OD's `Resolution:` and flips its status — the answer landing in the code
   without landing in the register is the exact failure the pairing check exists for.
   Name the resolution in your final report, and say if it was a **refutation**: that
   may void other entries rather than unblock them, and the main session needs to know
   before it picks the next thing up.
5. Delete the branch (`git branch -d`).

## Not this skill
- Doc edits → **/ship** (invoked as step 4, never replaced).
- Building the feature → **/implement**.
- Deciding an entry shipped → **the user**, then /ship writes it.
