---
id: OD-7
title: Inside a worktree session, do the project's hooks act on the worktree?
status: refuted
raised: 2026-10-15
resolved: 2026-10-15
---

## Assumption

`$CLAUDE_PROJECT_DIR` (used by every hook in .claude/settings.json)
points at the worktree the session is in, not at the original checkout.

## Why it matters

if it points at the original checkout, the schema check and the
edit-guard run main's copies, and the in-session checks don't see the branch's
files. P15 R1 rests on this.

## How to verify

in a worktree session, make the worktree's copy of a hook script
distinguishable from main's, trigger the hook, and see which copy acted.

## Resolution

2026-10-15 — **refuted.** In a session launched from the main
checkout and switched into a worktree with EnterWorktree, the hooks ran the main
checkout's scripts. How: the worktree's copy of backlog-schema-check.mjs was made to
log on every run (a direct run confirmed the log works), and an Edit in the worktree
left no log. The edit-guard told the copies apart: for a new file under the
worktree's `docs/dev_notes/`, the worktree's guard blocks (exit 2, fed the payload
directly) and main's permits (exit 0). In-session, both a Write and an Edit there
went through, while an Edit to the worktree's `docs/SPEC.md`, which both copies
block, was blocked. So the hook fires, and it's main's copy. What it broke: in any
worktree session, folder patterns in the blocklist don't protect the worktree's
files, and the PostToolUse checks validate main's docs instead of the branch's.
Exact-path patterns still hold through the guard's suffix rule. Not tested: a
session launched from inside the worktree directory. Fix filed as P16.
