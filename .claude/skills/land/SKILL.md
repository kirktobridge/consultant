---
name: land
description: Merge one finished feature branch into main, verify the merged result (full test suite), then run /ship's doc flips on main — the integration step between branch work (/implement) and /checkpoint. Use for "land this branch", "merge to main", "integrate feat/…", or /land.
context: fork
---

# Land — merge a finished branch into main

One branch per invocation. This is the **only skill that merges**; /checkpoint
surfaces what's ready to land, this skill does the landing. It writes no docs itself —
/ship, invoked as the last step, is the pen.

Runs **forked** (`context: fork`) so the merge/test churn never lands in the main
session's context. Consequences: everything needed must come from git + HANDOFF (it
does — don't rely on conversation state), and the main session sees **only your final
message** — end with a compact report: merge sha, test totals, doc flips made, branch
deleted or not, and on failure *exactly* what failed and what state main was left in.

## Preconditions (stop if any fail)
- Working tree clean (`git status --short`).
- The branch's section in `.claude/HANDOFF.md` says **ready to land** — or the user
  explicitly says land it anyway. No section → run /checkpoint on that branch first.
- Tests were green at the branch's checkpoint; if in doubt, re-run on the branch.

## Steps
1. `git checkout main` (pull first if there's a remote), then
   `git merge --no-ff <branch>` — keeps the merge-commit convention.
2. **Conflicts → stop and show them.** Never auto-resolve silently. With the
   flips-on-main discipline (see /ship) doc conflicts should be rare, so a conflict is
   a signal something skipped the process — say so.
3. Verify the merged result: the full test suite + typecheck, wrapped in `time`. Red →
   undo the merge (`git reset --merge ORIG_HEAD`), report what failed, and leave main
   untouched — **never leave main broken**.
4. Run **/ship** on main: terminal status flip, `## Next up` refresh, any BUILD_ORDER /
   ARCHITECTURE touch-up. If the branch was a **spike** (`Resolves: OD-n`), /ship also
   writes the OD's `Resolution:` and flips its status — the answer landing in the code
   without landing in the register is the exact failure the pairing check exists for.
   Name the resolution in your final report, and say if it was a **refutation**: that
   may void other entries rather than unblock them, and the main session needs to know
   before it picks the next thing up.
5. Delete the branch (`git branch -d`). Its HANDOFF section is pruned by the next
   /checkpoint (sole writer of HANDOFF), not here.

## Not this skill
- Doc edits → **/ship** (invoked as step 4, never replaced).
- Session closeout / writing HANDOFF → **/checkpoint**.
- Building the feature → **/implement**.
