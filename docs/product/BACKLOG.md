# Product backlog

Curated pool of everything we intend to **build** — the shippable, user-facing side of
the project. Its sibling is [../OPEN_DECISIONS.md](../OPEN_DECISIONS.md), which holds
what we're currently *assuming*: this file is work, that file is doubt. An idea that's
really "we should find out whether X" belongs there, not here.

A backlog is a **prioritized pool, not a committed plan** — its dependency-ready head is
the [Next up](#next-up) block below (the authoritative "what's next to build"); the
shipped build history lives in [../BUILD_ORDER.md](../BUILD_ORDER.md).
[../dev_notes/OPEN_IDEAS.md](../dev_notes/OPEN_IDEAS.md) is the raw, unmaintained
developer dump; this file is the curated version. Rules → [../SPEC.md](../SPEC.md);
structure → [../ARCHITECTURE.md](../ARCHITECTURE.md).

Status vocab: `proposed` / `in-progress` (being built this session/branch) / `partial`
(some milestones shipped) / `shipped` / `deferred` / `abandoned`.

Every open entry carries **`Accept:`** — 2–4 sub-bullets, each one thing someone could
watch pass or fail. `Scope:` is what gets built; `Accept:` is how the product owner
would know it was built right, in their words. The schema check enforces the *count*
(so the field can't degrade into one unfalsifiable sentence), never the wording — /ship
copies it verbatim, and a criterion that looks wrong is the user's to rewrite.

An entry may sit here `proposed` while it `Depends on:` an **open** `OD-n` — that's how
a blocked idea gets filed rather than lost. It may **not** appear in `## Next up` or go
`in-progress` in that state; the schema check enforces the line.

**Written only by /ship**, on main only. See `.claude/GUIDE.md`.

---

## Next up

The **dependency-ready** head of the backlog, highest-payoff first — the authoritative
answer to "what to build next." Refreshed by /ship on status flips + intake. The schema
check fails CI if any ID here is missing, terminal, or resting on an open assumption:
"dependency-ready" is a claim this block makes, so it has to be true.

1. **P16** — hooks guard the worktree a session is in. Landed on main 2026-10-16;
   awaiting your acceptance against its per-criterion report. P15 waits on it.
2. **P9** — anchor the field probes. Ahead of P5 and P6 not by dependency but by
   timing: both of those write documentation prose *about* new field names, which is
   the exact input that makes P9's silent failure live. Cheap, and cheaper now than
   after.
3. **P5** — defects as a third intake class. Extends the same schema-check surface P4
   touches, so it follows P9 by preference rather than by dependency.
4. **P6** — split "merged" from "released". Independent of the others; available to
   a parallel session at any time.
5. **P8** — a review step in the loop. Placement, not construction, so it's cheap; last
   because nothing else waits on it.

Note what is *absent*: P7 is a high-payoff idea, and is
deliberately not queued — it depends on P6 (P4 has shipped), so the queue would be claiming a
readiness it doesn't have. P15 is absent for the same reason: it waits on P16's acceptance. P17
waits on P15 and on an open assumption (OD-8).
(Named in plain text on purpose: a **bolded** ID in this
block *is* the queue, as far as the schema check and every skill's grep are concerned.)

---

## Epic: Product-owner interface

<!-- Group entries under `## Epic:` headings that match how you think about the
     product. The schema check doesn't care about epic names — it cares that every
     `### <ID> — Title` heading is well-formed and every open entry carries its
     fields. -->

### P4 — Acceptance criteria, and the acceptance handshake
- **Status:** shipped
- **Drafted:** 2026-08-03
- **Value:** you say what "right" means before the build, in your own words, and the
  loop closes by reporting against those words. Today it closes without you: the agent
  infers intent from its own diff, and /land flips `shipped` without you saying yes.
- **Scope:**
  - R0 — **landed 2026-08-03**: an `**Accept:**` field in the entry shape — 2–4
    observable checks. Required on open entries by `scripts/backlog-schema-check.mjs`;
    drafted by /triage; preserved verbatim by /ship's intake. Doc + checker + every
    skill grep move in one commit.
  - R1 — **landed 2026-10-15**: /implement treats Accept as part of the contract alongside Scope; /verify drives
    *those criteria* rather than deriving the flow from `git diff`, and reports
    per-criterion observed / not-observed.
  - R2: the handshake — /land reports per criterion and stops short of the terminal
    flip; `shipped` becomes a flip the user authorizes.
  - Out: any criteria-authoring UI, and criteria for defects (that's P5).
- **Accept:**
  - An open entry with no `Accept:` is rejected by `npm run check:docs`, and the
    message names the field.
  - An `Accept:` that is one unfalsifiable sentence is rejected too — presence alone
    doesn't pass.
  - At close, /implement reports each criterion as observed or not-observed, rather
    than summarising the diff.
  - No entry reaches `shipped` without me saying so.
- **Depends on:** —
- **Shipped:** 2026-10-15 — accepted by the user against the R2 per-criterion report; criteria 1–3 observed, criterion 4 accepted *not observed* (the eval was deliberately not run).
- **Notes:** R0 landed as the first claimant of the entry-shape/schema-check surface, so
  **P5** now *extends* that checker rather than building it. R1 landed 2026-10-15:
  /implement and /verify now consume Accept, and both read entries heading-to-heading
  (the old `grep -A12` cut off mid-Scope on longer entries, so Accept never reached the
  builder — a process test runs each skill's lookup verbatim against the real backlog).
  **R2 landed 2026-10-15** (merge 9517b50): /land reads the per-criterion report from
  the feature commit, runs /ship for `partial` / Next up only, and asks "Ship it?";
  `shipped` is the user's flip. **Awaiting the user's acceptance** — criterion (4) is
  not observed (its /eval cases were not run, at the user's request). Per-criterion
  at R1 land: (1) observed; (2) observed *as worded*, but a loophole was found — one
  unfalsifiable sentence split across two bullets passes the 2–4 count, so the check
  holds the count, not falsifiability; (3) observed once, in the R1 session; (4) not
  exercised — it is R2. **The `Accept:` criteria now sitting on P4–P8 were drafted by the agent
  alongside the field, not spoken by the product owner** — they are proposals awaiting
  your correction, which is exactly the review this field exists to invite; treat them
  as *asserted* until you've rewritten or ratified them. The standing risk: a required
  field can degrade into ceremony (Value restated as a bullet list). That the *check*
  cannot stop it is now **verified** — the two-bullet split above passes, and no
  falsifiability test is decidable without inviting a permanently-noisy heuristic, so
  none is planned. The backstop is /triage's "could it fail?" prose (eval-measured)
  plus R2's handshake, where the user approves `shipped`. Not filed as an OD deliberately — no check settles it before the field exists,
  and an OD settleable only post-build would park this entry outside `## Next up`
  permanently, inverting the register. R0 instead ships an eval case measuring whether
  the augmented /triage prose yields observable criteria.

### P5 — Defects as a third intake class
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** you report "this is broken" and it lands with repro and severity intact,
  instead of being dressed as a feature with an invented `Value:` line. Urgent breakage
  can jump the queue without corrupting what the queue means.
- **Scope:**
  - R0: a `D#` id class with its own shape (Status / Reported / Repro / Severity /
    Depends on; no `Value:` required). /triage's classification test gains a third
    branch — build it / assuming it / **it's broken**. Schema check learns the shape.
  - R1: queue semantics — severity above a bar bypasses `## Next up` ordering rather
    than being ranked into it; /implement accepts a `D#`, and its DEPENDS GATE still
    applies.
  - Out: anything resembling a bug tracker — no external sync, no duplicate detection.
- **Accept:**
  - Reporting "this is broken" produces a `D#` entry keeping my repro steps and a
    severity, with no invented `Value:` line.
  - A `D#` above the severity bar gets picked up next without being ranked into
    `## Next up`.
  - /implement accepts a `D#` id, and still refuses one blocked by an open OD.
- **Depends on:** —
- **Notes:** one shape decision to settle at build time — a distinct `D#` heading
  (recommended: greps stay separable, and `Value:`-not-required becomes enforceable by
  id class) versus `P#` with a `Kind:` field. Shares the schema-check surface with P4.

### P6 — Split "merged" from "released"
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** the backlog stops saying `shipped` about something no user can reach.
  Today `shipped` means merged; the event you actually care about — it's live — has no
  representation at all.
- **Scope:**
  - R0: status vocab gains `released` downstream of `shipped`, with both meanings
    stated here; checker and /ship's flip table updated in the same commit.
  - R1: a `/release` skill holding the project's real deploy procedure as a PORTING
    slot (the idiom is /verify's launch recipe), plus the version recorded on the entry.
  - Out: rollback automation, CI wiring, changelog generation.
- **Accept:**
  - An entry that is merged but not deployed reads `shipped`, and no entry reads
    `released` until it is actually reachable.
  - `/release` flips it to `released` and records which version went out.
  - A project with no deploy step passes the doc check with nothing ever `released`,
    and is never nagged about it.
- **Depends on:** —
- **Notes:** must degrade gracefully for projects with no deploy step — `released` stays
  an optional terminal state, never one the audit nags for, or the check loses
  credibility in exactly the projects that ported it fastest.

### P7 — A status view for the product owner
- **Status:** proposed
- **Drafted:** 2026-10-15
- **Value:** you can ask "where are we?" and get an answer without reading markdown —
  what landed, what's in flight and since when, what's blocked and on what. Today the
  only continuity artifact is HANDOFF, which is agent session-state, gitignored, and
  scoped per branch.
- **Scope:** a read-only `/status` that composes what already exists (backlog statuses,
  OD blocks, `npm run audit`, git) into a short report addressed to the product owner
  rather than to the next session. Out: any new tracked file — if it needs storage,
  it's the wrong design. Renders from P11's graph JSON, both as the text report and as
  one self-contained HTML page, generated and never edited by hand, stamped with the
  commit it was built from.
- **Accept:**
  - I can open one page that shows what's ready, what's waiting on me, and why each
    blocked item is blocked, without opening a markdown file.
  - It names what is in flight (each entry with its branch and worktree) and how long
    it has been there.
  - It names what is blocked and which assumption is blocking it.
  - Running it leaves every tracked file unchanged.
- **Depends on:** P4, P6, P11 — P4 shipped 2026-10-15; P6 and P11 are not terminal, so
  this entry is still *blocked-not-rejected*; it may not enter `## Next up` until they
  land. Released-vs-merged (P6) doesn't exist yet.
- **Notes:** P4 changed what this entry reads (*verified* against the /land, /implement
  and /ship text, 2026-10-15). Acceptance state now exists, in three places:
  per-criterion verdicts in the feature commit's message; "waiting on me" = an entry
  still `in-progress` whose merge is on main (/land never flips `shipped`); and the
  acceptance itself in the entry's `Shipped:` line. All three are free prose, not
  fields. So "what's waiting on me" is now concrete, but rendering *which criteria*
  passed means parsing commit messages unless P11's graph carries them — a design
  question for whoever builds this, not settled here.

### P8 — A review step in the loop
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** code quality gets a defined moment instead of falling through the gap
  between the suite's skills. /verify punts it to "a code-review skill", and the suite
  ships no such skill — so nothing reviews the diff today.
- **Scope:** wire the harness's existing `/code-review` (and `/security-review` where
  the diff warrants) into a named point between /implement step 4 and /land, with the
  rule for when it is skippable. Out: writing a reviewer — this is placement, not
  construction.
- **Accept:**
  - The loop has one named point where the diff gets reviewed, and /implement's
    close-out points at it.
  - The rule for skipping it names a condition I could check, not a judgement call.
- **Depends on:** —

### P15 — The loop drives git; parallel sessions get worktrees automatically
- **Status:** proposed
- **Drafted:** 2026-10-15
- **Value:** you never manage the git tree. Today you choose when to take a worktree,
  when to /land, and what to clean up, and running sessions in parallel depends on you
  following the GUIDE's rules by hand. Those rules become things the loop does.
- **Scope:**
  - R1 — `/implement P#` provisions its own worktree + `feat/p<#>-<slug>` branch off
    local main, after the claim commit, and the session works there. The rule that
    makes this allowed goes in CLAUDE.md: EnterWorktree acts only on user or
    CLAUDE.md/memory instructions, and a SKILL.md isn't on that list. settings.json
    sets `worktree.baseRef: head` (OD-6). `.claude/worktrees/` is gitignored, so the
    main checkout stays clean.
  - R2 — when /implement closes green, it runs /land itself. Claims, landings and
    HANDOFF writes take one repo-wide lock, so two sessions that finish together land
    one after the other instead of colliding. On a conflict, the session rebases its
    own branch onto the new main in its worktree, resolves, re-runs the suite and
    lands, reporting each conflict it resolved; it stops for the user only if the suite
    is red after resolving. This replaces /land's "never auto-resolve" rule.
  - R3 — once a branch lands, its worktree and branch are removed. /checkpoint's audit
    flags any worktree whose branch is merged or whose claim is gone.
  - Out: remotes, PRs and merge queues; auto-*shipping*. Landing stays separate from
    acceptance, and `shipped` still waits for you.
- **Accept:**
  - From `/implement P#` until it has landed on main, I type no git command and answer
    no git question, unless two changes genuinely conflict.
  - Two sessions started at once on two different entries each get their own branch
    and worktree, and both end up merged on main.
  - Two sessions finishing at the same moment land one after the other: main shows
    both merges, and the suite is green after each.
  - Once an entry has landed, `git worktree list` no longer shows its worktree, and
    its branch is gone.
- **Depends on:** P16 — without it, every worktree session runs with the main
  checkout's guards.
- **Notes:** The claim and the landing happen after the session leaves its worktree
  for the main checkout (ExitWorktree `keep`), under the lock: an EnterWorktree-isolated
  session is refused git commands aimed at another checkout (`git -C <main>`), and
  some `rtk`-rewritten git commands (*observed* during the OD-6/OD-7 probes,
  2026-10-15). The main checkout becomes integration-only; hand-edit it while sessions
  run and landings stop at the clean-tree check. P12 doesn't block this, but if it
  lands first, the lock and claim helpers use its trunk command rather than `main`.

### P17 — An orchestrator that builds non-conflicting entries in parallel
- **Status:** proposed
- **Drafted:** 2026-10-15
- **Value:** one request builds several entries at once. P15 lets you run parallel
  sessions, but you still pick the entries, start each session, and keep track of
  them. Here one session does the picking, the dispatching, and the landing order.
- **Scope:**
  - Pick: from `## Next up`, the entries whose claim gate passes and whose predicted
    footprints don't overlap (OD-8). Say what was picked and what was skipped, and why.
  - Dispatch: one worktree-isolated subagent per picked entry, running /implement →
    /verify. P15's machinery handles the claim and the worktree.
  - Gates that need the owner (a rescope, a milestone choice, a stale premise): the
    subagent stops and returns the question instead of guessing. The orchestrator
    relays it while the others keep going.
  - Land: through P15's lock, one at a time, collecting each per-criterion report.
  - Out: auto-shipping (acceptance stays yours); picking from outside `## Next up`.
- **Accept:**
  - I say "build what's ready" once; it names which entries it picked, which it
    skipped and why, and starts one subagent per picked entry.
  - None of the entries it ran together hits a merge conflict when landing.
  - When a subagent reaches a gate that needs me, I get the question from the
    orchestrator and the other builds keep going.
  - Each landed entry comes back with its per-criterion report, and none is flipped
    `shipped` without my word.
- **Depends on:** P15, OD-8, OD-9
- **Notes:** If subagents are handed /implement as pasted text rather than invoking
  it, OD-4 applies to them too.

---

## Epic: The checking machinery

The suite's own tooling — the checks the skills orient off. Work here is not
user-facing, but a silent failure in it is invisible everywhere else.

### P9 — Anchor the field probes, and decide about non-entry headings
- **Status:** proposed
- **Drafted:** 2026-08-03
- **Value:** two silent-failure classes leave the keystone check. An entry that
  *describes* a field stops being read as *carrying* it, and a prose section
  heading stops being handled by accident. Both fail green today, which is the
  worst way for a check to be wrong.
- **Scope:**
  - Anchor every field probe and accessor to a field line, using the idiom
    `Accept` already uses (`/^\s*-\s+\*\*Label\b/`). Both tracked docs, presence
    probes and the `labelled`-driven accessors alike.
  - Derive that list from the config rather than restating it here, and test it
    by walking the probes — so a probe added later is covered without anyone
    remembering to.
  - Make "this is a section heading" an explicit decision rather than a
    by-product of the ID-capture regex needing whitespace after the ID.
    Recognise any `###` line, then separate a section header from an entry with
    a broken heading, and say which.
  - Out: changing the entry format, and which fields are required. This is how
    fields and entries are *found*, not what they are.
- **Accept:**
  - An entry whose prose names `**Depends on:** OD-n` still has its real
    dependency read, and is still blocked by that OD if it is open.
  - An entry that names a required field in prose but does not carry it is
    rejected — for every field, in both tracked docs.
  - A section heading is skipped whether it is one word or several, and is never
    reported as a malformed entry.
  - A genuinely malformed entry heading (an ID with no em-dash) is still
    reported — the parser must not go quiet to achieve the above.
- **Depends on:** —
- **Notes:** found mid-build during P4 R0, which fixed the `Accept` probe only
  and left a test as the idiom. Severity is not uniform — rank `Depends on:`
  first: it drives the OD-blocking gate, and `labelled` takes the *first* match,
  so prose above the real field wins. `Resolves:` is second (the spike↔OD
  pairing). The design to preserve is **parse loosely, validate strictly**: the
  parser accepts anything heading-shaped so a typo'd heading gets *caught*
  rather than skipped. Tightening the parse would widen the hole, not close it.
  Verified 2026-08-03 that skipping one-word headings is a side effect, not a
  decision — no test and no comment holds it.
  **This entry demonstrates its own bug.** The first `Accept:` criterion above
  names `**Depends on:**` in prose, so `labelled` locks onto that line and never
  reads this entry's real `Depends on:` field. It is harmless only by
  coincidence — `OD-n` has a letter where the ID pattern wants a digit, and the
  real field is empty anyway — so nothing fails today. Verified 2026-08-03 by
  running `labelled` against this entry's body. Do not "fix" the criterion to
  make the demonstration go away; fix the probe, and keep this entry as the
  regression case.

### P11 — The dependency graph as a JSON contract
- **Status:** proposed
- **Drafted:** 2026-10-15
- **Value:** what blocks what is computable from the entries' dependency fields, but
  nothing computes it; groom and any status view would re-derive it by hand. A fixed
  JSON shape lets one renderer serve every repo running the suite, whatever language
  its checker is in.
- **Scope:** port photocull's `--graph` / `--graph --json` mode to the schema check
  (ranked unblocked items, chains, prose blockers; entries, edges with their field,
  prose blockers), the same JSON shape pinned by a test, and the Feeds/Waiting-on
  consistency rule. Out: rendering; that is P7.
- **Accept:**
  - the graph mode lists what can start now, most-unblocking first, and the chain
    behind each blocked item
  - its JSON matches photocull's shape, and a test fails if the shape drifts
- **Depends on:** P10

### P12 — Resolve the trunk branch instead of assuming `main`
- **Status:** proposed
- **Drafted:** 2026-10-15
- **Value:** a porter whose trunk isn't `main` gets a working claim gate on day one.
  Today /implement's claim gate runs `git show main:…`, which errors on such a clone
  (verified on this repo before it consolidated: `fatal: invalid object name 'main'`).
- **Scope:**
  - One resolution rule, already written: session-audit.mjs's order (`--base`, else
    main/master/trunk, else fail loudly). Expose it as a command the skills call,
    rather than restating the list in prose.
  - /implement, /ship, /land and /checkpoint say "trunk" and get it from that command;
    the claim gate reads `git show <trunk>:…`.
  - A process test fails if a loop skill hard-codes `main` in a git command.
  - Out: renaming branches; any trunk config beyond what `--base` allows.
- **Accept:**
  - In a clone whose only branch is `master`, /implement's claim gate reads master's
    backlog and finds an existing in-progress claim.
  - In a clone with no recognisable trunk, the claim gate stops and says how to name
    one, rather than passing.
  - Writing `git show main:` back into any loop skill fails `npm test`.
- **Depends on:** —
- **Notes:** Found during P4 R1. Not live here since this repo consolidated on `main`
  (2026-10-15); a portability defect for porters. Filed as a feature because P5's
  defect class isn't built.

### P14 — Test subprocesses inherit git's hook environment
- **Status:** shipped
- **Drafted:** 2026-10-15
- **Value:** the pre-commit gate stops rejecting good commits. Under `git commit -a`,
  git hands the hook `GIT_INDEX_FILE`; the suite's subprocesses inherit it, so fixture
  repos commit against the outer repo's index and 3 tests fail on correct code. A gate
  that is red for the wrong reason teaches people `--no-verify`, which then skips it
  when it's right.
- **Scope:**
  - In: every subprocess the tests start (fixture git calls, the scripts they run
    against fixture repos, the hook runs) gets an environment with git's `GIT_*`
    variables removed — once, in the shared test helper, not per call site.
  - In: a regression test that runs a fixture with `GIT_INDEX_FILE` set.
  - Out: the scripts' own runtime behaviour outside tests.
- **Accept:**
  - `GIT_INDEX_FILE=.git/index.fake npm test` passes, same as without it.
  - `git commit -a` on a change that leaves the suite green is accepted by the
    pre-commit hook.
  - Removing the env stripping makes the new regression test fail — it bites.
- **Depends on:** —
- **Shipped:** 2026-10-15 — accepted by the user; all three criteria observed.
- **Notes:** Found during P4 R2; *verified* by reproduction (`GIT_INDEX_FILE` set →
  5 failures across process and session-audit tests; unset → all pass). Filed as a
  feature because P5's defect class isn't built. **Landed 2026-10-15** (merge 8fd218c),
  single milestone; stays `in-progress` awaiting acceptance against the per-criterion
  report in 38ca310.

### P16 — Hooks guard the worktree a session is in, not the checkout it launched from
- **Status:** in-progress
- **Drafted:** 2026-10-15
- **Value:** human-owned docs stay protected in parallel sessions. In a worktree
  session today, the hooks run main's scripts (OD-7, refuted): anything under
  `docs/dev_notes/` can be written, and the schema check validates main's backlog
  instead of the branch's.
- **Scope:**
  - In: the edit-guard judges each path against the checkout that contains it; the
    PostToolUse checks run against the session's current worktree.
  - In: a test that runs the guard on a path inside a nested worktree and expects a
    folder pattern to block it.
  - Out: changes to the blocklist syntax.
- **Accept:**
  - In a worktree session, writing a new file under `docs/dev_notes/` is blocked, as
    it is in the main checkout.
  - In a worktree session, an edit that breaks that worktree's backlog schema is
    flagged by the in-session check.
  - Removing the fix makes the new test fail.
- **Depends on:** —
- **Notes:** Found by the OD-7 probe, 2026-10-15. Live without P15, since the GUIDE
  already recommends worktrees. Filed as a feature because P5's defect class isn't
  built.
  Landed 2026-10-16 (merge 05a73ff); stays `in-progress` until accepted. The
  per-criterion report is in commit 85c4eaf's message.

---

## Epic: What the loop tracks

The kinds of thing the tracked docs hold, and where each one goes.

### P10 — Port the assumptions/decisions split and experiment kinds from photocull
- **Status:** proposed
- **Drafted:** 2026-10-14
- **Value:** three misclassifications the suite currently forces, found by running it
  on photocull. Only confirmatory tests are admitted to the research track, so
  measurements and exploratory probes land in the assumptions register. The register
  is named for decisions but holds assumptions, so real decisions (choices the product
  owner makes) have no home and hide inside features and experiment objectives. A
  measurement's threshold for acting sits on the experiment, though it belongs to the
  decision it informs.
- **Scope:**
  - Rename OPEN_DECISIONS to an assumptions register (`A-n`): yes/no facts about the
    outside world, settled by observation.
  - Add a decisions register (`D-n`): open choices with options, what they wait on and
    a decision rule; decided ones with the choice, why and what would reopen them.
    /triage gains a route for it.
  - Each doc moves with its checker and the skills' greps in the same commit.
  - Out: photocull-specific parts (blind picks, scope vocabulary), and experiment
    kinds, which move to **P13** with the research track they belong to. The old
    "master vs build-only" question is settled: master's track was retired 2026-10-15
    (tag `measurement-track`), and P13 rebuilds one from photocull's.
- **Accept:**
  - A "should we find out how often X happens" idea has one obvious home and /triage
    routes it there.
  - A choice only I can make is listed somewhere I can see at a glance, with what it
    is waiting on.
  - The schema check rejects an entry that depends on an open decision being queued
    in Next up.
- **Depends on:** —
- **Notes:** waits on the same change landing in photocull and being exercised once
  per new shape (one measure run, one decision taken, one assumption resolved). The
  dependency is cross-repo, so it lives here in prose: the schema check would read a
  photocull ID as a local one. Port from the checklist below, not from memory.

  **Porting checklist** (landed in photocull 2026-10-15, commits d82e902, a5d6c45,
  ceca3cb, 8665884, eb43d7e, 5fb167c, 8179fef; read those diffs, not this summary,
  for the exact wording). Generic, in this order, one green commit each:
  1. Rename the register to assumptions, A-n. Checker config, ID
     regex, the open-dependency gate's prefix, docstring, test fixtures, every doc
     link and skill mention, one commit. Add a provenance line mapping old numbers to
     new. The schema check's entry count must not change: that is the proof the
     rename lost nothing.
  2. Decisions register, D-n. Statuses open / decided / superseded.
     Options always; Waiting on while open; a Decision rule whenever it waits on an
     experiment. Decided needs a dated Decided line plus Why, Leads to and Reopen if.
     Leads to naming a closed feature must lead with `shipped` (the old Deploys-as
     check, moved). Superseded names an existing decision. An open decision blocks
     queueing and claiming exactly like an open assumption; Waiting on IDs must
     exist; staleness reads the Decided date. Seed one real entry in the same commit,
     because an empty tracked doc fails the check. Triage gains a routing question;
     ship holds the pen.
  3. *Not here — lands in P13.* Experiment kinds. A Kind vocab line in the framework; per kind, a
     test owes Hypothesis, Feeds and Power, a measure owes Precision, a probe owes a
     Budget. Feeds must name an existing decision that carries its rule while both
     are open (this holds the start gate mechanically). `answered` replaces won and
     no-win; Deploys as goes; the spike exit accepts shipped or answered. The stats
     helper gains a precision mode (interval at n; n for a target half-width).
  4. A `moved` terminal status for assumptions: the Resolution must name an existing
     new home, and no open entry may depend on a moved one.
  5. Triage routing becomes: yes/no fact about the world, choice, question answered
     from data (with a kind), else feature; "does our own code work" is a feature's
     acceptance, a test or a verify run, never an entry.
  Local to photocull, do not port: blind picks, the people/scenery scope vocab, the
  actual entries (D-1 to D-12, P32, X8).
  Learned during the photocull pass: a script that re-wraps prose after a rename must
  treat indented code fences as fences (one split a command), and should be followed
  by a scan for inline code spans split across lines (an odd backtick count on a
  line, compared against the starting commit). This repo's README quotes the schema
  check's entry count and a process test compares the two, so every added or removed
  entry means editing the README: fold a fix for that into this work.

### P13 — A research track, ported from photocull
- **Status:** proposed
- **Drafted:** 2026-10-15
- **Value:** claims a test can't catch — "it's faster", "the ranking is better",
  "how often does X happen" — get a home with a discipline, instead of landing as
  features with invented Accept criteria or as assumptions with no way to measure them.
- **Scope:** milestones.
  - R0: the docs and their checker — framework (three kinds: test / measure / probe,
    and what each owes), experiment backlog (`X#`), append-only run log, findings with
    confidence labels. The schema check learns the shapes; an empty doc must not pass.
  - R1: the /research skill (sole writer of docs/research/) and the stats helper,
    ported to Node.
  - R2: /triage routes measurable questions to the research backlog by kind; the
    skill count and every doc that states it move to seven.
  - Out: photocull's harnesses and its domain scope vocabulary.
- **Accept:**
  - A "how often does X happen" idea lands in the research backlog as a measure, and
    /triage routes it there.
  - A test experiment without a pre-registered decision rule is rejected by
    `npm run check:docs`.
  - Every finding carries a confidence label and names the logged run it came from.
  - `npm test` passes on a fresh clone with no Python installed.
- **Depends on:** P10
- **Notes:** "Probably what photocull has" is the user's direction, not a settled
  choice — confirm the shape at claim time. Takes back the experiment kinds P10
  dropped on 2026-10-15. Port from photocull's FRAMEWORK.md and research skill,
  read fresh, not from this summary.
