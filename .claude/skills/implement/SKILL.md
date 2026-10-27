---
name: implement
description: Build a specific product-backlog item (P#) from docs/backlog/, or fix a bug (B#) from docs/bugs/ — check its dependencies, pick the milestone, branch, implement, test, and verify — then hand integration to /land (which runs /ship's doc flips on main). Use for "implement P4", "build the tutorial item", "pick up P3 R1", or /implement. Writes code + tests only, never the backlog docs.
---

# Implement — build a product backlog item

Takes one entry (or one milestone of one entry) from
[docs/backlog/](../../../docs/backlog/README.md) to working, verified code
on a feature branch. This skill **writes code and tests only** — every backlog/doc
edit goes through its owner: **/ship** owns the backlog and the architecture docs; the
spec is human-owned.

`<ID>` = a product id like `P4`, optionally with a milestone (`P3 R1`), or a bug id
like `B2` from [docs/bugs/](../../../docs/bugs/README.md). A bug runs the same steps;
where they differ, the step says so.

## Steps

### 1. Locate + gate

Each gate below exists because skipping it shipped something broken. They are cheap;
run all of them.

- **No ID given?** Run `node scripts/next.mjs` and propose what it prints. Every open,
  dependency-ready bug comes before the queue, most severe first; a bug is never
  ranked into [QUEUE.md](../../../docs/backlog/QUEUE.md). With no bug ready, it gives the
  queue's head. It reads the trunk and skips claimed entries. Exit 1 means nothing is ready:
  say so, with the bugs it lists as held.
- Find the entry: `cat docs/backlog/<ID>.md` (a bug: `cat docs/bugs/<ID>.md`) — the whole file, never a fixed line
  count: entries run long, and a truncated read drops `Accept`, the half of the
  contract that comes last. No such file → it's an untriaged idea; bounce to
  **/triage**, don't invent an entry.
- **PREFLIGHT:** before the claim, run `node scripts/preflight.mjs <ID> [R#]` and keep
  what it prints. It runs the claim, depends, status, milestone and spike gates from the
  trunk, and it prints a premise table for the paths and symbols the entry names. It
  only reports. Run every gate below by hand anyway, then compare your verdicts with its
  verdicts; the close report says whether they agreed (step 4). A premise row reading
  `found` never clears a claim: it says the name exists, not that the claim holds.
- **CLAIM GATE:** `node scripts/claims.mjs`
  first. It reads the **trunk's** version, never the checked-out copy: in a worktree
  the local files reflect when you branched, so they can miss a claim another session
  made since. *Trunk* is the integration branch `node scripts/trunk.mjs` names
  (usually `main`); never write a branch name into a git command here. It prints one
  line per `in-progress` entry, read from headers (an entry whose prose quotes
  `status: in-progress` is not a claim). **Exit 2 means the gate never ran** — no
  trunk was found — so it has not passed: name the trunk with `--base <branch>`.
  Target entry already `in-progress` → stop; it's claimed by another session/branch
  (stale claims are cleared via /ship — the session-start audit surfaces them — not
  overridden here). Another entry
  in-progress whose flagged shared assets overlap this one's Scope → stop too; the
  first claimant builds the shared piece.
- **DEPENDS GATE:** read its header's `depends_on:`. A dependency that is an unshipped
  `P#` (directly or through another entry's `depends_on:`; only `shipped` counts, not
  `partial` — the schema check refuses the claim the same way), a `B#` not yet `fixed`,
  an **`open` `A-n`**
  ([docs/assumptions/](../../../docs/assumptions/README.md)) or an **`open` `D-n`**
  ([docs/decisions/](../../../docs/decisions/README.md)) blocks the build — stop
  and tell the user what's blocking, unless the specific milestone is explicitly marked
  unblocked. A bug gets this gate exactly as a feature does: severity buys it a place
  ahead of the queue, never a way past an open assumption or decision. An open decision has one way forward: ask the user to take it, and have
  /ship record it. Building on a guess about which way they'll choose is building on
  an unverified figure.
  **Never build on an unverified figure.** An open assumption is a fact nobody has
  checked; work resting on it isn't merely risky, it's *misleading* — it ships, looks
  correct, and stays that way until the assumption is finally tested, taking everything
  downstream with it. This gate is **unconditional**, unlike the schema check's
  graduated version: the check tolerates a blocked entry parked in the pool, because
  parking one costs nothing. You are about to pick it up, which is exactly the moment
  that stops being true.
  Three ways forward, and /triage's spike decision picks between them: settle the assumption
  now if it's cheap (one API call, one probe) and write its `Resolution:`; build the
  spike `P#` that answers it, if one is queued; or rescope this entry so it no longer
  depends on it. "Proceed carefully" is not on the list.
- **MILESTONE GATE:** if Scope lists milestones (R0/R1/…), build **one per
  invocation**. If the user didn't name one, propose the first unshipped one and
  confirm — don't silently build the whole epic. Name which `Accept:` criteria this
  milestone answers; the rest are honestly *not exercised* at close, not passed.
- **SPIKE GATE:** if this entry's header carries `resolves: A-n`, it is a spike — its
  deliverable is *the answer*, not a feature. Build the smallest thing that settles the
  assumption, and treat writing the assumption's `Resolution:` as part of done (step 4). A
  spike that ships without the answer written back is the failure LESSONS
  [L2](../../../docs/LESSONS.md) describes; the schema check fails it, but catching it
  here is cheaper.
- **PREMISE GATE:** the entry text is a snapshot from drafting time; the code may have
  moved since. Search for the code symbols the entry names — with
  `node scripts/grep-checked.mjs --control '<something you know is in that tree>' …`,
  because "the symbol is gone" is exactly the negative claim this gate turns into a
  decision, and a bare grep cannot tell that from a bad path. Check every factual claim its
  Status/Scope makes about the code ("default is 0", "X is undeployed", "Y lacks Z")
  against the source **before claiming**. A stale premise is a scope-renegotiation
  trigger *now*, not a footnote to build through: surface the mismatch to the user and
  get the entry rescoped via /ship first. Follow-up obligations listed in Scope
  ("also migrate X", "revisit Y after") **inherit its premises** — a dead premise
  silently voids or reshapes them, and if carried verbatim they propagate into the
  commit message and /land's doc flip as obligations nobody owes.

### 2. Set up
- **CLEAN-TREE GATE:** `git status` must be clean before branching. Dirty tree =
  another task's live state — commit it with its own unit (or ask the user what it
  is); don't branch over it.
