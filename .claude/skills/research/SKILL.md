---
name: research
description: Run the project's measurable experiments end to end — propose an experiment (X#), start it, run it, record the run (N#), distil a finding (F#), and close the experiment — enforcing the discipline in docs/research/README.md. Use for "run experiment X1", "is the new version actually faster", "how often does X happen", "record the results", "add a finding", "what research is open", or /research. Sole writer of docs/research/.
---

# Research — the experiment loop

Operates the experiment loop in [docs/research/](../../../docs/research/README.md).
**The framework README is the authority** for the three kinds, the stats rules and the
confidence labels; each register's README owns its template and its vocab line. Read
them if unsure, and don't fork their rules here.

The loop: **experiment → run → record the run → distil a finding → close the
experiment.** Work out which phase the user is in and run that phase. `<ID>` = an
experiment id like `X1`.

**Single-writer contract:** this skill is the only writer of the research records —
every experiment, run and finding under [docs/research/](../../../docs/research/README.md).
/ship never touches them.

**Write gate.** The track's evidence standard applies to prose claims about the code
too. For a negative, use `node scripts/grep-checked.mjs --control '<known match>' …`
(LESSONS L1). Write no exhaustive inventories in prose. Say whether a claim is
*mechanically enforced*, *verified* (how), or *asserted*.

Map:
- [experiments/](../../../docs/research/experiments/README.md): `X#.md`, the questions we intend to answer.
- [runs/](../../../docs/research/runs/README.md): `N#.md`, one file per run, **append-only**.
- [findings/](../../../docs/research/findings/README.md): `F#.md`, what we now believe, each with a confidence label.
- Stats: `node scripts/stats.mjs` (below).
- Shape: `npm run check:docs` holds every header, section and cross-reference the
  registers' READMEs list.

**Decisions are /ship's.** The decisions an experiment feeds live in
[docs/decisions/](../../../docs/decisions/README.md). This skill drafts a decision's
`## Decision rule` (through /triage, then /ship) and reports what the rule says after a
run, but never records the decision.

**Orient by header, not by reading whole files.** Each record keeps its state in its
header, so a grep over the headers is the whole read.

## Phase 0: orient (`/research`, "what's open")
`grep -H "^status:\|^kind:\|^feeds:" docs/research/experiments/X*.md` is the whole
orientation read; open the full file only for the ID you'll work on. Report what's
`active`, what's `proposed`, and any `active` experiment that no run names yet:
`node scripts/grep-checked.mjs --control '^id: X' '^experiment: <ID>$' docs/research`
(the control is the experiment's own header, so it always matches; exit 1 means no
run names it, exit 2 means the search never worked). An empty register is a
legitimate state, not a broken one; say it's empty. Change nothing.

## Phase P: propose (a new experiment, usually from /triage)
Write `docs/research/experiments/X#.md` (the next free number) from the experiments
README's template: `status: proposed`, a `kind:`, today's `drafted:`. Give it what its
kind owes (framework, "The three kinds"):
- `test`: `## Hypothesis` and `## Power` (from `stats.mjs --power`), its plan as `n:`,
  `bar:` and `effect:` in the header, and `feeds:` the decision it gates. That decision's `## Decision rule` (metric, threshold, what each
  side means) and its `waiting_on:` naming this `X#` are drafted through /triage →
  /ship, **before** any result exists.
- `measure`: `## Precision` (from `stats.mjs --precision`); if a decision waits on it,
  `feeds:` that decision, with its rule written the same way.
- `probe`: `## Budget`, what it may spend before it stops.

Name the external readout the method uses (the user's judgement, a known ground
truth), never another of our own scores (stats rule 3). Where the inputs differ from
the question (one source, one machine), say so in `## Method`. Run
`npm run check:docs` before handing back.

## Phase 1: run (`/research run <ID>`)
1. **START GATE**, by kind:
   - `test`: every `D-n` in `feeds:` carries its `## Decision rule`, written before any
     result exists, and the header's `n:` can detect its `effect:` at its `bar:`.
     `npm run check:docs` checks both; don't compute it by hand. Check that `bar:`
     is the threshold the rule actually names: that match is judgement, not code.
   - `measure`: `## Precision` is planned; if it `feeds:` a decision, that rule is
     written too.
   - `probe`: `## Budget` says what it may spend; its results will be `directional`
     only.

   If any of this is missing, stop and settle it with the user first: a rule written
   after the numbers are in fits the numbers. Check `depends_on:` too: an open
   assumption or decision, or an unshipped `P#`, blocks the run, exactly as it blocks
   a build.
