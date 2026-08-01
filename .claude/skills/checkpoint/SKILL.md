---
name: checkpoint
description: Session-end closeout — verify no dangling state (backlog statuses match reality, working tree clean, no orphan scripts), make the checkpoint commits, and write .claude/HANDOFF.md so the next session resumes cheaply. Use for "wrap up", "end session", "checkpoint", "close out", or /checkpoint.
---

# Checkpoint — session closeout & handoff

A session may end only when: (a) every backlog `Status:` matches reality, (b) the
working tree is clean, (c) `HANDOFF.md` says what's next. This skill enforces that. It
is the **sole writer of `.claude/HANDOFF.md`** (local-only — HANDOFF is gitignored by
design; it's session state, not project history). Sessions run in parallel on different
branches, so HANDOFF is **sectioned per branch**: rewrite only the current branch's
section, never another session's.

**Write gate (HANDOFF is a durable claim too).** The baton is what the next session
trusts instead of re-reading the tree, so a wrong line here is *load-bearing*. Every
check below is a search whose **empty result you are about to promote to a fact** —
precisely the inference that fails silently when a tool is proxied, misflagged, or
pointed at the wrong path. So:
- **Positive-control every "none found"** before it becomes a HANDOFF line: re-run the
  same query against a pattern you know matches, or confirm it a second way (a
  different tool, or a check that would fail). `git`-native and test-enforced results
  are already strong; ad-hoc greps are not.
- **Never write an exhaustive inventory** ("these are the last N", "no entry is in
  state S") — state the consequence, or let a check hold it.
- **Never write "pre-existing, not mine to fix"** about something you have not
  verified. That phrasing tells the next session not to look, which converts your
  unchecked guess into their settled fact.

## Checks (fix or surface each hit — don't silently pass)
1. `git status --short` — uncommitted changes? Group them into checkpoint commits
   (below). Untracked files under `scripts/` or `src/` are a red flag: either commit
   them with their feature/run or ask.
2. `grep -n "Status:" docs/research/backlog/*.md | grep -i active` — any `active` entry
   must have a matching run in `log/` (check via
   `grep "^### Run" docs/research/log/*.md | tail`). Dangling → tell the user the loop
   is open; /research closes it, not this skill. Also
   `grep -n "Deploys as:" docs/research/backlog/*.md` — a `won` entry whose
   `Deploys as:` points at a product item that doesn't exist yet (or one still
   `proposed` with nothing queued) is a closed-but-undeployed win; surface it. The
   *terminal*-target half of this is mechanical — the schema check fails when a `won`
   entry points at a shipped P# without recording that it landed — so a green suite
   covers it and this grep only has to catch the not-yet-terminal cases.
   **Positive-control it regardless:** this exact grep has returned 0 against 16 real
   hits under a proxy, and it is the check that once caught a miss one merge too late.
3. `grep -n "Status:" docs/product/BACKLOG.md | grep -i in-progress` — an in-progress
   entry whose work is **already merged to main** is missing its /ship flip; run /ship
   now (on main). Work that's finished but still on its branch is fine — mark the
   branch **ready to land** in its HANDOFF section and point the user at /land; the
   flip happens there, not here.
4. `## Next up` staleness — the schema check already fails CI on a dangling/terminal
   queue, so a green suite covers it; if a feature shipped this session, confirm /ship
   refreshed the head.
   **Did an OD resolve this session?** (`git diff main -- docs/OPEN_DECISIONS.md`, or
   check the register for a `Resolution:` dated today.) If so, name every entry whose
   `Depends on:` cites it — those are now unblocked, and a `refuted` OD may have
   *voided* them instead. Nothing else in the loop notices a resolution, so this is
   where the sweep gets triggered; the deep pass is `/triage groom`.
5. `git branch --no-merged main` — every unmerged branch should have a HANDOFF section
   saying whether it's ready to land or what blocks it. A branch with no section is an
   unknown — flag it to the user. Landing is **/land**'s job, not this skill's; just
   report which branches are ready.

## Checkpoint commits (tied to completions, never time)
One commit per completed unit, code and docs separate:

| Completed unit | Commit shape |
|---|---|
| implementation + tests green | `feat:` / `fix:` / `perf:` |
| a /research record + close | `research(<ID>): <question> — <decision>` (log + FINDINGS + status + config together) |
| a /ship doc sync | `docs: ...` |

Don't bundle unrelated units; don't commit with failing tests without saying so in the
message and to the user.

## HANDOFF.md (one section per in-flight branch — a baton rack, not a log)
`.claude/HANDOFF.md` holds one `##` section per unmerged branch. Rewrite **only the
current branch's section** (a few lines each); leave other sections untouched —
parallel sessions own those. Prune sections whose branch is merged into main or
deleted.

```markdown
# Handoff

## <branch> — <date>
- **Changed:** <what landed this session, with commit shas>
- **In flight:** <open loops: active experiments, half-done features, failing tests + why>
- **Next:** <the single most likely next action, with its backlog ID>
- **Land:** ready | blocked on <what>
```

**Next session's entry path:** read HANDOFF.md, then orient with the Phase-0 grep from
/research — not by re-reading the tree.

## Not this skill
- Closing a research loop → **/research**. Doc sync → **/ship**. Merging a finished
  branch into main → **/land**. This skill only verifies they ran, commits, and writes
  the baton.