- Flip the entry to `in-progress` **via /ship, committed on main before branching** —
  a flip made on your branch is invisible to other sessions, which defeats the claim
  gate. (/ship edits its files on main only.) Hold the land lock for the claim
  commit: `node scripts/land.mjs lock take claim:<ID> --wait 600`, then release it
  with `lock release claim:<ID>`. Another session may be landing in the same main
  checkout.
- Then, from the main checkout, `node scripts/worktree.mjs start <ID>`. It refuses
  an unclaimed entry, a claimed one whose `depends_on:` is unmet on main (the DEPENDS
  GATE, held in code), or a dirty tree (exit 1, says which), cuts `feat/p<#>-<slug>` off
  local main into `.claude/worktrees/`, or resumes the entry's existing branch. Enter
  the `path:` it prints with **EnterWorktree** (`path`, not `name`) — CLAUDE.md
  authorizes this — and build there. You don't ask the user about any of it.
- **If you are a subagent, EnterWorktree and ExitWorktree are refused (A-12).** Work
  in the printed path anyway: run each command as `cd <path> && …` in one Bash call,
  and edit files there by their absolute path. Skip ExitWorktree; your main-checkout
  steps already run where you are.
- **Under EnterWorktree, run git one plain command per call.** The session's
  isolation refuses a compound git command (a pipe, a chain, a heredoc that names
  git), because it can't verify the command stays in the worktree (A-11). The `cd`
  form above is unaffected, since nothing isolates it. An installation whose hooks
  rewrite git through a wrapper needs its own workaround; that belongs in the
  installation's config, not here.
