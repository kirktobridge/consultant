# Open Decisions

The register of **load-bearing assumptions** — facts the project's correctness depends
on that nobody has actually verified.

Not features — those are [product/BACKLOG.md](product/BACKLOG.md). An **OD** is
something you are currently *assuming* and would have to change code over if the
assumption is wrong: a third-party API's real behavior, a constant taken from a blog
post, a limit nobody has hit yet, "users won't do X".

**An OD is a unit of doubt, not a unit of work.** Everything else tracked here is
something you'd do; this is something you're standing on without having looked down.
That's why the register has no owner and no priority order — see *Who settles one*
below.

**Why this file exists.** Claim discipline (CLAUDE.md) grades a claim as *mechanically
enforced*, *verified*, or *asserted* — but grades it **one sentence at a time, at
write time**. Nothing indexes the asserted ones. So a project accumulates assumptions
it can't enumerate, and the first time anyone notices is when one turns out false and
takes three features with it. This register is that index: the standing list of what
we're standing on.

**Written by:** /triage drafts, /ship usually holds the pen, but unlike the backlog this
file has **no single writer** — an OD is settled by whoever hits it. What's enforced is
the *shape*, by the schema check.

---

## The rule that makes it worth maintaining

> **Never build on an unverified figure.**

Work built on a false assumption isn't just wasted, it's *misleading*: it ships, looks
fine, and stays that way until the assumption is finally tested — taking everything
downstream with it.

But "blocked" is graded by how close the work actually is, because a blanket block on
anything touching an open assumption would make filing a blocked idea impossible:

| Where the dependent sits | Effect |
|---|---|
| `proposed`, parked in the pool | **allowed.** This is how you file a blocked idea — /triage calls it *blocked-not-rejected*. |
| listed in `## Next up` | **blocked.** The queue means dependency-ready; this entry isn't. |
| `in-progress` / `partial` | **blocked.** Someone is building on it right now. |

The lower two fail the schema check, and /implement's DEPENDS GATE refuses to pick up
any of the three — by the time you're building, parked is no longer where you are.

The counterpart obligation: **when an OD resolves, sweep the blocked work.** A resolved
OD usually unblocks several entries, and nothing else will notice. /ship does the
immediate sweep at resolution time; /triage's groom mode and /checkpoint catch the rest.

---

## Who settles one

Nobody, by standing assignment. The register is deliberately ownerless: an assumption
gets checked by whoever runs into it, at the moment it actually costs something. The
value here doesn't depend on anyone working through the list — **enumeration** (you can
count what you're standing on) and the **refuted record** (how often we're wrong)
both pay off even if nothing is ever verified. Only the block creates pressure, and it
applies that pressure exactly when it matters.

So when an OD does block something, the exit depends on cost and on proximity to the
queue:

```
An open OD blocks something
  ├─ cheap to settle?          → do it now; write Resolution:, sweep the dependents
  ├─ expensive, dependents at
  │  or near `## Next up`      → promote to a spike P# (below)
  └─ expensive, dependents
     deep in the pool          → leave it open. Correctly parked; nothing is
                                 blocked in practice yet.
```

### Spikes

A **spike** is a product entry whose deliverable is *the answer*, not a feature. It
carries `**Resolves:** OD-n`, and its `**Value:**` names the entries it unblocks —
which is honest value, one step removed. It's built through /implement like anything
else.

The back-pointer is a structured field rather than a sentence on purpose: an obligation
buried in prose is unenforceable by construction (LESSONS [L2](LESSONS.md)). The schema
check pairs the two and fails if the spike ships while the assumption is still `open` —
the answer landing in code but never in the register is the specific way this goes
wrong.

Only the middle branch produces a spike. That bound is what stops the register from
becoming a generator of speculative work: an assumption is worth paying to settle
exactly when it's about to stop you.

---

## Status vocab

Status vocab: `open` / `verified` / `refuted` / `moot`.

| status | meaning |
|--------|---------|
| `open` | still an assumption; blocks anything that depends on it |
| `verified` | checked against reality; the assumption held. Record **how**. |
| `refuted` | checked; the assumption was **wrong**. Record what it actually is, and what that broke. |
| `moot` | the question stopped mattering (design changed, feature dropped) |

`refuted` is the valuable one. Never quietly rewrite a refuted OD into a verified one
describing the new truth — the record that we believed something false, and for how
long, is what calibrates how much to trust the *rest* of this list.

---

## Entry template

```markdown
### OD-1 — <the question, as a question>
- **Status:** open
- **Raised:** YYYY-MM-DD
- **Assumption:** what we are currently acting as if is true.
- **Why it matters:** what breaks if it's false — name the entries or code that rest on it.
- **How to verify:** the concrete check that would settle it. If you can't name one,
  you don't have an OD — you have a wish. Say so rather than filing it.