2. **Check the readout exists.** If the method needs the user's judgement (labels,
   picks, a ground truth), count what's there before running. If there isn't enough
   for the planned n, the next step is asking the user for it, not running on what
   exists.
3. Flip the experiment to `active` (this skill writes it).
4. Run it. **Never change the project's shipped defaults for a run**: express arms as
   script arguments or a scratch copy of the code under test. Record the exact command
   and commit. Per-input numbers go in a results file the run names; a new tracked file
   has to be classified in `scripts/manifest.mjs`, or `npm test` fails. Wrap anything
   slow in `time`.

## Phase 2: record (`/research record`)
Write a new `docs/research/runs/N#.md` (the next free number) from the runs README's
template: `ran:`, `experiment:`, `## Measured under` (commit, inputs, versions, the
exact command, and which stages were oracle — stats rule 5), `## Results`, `## Read`.
- **Append-only:** never edit an earlier run to fit what was learned since. A wrong run
  stays, flipped to `retracted`, with a line in its `## Read` saying why.
- **No synthesis here:** conclusions go to findings.
- Every interval and p-value comes from `stats.mjs`, pasted verbatim.

## Phase 3: stats
```
node scripts/stats.mjs HITS N --null 0.5                       # share, Wilson 95% CI, one-sided z
node scripts/stats.mjs --pool 12/20 9/14                       # pool batches
node scripts/stats.mjs --power --bar 50 --n 30                 # minimum detectable share at n
node scripts/stats.mjs --power --bar 50 --effect 80            # n needed for an effect
node scripts/stats.mjs --precision --expect 85 --n 80          # a measure's interval at n
node scripts/stats.mjs --precision --expect 85 --halfwidth 8   # n for +/- 8 points
```
For paired arms, HITS = the inputs where they disagree that arm (a) wins, and N = all
the inputs where they disagree (stats rule 4). It warns under n = 30: directional only.

## Phase 4: distil and close (`/research findings`)
1. Write or update the finding as `docs/research/findings/F#.md`, from the findings
   README's template: the claim with the n and inputs it rests on, `runs:` naming the
   run it came from, a `confidence:` from the vocab, and `## So what`. A retracted
   claim stays, flipped to `retracted`, its `## So what` saying what replaced it.
2. **CLOSE GATE:** flip the experiment to its terminal status (`answered` once it ran
   cleanly, whatever it found), and add `closed:` and `runs:` to its header.
3. **Feeds a decision?** For each `D-n` in `feeds:`, apply its `## Decision rule` to
   the result as written, and report the outcome to the user and to **/ship** ("X2's
   lower bound is 74%: D-3's rule says keep v0"). /ship records the decision once the
   user takes it; what it leads to is the decision's `leads_to:`, not this skill's.
   - **Replicate before changing a shipped default:** if the rule says change one, pool
     a second batch before closing, or label the finding `significant` and propose the
     replication as a new experiment.
   - **Staleness sweep:** if the change moves a quantity other findings rest on, grep
     the findings for it and list what needs re-checking.
4. Run `npm run check:docs`.

## Discipline checklist
- [ ] Kind set; test: each fed decision's rule written, and reachable at the planned n,
  before `active`; measure: precision planned; probe: budget set
- [ ] Readout counted before running; the external judgement, not an internal score
- [ ] Oracle stages named in the run
- [ ] Stats from `stats.mjs`; directional under n = 30 or from one source
- [ ] Shipped defaults untouched by a run; command + commit recorded
- [ ] Runs append-only; synthesis in findings
- [ ] Close: terminal status, `closed:`, `runs:`; each fed decision's rule outcome
  reported to /ship; replication and staleness sweep

## Not this skill
- Recording a decision, or any backlog edit → **/ship**.
- Classifying a raw idea → **/triage**.
- Whether our own code works → a feature's `Accept:` or a test, not an experiment.