- **PLAN GATE:** read the header's `plan:`. **`plan: yes`** → before the first code
  edit, write the plan: the files to touch, the order, the risks, and any value the
  entry leaves for you to choose. On an entry with milestones it covers the milestone
  you confirmed. Then **stop and wait for the user to approve it**. The claim stays
  in place while you wait, so no other session picks the entry up. If you are a
  subagent, hand the plan back as `QUESTION <ID>:` and end your turn. **`plan: no`** is
  a floor, not a ceiling: if the work, as Scope reads now or as the build finds it,
  changes a schema or a register's format, touches a file several skills depend on,
  or spans several skills (/triage's own reasons for `yes`), stop the same way with a
  plan. A bug carries no `plan:`: plan it the same way if the fix turns out to be one
  of those.

### 3. Build
- The entry's **Scope and Accept are the contract** — Scope is what to build, Accept
  is what the product owner must be able to watch pass. Build what Scope says, resist
  adjacent improvements, and keep each criterion observable as you go. If scope turns
  out wrong mid-build — or a criterion can't be met by the Scope as written — stop and
  renegotiate the entry with the user (the rescope note lands in the entry via
  /ship), don't drift. Accept is the user's wording: never reinterpret a criterion
  into one the build happens to satisfy.
- **A bug's contract is its `Repro` and `Expected`.** The reporter's steps must stop
  reproducing, and what they expected must happen; nothing more gets built.
- **The project's invariants govern** — don't re-derive them here. *PORTING: list your
  project's non-negotiable architectural rules in CLAUDE.md and reference them from
  this line; they belong in one place, not duplicated per skill.*
- Shared assets flagged in the entry ("shares assets with P3", "build once") are
  binding: build the shared component once, in the place both consumers can reach.
- New core behavior gets unit tests next to the existing ones; new UI flows get an
  end-to-end spec.
- **Discovered work becomes a new entry immediately — never widen the one in flight.**
  Mid-build you *will* find adjacent bugs, missing tests, and better designs. Capture
  each as a fresh backlog draft (one sentence of context is enough), hand it to
  /triage at the end, and return to the task. This is the concrete mechanism behind
  "resist adjacent improvements": scope resistance fails when the only alternative to
  widening is forgetting, so give the finding somewhere to go. If the finding is an
  unverified assumption the build is now resting on, it's an **assumption**, and it may block
  the very entry you're building — surface it rather than proceeding past it.

### 4. Verify + close
- Run the full check suite (tests, typecheck, lint). Wrap long runs with `time`.
- **REVIEW** — the loop's one point where the diff is reviewed, before /verify so
  that /verify observes the reviewed code. `node scripts/review.mjs` decides it:
  - **Exit 0 = required.** Run the harness's **/code-review** on the diff. When it
    prints `security-review: warranted`, run **/security-review** in a subagent
    (Agent, `general-purpose`), never inline: that skill makes its report the whole
    final reply of whoever runs it, and inline that ends the build. Give the agent
    the worktree's absolute path and the base branch, and tell it to run
    /security-review there on `git diff <base>...HEAD` only, and return the report.
    The skill's own preloaded diff is against `origin`, which local main is usually
    ahead of (A-6), so it carries merged work that is not this build's. Fix each
    finding that holds, then re-run the suite; one you leave, say why in the close
    report. A finding outside this entry's Scope is discovered work (step 3): a new
    entry, not a wider build.
  - **Exit 1 = skippable** — the diff changes only Markdown. That is the whole rule;
    "it's a small change" is not a skip. If it says *no changes* instead, you are
    on the wrong branch or base, not done.
  - **Exit 2 = it never ran.** Not a skip: fix what it names and run it again.

  The close report carries one review line: the script's plain-output `review:`
  line (not `--json`), and which
  findings were fixed or left. It also carries each `eval:` line the script prints.
  Such a line names a changed SKILL.md and the eval cases that measure it. Whether
  to run them is the product owner's decision. It is never a gate.
- Run **/verify `<ID>`** — it drives the entry's `Accept:` criteria in the real app,
  not a flow guessed from the diff. A docs-only change has no app to drive: check
  each criterion directly (read the file, run the command it names) and say in the
  report that this is how it was checked.
- **Close by criterion, not by diff.** Start from `node scripts/close-report.mjs <ID>`:
  it prints the report's skeleton from the trunk's entry, with each criterion (a bug:
  its `Repro` and `Expected`) quoted word for word. Fill its `<…>` slots; never retype
  or reword what it quotes. Exit 2 means it printed no skeleton, and it says why.
  Report each `Accept:` criterion, verbatim, as
  **observed** (with the evidence), **not observed** (with what was seen instead), or
  **not exercised** (a later milestone owns it — say which). A diff summary is not a
  close report: it says what changed, and the criteria say whether it was right. A
  criterion that is *not observed* is not done — say so plainly rather than
  rounding it up. A criterion that only the landing can show ("on main, …") is
  *not exercised — observable after landing*. /land observes it on main and gives
  the verdict in its handshake.
  A bug closes the same way against its two sections: the `Repro`, re-run, as
  observed / not observed to still break, and the `Expected` as observed or not.
  The close report also carries one line, at the start of a line, for preflight:
  `preflight: agreed`, or `preflight: disagreed — <gate>: <what each side said>`.
  Write it from the step-1 comparison. Those lines are what decide whether preflight
  becomes the gate (`git log --grep '^preflight:'`), so a disagreement is the useful case.
- Commit on the feature branch, **with that per-criterion report and the REVIEW
  line in the commit message** and the entry's ID in the subject (`feat: … (P#)`; a bug: `fix: … (B#)`). `npm run history`
  finds an entry's commits by that ID, so a commit without it drops out of the
  record; and /land runs forked and reads git, not this conversation, and it is the
  report the user will be asked to accept against.
- **Then land it yourself — don't ask.** Still in the worktree:
  1. `node scripts/land.mjs lock take <branch> --wait 600`. If it's refused as
     *ambiguous*, ask the user; otherwise it waits its turn.
  2. `node scripts/land.mjs rebase` puts the branch on the current main.
     - **Exit 3 = conflicts.** It prints each region (main's side, this branch's
       side, what was there before either) and the entry that landed the other
       side. Read that entry's merge commit and backlog file, resolve each region
       with Edit so **both** entries' intent survives, then run
       `node scripts/land.mjs continue`. Repeat until it exits 0.
     - **Exit 4 = stop and ask the user.** Either your resolution kept only one
       side, or the conflict has nothing to resolve line by line (a delete, a
       rename, a binary file). Keep the lock and show them the regions.
  3. If anything was resolved, run the full suite in the worktree. If it's red,
     `lock release <branch>` and stop for the user. If it's green, the close report
     now describes code from before the resolution: re-run /verify and commit its
     fresh per-criterion report (`chore: re-verified after conflict resolution
     (P#)`, with `--allow-empty` when nothing changed, which is the usual case). If
     you can't re-run it, /land marks the old verdicts *observed before conflict
     resolution*.
  4. Leave the worktree with **ExitWorktree** (`keep`; /land removes it; a subagent
     skips this), then run
     **/land**. It merges into main, re-runs the suite on the merged result, runs
     /ship's flips there (`partial` + which milestone; doc flips never happen on the
     branch), and cleans up. `shipped` is not among those flips: it waits for the
     user to accept (see /ship).
- Re-derive any "still owed" follow-ups from the **actual diff**, not the entry's
  Scope text (premise gate, step 1): name in the hand-off to /land only obligations
  the change as-built really incurs, and say explicitly which scope-listed ones turned
  out void and why — /ship writes what it's handed.
- **If this was a spike** (`resolves: A-n`), the answer is the deliverable: state what
  you actually found, how you established it, and hand /land the exact text for the
  assumption's `Resolution:`. If the assumption turned out **wrong**, say so plainly and flag
  it as a refutation — that's the high-value case, and it may void other entries rather
  than unblock them. Never soften a refutation into "mostly held"; the register's worth
  depends on that distinction being honest.
- If the work surfaced a new assumption the build is now resting on, route it through
  **/triage** as an assumption — don't leave it in a commit message.

## Not this skill
- Merging into main → **/land**.
- Doc/status edits of any kind → **/ship**.
- Classifying a new idea → **/triage**.
- A spec/rules change → the spec diff is proposed to the human first (see /ship);
  don't start building on an unapproved rule.
