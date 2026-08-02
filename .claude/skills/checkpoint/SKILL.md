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
trusts instead of re-reading the tree, so a wrong line here is *load-bearing*. Anything
you assert here is a search whose **empty result you are about to promote to a fact** —
precisely the inference that fails silently when a tool is proxied, misflagged, or
pointed at the wrong path (LESSONS [L1](../../../docs/LESSONS.md)). So:
- **Never hand-grep for a negative.** Use
  `node scripts/grep-checked.mjs --control '<pattern you know matches>' '<pattern>' <paths>`,
  which refuses to report a zero it cannot back: exit 1 is a negative you may write
  down, **exit 2 means the search never worked and the result is not evidence.** Read
  the exit code, not the absence of output.
- **Never write an exhaustive inventory** ("these are the last N", "no entry is in
  state S") — state the consequence, or let a check hold it.
- **Never write "pre-existing, not mine to fix"** about something you have not
  verified. That phrasing tells the next session not to look, which converts your
  unchecked guess into their settled fact.

## Checks

**Run the audit. Don't re-derive it by hand.**

```
node scripts/session-audit.mjs          # exit 0 clean · 1 findings · 2 could not audit
```

It computes the five things that are decidable from git + the docs: uncommitted work
and orphan files under code dirs; a **spike still in flight whose OD is unresolved**;
an `in-progress` entry with no branch (abandoned claim) or whose branch already merged
(missed /ship flip); an **OD resolved this session whose dependents nobody swept**; and
unmerged branches with no HANDOFF section. Each finding comes with the one action it
needs.

Two reasons this is a script and not a checklist here. It re-runs identically every
time — where a model running five greps and reading them by eye will occasionally
mis-read one, and that failure is *silent* (L1). And it can't decide it already knows
the answer, which is the specific way an end-of-session check degrades when the work
feels done.

**Your job is the response, not the computation.** For each finding decide: fix it now,
carry it in HANDOFF, or say why it's fine. Never pass one over silently.

- `[ALERT]` — a `refuted` assumption with live dependents. Stop and read them; a
  refutation can **void** an entry rather than unblock it, and anything already shipped
  on the false premise needs a fresh look. Deep pass: `/triage groom`.
- `[CHECK]` — resolve or explicitly carry.
- `[note ]` — usually just the commit grouping below.

Exit 2 means the audit couldn't run (not a repo, no integration branch). That is
**not** a clean result — fix it or say so; an audit that didn't run looks exactly like
one that found nothing.

`## Next up` staleness is covered by the schema check, so a green `npm run check:docs`
covers it; if a feature shipped this session, confirm /ship refreshed the head.

## Checkpoint commits (tied to completions, never time)
One commit per completed unit, code and docs separate:

| Completed unit | Commit shape |
|---|---|
| implementation + tests green | `feat:` / `fix:` / `perf:` |
| a spike that settled an assumption | `spike(OD-n): <question> — <what was found>` (the probe + the `Resolution:` together) |
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
- **In flight:** <open loops: half-done features, unsettled assumptions, failing tests + why>
- **Next:** <the single most likely next action, with its backlog ID>
- **Land:** ready | blocked on <what>
```

**Next session's entry path:** read HANDOFF.md, then orient with
`grep -n "^### \|Status:" docs/product/BACKLOG.md docs/OPEN_DECISIONS.md` — not by
re-reading the tree.

## Not this skill
- Doc sync, including an OD `Resolution:` → **/ship**. Merging a finished branch into
  main → **/land**. Re-checking blockers in depth → **/triage groom**. This skill only
  verifies they ran, commits, and writes the baton.