- **Resolution:** — (on close: what was found, how, and the date)
```

An OD being settled by a spike also gains a `- **Spiked as:** P9` line, so the pairing
is readable from this side too. The schema check reads the `Resolves:` half.

---

## Register

### OD-3 — Does Claude Code anchor hook matchers against the tool name?
- **Status:** open
- **Raised:** 2026-08-02
- **Assumption:** a hook `matcher` is matched **unanchored** — i.e. the matcher `Edit`
  would also fire for `MultiEdit`, because the tool name contains it. We do not know
  this; the docs we have say only that matchers are regexes.
- **Why it matters:** `scripts/verify-guards.mjs` decides whether a guard still covers
  every write tool. It currently takes the **conservative** reading and requires
  anchored coverage, so a matcher of `Edit` is reported as *not* covering `MultiEdit`.
  If the harness really is unanchored we are merely strict — we demand
  `Edit|Write|MultiEdit` be spelled out, which is clearer anyway. If we had assumed
  unanchored and the harness anchors, a narrowed matcher would leave `MultiEdit`
  genuinely unguarded while the check reported *armed*. Only one of those two errors is
  recoverable, which is why the assumption is written down rather than picked.
- **How to verify:** set a throwaway PreToolUse hook with matcher `Edit` that logs the
  tool name, then trigger a `MultiEdit` and read the log.
- **Resolution:** —

### OD-4 — Does a subagent reading a SKILL.md answer like a session that was given it?
- **Status:** open
- **Raised:** 2026-08-02
- **Assumption:** a subagent handed `SKILL.md` as **user-turn text** makes the same
  decisions as a real session, where the harness injects the skill as *instructions*.
  The eval's numbers are only about the skills if this holds.
- **Why it matters:** every rate `evals/` reports rests on it. If a pasted skill is
  followed *less* faithfully than an injected one, the eval under-reports and we would
  edit prose that was never the problem; if *more* faithfully, it over-reports and a
  real gate failure stays invisible. Both errors point at the prompt, which is why
  neither shows up as a suspicious result.
- **How to verify:** take one case with a sharp expected answer
  (`depends-gate-refuses-blocked-entry`), run N reps through the emitted prompt, then
  run the same repo state in a session where the skill is actually invoked, and compare
  the two rates. A gap wider than the noise floor at that N settles it.
- **Resolution:** —

### OD-5 — Are agent-produced effort estimates good enough to prioritize with?
- **Status:** open
- **Raised:** 2026-08-03
- **Assumption:** an agent can size a backlog entry closely enough that value-vs-effort
  ranking beats ranking on value alone.
- **Why it matters:** the obvious fix for the missing prioritization tradeoff is a
  `Size:` field on every entry. If the estimates are noise, that field is worse than
  nothing — it makes ranking *look* informed while adding a third claimant to the
  entry-shape surface P4 and P5 already share.
- **How to verify:** carry a predicted size on entries for the next ~8 builds, compare
  each against actual session cost and wall time, and check whether the ordering the
  estimates imply differs from value-only ordering by more than their error.
- **Resolution:** —

### OD-6 — Does a Claude Code worktree branch from the local main that holds the claim?
- **Status:** verified
- **Raised:** 2026-10-15
- **Assumption:** a worktree created by EnterWorktree starts at local `main`, including
  a claim commit made seconds earlier.
- **Why it matters:** the tool's own description says its default
  (`worktree.baseRef: fresh`) branches from `origin/<default-branch>`, and this repo
  has no remote. The feature branch could start from a stale or missing base, or
  creation could fail outright. P15 R1 rests on this.
- **How to verify:** in a repo with no remote, enter a worktree from main and compare
  its HEAD with main's.
- **Resolution:** 2026-10-15 — held for the no-remote case. With no `baseRef` set and
  no `origin`, EnterWorktree created the worktree at 676f0d9, local main's HEAD
  (*verified*: `git rev-parse HEAD` in the worktree vs main). Not tested: a repo with a
  remote, where per the tool's description `fresh` branches from `origin/main` and
  would miss an unpushed claim. P15 sets `worktree.baseRef: head` rather than rely on
  the default.

### OD-7 — Inside a worktree session, do the project's hooks act on the worktree?
- **Status:** refuted
- **Raised:** 2026-10-15
- **Assumption:** `$CLAUDE_PROJECT_DIR` (used by every hook in .claude/settings.json)
  points at the worktree the session is in, not at the original checkout.
- **Why it matters:** if it points at the original checkout, the schema check and the
  edit-guard run main's copies, and the in-session checks don't see the branch's
  files. P15 R1 rests on this.
- **How to verify:** in a worktree session, make the worktree's copy of a hook script
  distinguishable from main's, trigger the hook, and see which copy acted.
- **Resolution:** 2026-10-15 — **refuted.** In a session launched from the main
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

### OD-8 — Can a build's footprint be predicted from its backlog entry?
- **Status:** open
- **Raised:** 2026-10-15
- **Assumption:** an agent reading an entry's Scope can name the files its build will
  touch, well enough that two entries predicted not to overlap won't conflict.
- **Why it matters:** P17's "non-conflicting" pick rests on it. If predictions miss,
  P15's conflict rule still recovers, so the cost is wasted rebuilds, not broken main.
- **How to verify:** for each merged entry in history, predict touched files from the
  entry text as it stood when claimed, then compare with the merge's `--name-only`
  diff. Report recall per entry.
- **Resolution:** —

### OD-9 — Can a subagent run the loop's forked skills?
- **Status:** verified
- **Raised:** 2026-10-15
- **Assumption:** a worktree-isolated subagent can invoke /implement, and from inside
  it /verify and /land, which run `context: fork`, i.e. as subagents of their own.
- **Why it matters:** P17 hands each build to a subagent. If a subagent can't start a
  forked skill, it can't run /verify or /land, and P17's design needs reshaping (e.g.
  the orchestrator runs /verify and /land itself).
- **How to verify:** spawn one worktree-isolated general-purpose subagent; have it
  invoke a forked skill on a trivial target and report whether it ran.
- **Resolution:** 2026-10-15 — held for /verify. A general-purpose subagent spawned
  with `isolation: "worktree"` (its worktree at main's 37cb726) had the Skill tool,
  called `verify P14`, and got back `Skill "verify" completed (forked execution)` with
  only the final report in its context. Its worktree and branch were auto-removed
  afterwards (*verified*: `git worktree list` and `git branch` on main). Not tested:
  /land from a subagent. An isolated session is refused git aimed at another checkout
  (P15 Notes), so a subagent's /land would presumably be refused too; P17 keeps
  landing in the orchestrator. Two side findings: the caller's "write no files"
  instruction didn't reach the fork, which wrote logs to the shared session
  scratchpad; and the isolation guard refused compound commands that the `rtk` hook
  rewrites to `rtk git`, while plain single git commands ran.

### OD-10 — Does a SessionStart hook's output reach the session?
- **Status:** verified
- **Raised:** 2026-10-16
- **Assumption:** stdout from a `SessionStart` command hook in .claude/settings.json is
  added to the new session's context, so the agent sees the audit's findings without
  anyone running a command.
- **Why it matters:** P18 moves the session audit from /checkpoint to session start.
  If the output only reaches a log, the findings are invisible and the audit needs
  another trigger (e.g. /implement's gates).
- **How to verify:** start a headless session with a SessionStart hook that prints a
  unique marker, ask it what context it was given at startup, and see whether the
  marker comes back.
- **Resolution:** 2026-10-16 — **holds, on exit 0 only.** Probed with headless
  `claude -p` (2.1.174) in a scratch repo whose SessionStart hook echoed a unique
  marker the prompt never contained. Exit 0: the session quoted the marker verbatim.
  Same hook ending `exit 1`: the session answered NONE, so the output was dropped.
  Wrapped as `… || true`: the marker came back. That matters because
  session-audit.mjs exits 1 exactly when it has findings; P18's hook must force exit
  0. Findings print on stdout (*verified* by reading the script); its exit-2 "could
  not audit" message goes to stderr, whose fate was not probed. Not tested: an
  interactive session (headless only).
