---
id: OD-6
title: Does a Claude Code worktree branch from the local main that holds the claim?
status: verified
raised: 2026-10-15
resolved: 2026-10-15
---

## Assumption

a worktree created by EnterWorktree starts at local `main`, including
a claim commit made seconds earlier.

## Why it matters

the tool's own description says its default
(`worktree.baseRef: fresh`) branches from `origin/<default-branch>`, and this repo
has no remote. The feature branch could start from a stale or missing base, or
creation could fail outright. P15 R1 rests on this.

## How to verify

in a repo with no remote, enter a worktree from main and compare
its HEAD with main's.

## Resolution

2026-10-15 — held for the no-remote case. With no `baseRef` set and
no `origin`, EnterWorktree created the worktree at 676f0d9, local main's HEAD
(*verified*: `git rev-parse HEAD` in the worktree vs main). Not tested: a repo with a
remote, where per the tool's description `fresh` branches from `origin/main` and
would miss an unpushed claim. P15 sets `worktree.baseRef: head` rather than rely on
the default.
