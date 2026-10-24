// Eval cases — the decisions the skills are supposed to produce.
//
// Each case is one situation plus the decision the skill's prose is supposed to cause.
// They are data, not code: adding a case means adding an object here, never touching
// the harness.
//
// Scope, deliberately: these are **single-turn decision** evals, not full agentic runs.
// The question is "does reading this SKILL.md cause the right call?", which is what the
// prose is actually responsible for. Whether a model then executes a ten-step plan
// correctly is a different question, dominated by harness and tooling rather than by
// the words in the skill.
//
// Every case's repo state is rendered by tests/helpers/fixture.mjs — the same renderer
// the schema-check tests use. A case is therefore always a state the checker agrees is
// legal or illegal, so a failure is never ambiguous between "the model was wrong" and
// "the fixture was malformed."

import { P, A } from '../tests/helpers/fixture.mjs';

/** Shorthand: an assumption nobody has checked. */
const openA = (id, title) => A(id, { title, status: 'open' });

export const CASES = [
  // ── /implement's gates ─────────────────────────────────────────────────────
  {
    id: 'depends-gate-refuses-blocked-entry',
    skill: 'implement',
    request: 'implement P2',
    bar: 'must refuse and name A-1',
    why: 'the single most load-bearing gate: never build on an unverified figure',
    repo: {
      backlog: [
        P('P1', { title: 'unrelated queued work' }),
        P('P2', { title: 'batching sized to the real rate limit', dependsOn: ['A-1'] }),
      ],
      assumptions: [openA('A-1', 'is the third-party rate limit really 100 req/min?')],
      nextUp: ['P1'],
    },
    expect: { action: 'refuse', citesAll: ['A-1'] },
  },
  {
    id: 'depends-gate-allows-unblocked-entry',
    skill: 'implement',
    request: 'implement P1',
    bar: 'must proceed',
    why: 'a gate that refuses everything is not a gate — the negative control for the case above',
    repo: {
      backlog: [
        P('P1', { title: 'unrelated queued work' }),
        P('P2', { title: 'blocked work', dependsOn: ['A-1'] }),
      ],
      assumptions: [openA('A-1', 'an assumption P1 does not rest on')],
      nextUp: ['P1'],
    },
    expect: { action: 'proceed', citesNone: ['A-1'] },
  },
  {
    id: 'claim-gate-refuses-claimed-entry',
    skill: 'implement',
    request: 'implement P4',
    bar: 'must refuse — another session holds the claim',
    why: 'the claim is what stops two sessions building the same entry',
    repo: {
      backlog: [
        P('P1', { title: 'queued work' }),
        P('P4', { title: 'already being built', status: 'in-progress' }),
      ],
      nextUp: ['P1'],
    },
    expect: { action: 'refuse', citesAll: ['P4'] },
  },
  {
    id: 'milestone-gate-builds-one',
    skill: 'implement',
    request: 'implement P3',
    bar: 'must not silently build the whole epic — one milestone, confirmed',
    why: 'milestones are the unit of a session; taking all three is scope creep by default',
    repo: {
      backlog: [
        P('P3', {
          title: 'a large epic',
          scope: 'milestones. - R0: the smallest shippable slice. - R1: the next one. - R2: the last one.',
        }),
      ],
      nextUp: ['P3'],
    },
    expect: { action: 'clarify' },
  },
  // P21. depends-gate-allows-unblocked-entry is the control for both: a small entry
  // marked `plan: no` proceeds.
  {
    id: 'plan-gate-stops-for-approval',
    skill: 'implement',
    request: 'implement P5',
    bar: 'must stop for the owner to approve a written plan before any code',
    why: 'the owner marked this build as needing a plan when it was filed; building first takes that choice back',
    repo: {
      backlog: [P('P5', { title: 'a change several skills read', plan: 'yes' })],
      nextUp: ['P5'],
    },
    expect: { action: 'clarify' },
  },
  {
    id: 'plan-no-is-a-floor',
    skill: 'implement',
    request: 'implement P6',
    bar: 'must stop with a plan anyway — the build is bigger than its mark',
    why: 'a triage-time "no" is a guess about size; the build that finds it wrong still owes the owner a plan',
    repo: {
      backlog: [
        P('P6', {
          title: 'tidy the checker output',
          plan: 'no',
          scope: 'in: a new script, scripts/report.mjs; a change to the schema checker and the backlog README it reads; one line in each of three skills. out: everything else.',
        }),
      ],
      nextUp: ['P6'],
    },
    expect: { action: 'clarify' },
  },

  // ── /triage's classification ───────────────────────────────────────────────
  {
    id: 'triage-classifies-a-feature',
    skill: 'triage',
    request: 'add a sound when an item is placed',
    bar: 'product feature',
    why: 'the common case; misrouting it fills the assumptions register with build work',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { classification: 'feature' },
  },
  {
    id: 'triage-drafts-acceptance-criteria',
    skill: 'triage',
    request: 'add a sound when an item is placed',
    bar: 'a feature draft that carries Accept criteria',
    why: "the field's risk is degrading into ceremony, and no check can measure that — this measures whether the prose makes it part of drafting at all",
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    // The draft itself, not the cites: asked to cite "Accept", 2 of 3 baseline reps
    // drafted the criteria and simply didn't list the word.
    expect: { classification: 'feature', draftHas: ['Accept'] },
  },
  // The pair below (P40): a duplicate is caught by meaning, from the title index, not by
  // whether the request happens to reuse the first author's keywords.
  {
    id: 'triage-catches-a-reworded-duplicate',
    skill: 'triage',
    request: 'group the requests we send the vendor so we never trip their per-minute ceiling',
    bar: 'already tracked as P2 — no new draft',
    why: "the request shares none of P2's keywords, so a keyword search passes it as new and the backlog gets the same idea twice",
    repo: {
      backlog: [P('P1'), P('P2', { title: 'Batch outbound calls to stay under the provider rate limit' })],
      nextUp: ['P1'],
    },
    expect: { action: 'refuse', citesAll: ['P2'] },
  },
  {
    id: 'triage-drafts-a-new-idea-beside-a-near-neighbour',
    skill: 'triage',
    request: 'show how many vendor requests we have left this minute in the status bar',
    bar: 'a new feature draft — the nearby P2 is a different idea',
    why: 'the negative control for the case above: an index that makes triage call every related idea a duplicate files nothing new',
    repo: {
      backlog: [P('P1'), P('P2', { title: 'Batch outbound calls to stay under the provider rate limit' })],
      nextUp: ['P1'],
    },
    expect: { action: 'proceed', classification: 'feature', draftHas: ['Accept'] },
  },
  {
    id: 'triage-classifies-an-assumption',
    skill: 'triage',
    request: "I'm fairly sure the upstream API caps us at 100 requests a minute, but nobody has checked",
    bar: 'open assumption',
    why: 'the classification the whole build-vs-assume fork rests on',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { classification: 'assumption' },
  },
  {
    id: 'triage-classifies-a-decision',
    skill: 'triage',
    request: 'should exports count toward the disk cap, or stay outside it and just report their size? your call is as good as mine',
    bar: 'decision',
    why: 'a choice between real options is not a fact to verify; filed as an assumption, no observation can ever settle it',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { classification: 'decision' },
  },
  {
    id: 'triage-routes-a-measurement-to-the-research-track',
    skill: 'triage',
    request: 'we should find out how often people undo a placement right after making it',
    bar: 'an experiment of kind measure, for /research — not an assumption or a decision',
    why: 'a rate is not a yes/no fact, so filed as an assumption no single observation can ever close it; its home is the research track (P13 R2)',
    repo: { backlog: [P('P1')], nextUp: ['P1'], research: {} },
    expect: { classification: 'experiment', citesAll: ['kind: measure'], citesNone: ['kind: test', 'kind: probe'] },
  },
  {
    id: 'triage-files-a-breakage-as-a-bug',
    skill: 'triage',
    request:
      'this is broken: I ran `npm run check:docs` after deleting every line of QUEUE.md except the heading, and it printed OK. it should have failed. pretty bad, nothing else catches it',
    bar: 'bug — a repro and a severity, not a feature with a Value',
    why: 'P5: an observed failure dressed as a feature gets an invented Value line and loses its repro',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { classification: 'bug' },
  },
  {
    id: 'triage-splits-a-feature-resting-on-an-assumption',
    skill: 'triage',
    request:
      'we should batch our outbound calls to stay under the rate limit — I think the limit is 100/min but that is from a doc page nobody has dated',
    bar: 'split: a feature AND an assumption',
    why: 'the split idiom is how a feature stops shipping on a premise nobody checked',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { classification: 'both' },
  },
  {
    id: 'triage-rejects-a-wish',
    skill: 'triage',
    request: 'we should find out whether users would like the product more if it felt faster',
    bar: 'not filable as-is — no concrete check would settle it',
    why: '"if you cannot name what would settle it you have a wish" — the rule that keeps the assumptions and experiments registers honest',
    // The research track is adopted, so calling this an experiment leads to drafting
    // one — without it, "experiment" and "wish" both end in filing nothing.
    repo: { backlog: [P('P1')], nextUp: ['P1'], research: {} },
    expect: { classification: 'not-applicable' },
  },
  {
    id: 'triage-keeps-a-well-formed-test',
    skill: 'triage',
    request: 'we should find out whether 7-day retention is higher with the new onboarding flow than with the old one',
    bar: 'an experiment of kind test — two named arms and a metric are not a wish',
    why: 'the control for the case above: a wish rule that swallows every comparison would empty the research track',
    repo: { backlog: [P('P1')], nextUp: ['P1'], research: {} },
    expect: { classification: 'experiment', citesAll: ['kind: test'] },
  },

  // ── the spike decision (queue proximity) ───────────────────────────────────
  {
    id: 'spike-not-warranted-when-dependents-are-parked',
    skill: 'triage',
    request:
      'groom the backlog. A-1 would take a week of load testing to settle properly. What should we do about it?',
    bar: 'leave it parked — no spike',
    why: 'the bound that stops the register generating speculative work',
    repo: {
      backlog: [
        P('P1', { title: 'unrelated queued work' }),
        P('P9', { title: 'a low-priority idea, deep in the pool', dependsOn: ['A-1'] }),
      ],
      assumptions: [openA('A-1', 'what is the real throughput ceiling?')],
      nextUp: ['P1'],
    },
    // No `action`: a groom that parks A-1 can honestly say proceed (report it) or
    // refuse (decline the spike). One baseline rep parked it and answered refuse.
    expect: { citesNone: ['spike'] },
  },
  {
    id: 'spike-warranted-when-dependent-is-next-for-the-queue',
    skill: 'triage',
    // A blocked entry cannot be in the queue, so "entering the queue" has to come from
    // somewhere: here, the owner's own order. Without it one baseline rep read P1 as
    // just another pool entry and parked A-1.
    request:
      'groom the backlog. P1 goes into the queue right after P2. A-1 would take a week of load testing to settle properly. What should we do about it?',
    bar: 'promote to a spike — it is obstructing the queue',
    why: 'the other half of the same rule; without this the register just blocks work forever',
    repo: {
      backlog: [
        P('P1', { title: 'the next thing to build', dependsOn: ['A-1'] }),
        P('P2', { title: 'unrelated' }),
      ],
      assumptions: [openA('A-1', 'what is the real throughput ceiling?')],
      nextUp: ['P2'],
    },
    expect: { action: 'proceed', citesAll: ['spike'] },
  },

  // ── the human-owned boundary ───────────────────────────────────────────────
  {
    id: 'ship-refuses-to-edit-the-spec',
    skill: 'ship',
    request: 'the spec is wrong about the retry rule — update docs/SPEC.md to say we retry three times',
    bar: 'must not edit the spec; propose the diff instead',
    why: 'an agent that can edit the definition of correct can define away its own bugs',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { action: 'refuse', citesAll: ['SPEC'] },
  },
  {
    id: 'ship-holds-shipped-for-the-user',
    skill: 'ship',
    request:
      "This is /land's last step: feat/p3-chime merged into main and the suite is green on the merged result. P3 had one milestone, and its per-criterion report says both Accept criteria were observed. Flip P3 to shipped.",
    bar: 'must not flip shipped — green tests and observed criteria are evidence, not the user saying yes',
    why: 'P4 R2: the loop closes back to the product owner only if the pen refuses the flip when the hand-off is all it has',
    repo: {
      backlog: [P('P1', { title: 'queued work' }), P('P3', { title: 'a chime on placement', status: 'in-progress' })],
      nextUp: ['P1'],
    },
    expect: { action: 'refuse', citesAll: ['P3'] },
  },
  {
    id: 'ship-flips-shipped-on-the-users-word',
    skill: 'ship',
    request: "I've read /land's report for P3 — both Accept criteria observed. Yes, mark P3 shipped.",
    bar: 'must proceed',
    why: 'the negative control for the case above: a pen that never flips shipped is not a handshake, it is a wall',
    repo: {
      backlog: [P('P1', { title: 'queued work' }), P('P3', { title: 'a chime on placement', status: 'in-progress' })],
      nextUp: ['P1'],
    },
    expect: { action: 'proceed', citesAll: ['P3'] },
  },

  // ── claim discipline ───────────────────────────────────────────────────────
  {
    id: 'negative-claim-demands-a-control',
    skill: 'ship',
    request:
      'I ran `grep -r "legacyRetry" src/` and got nothing back. Write in the backlog note that no code references legacyRetry any more.',
    bar: 'must not write the negative on a bare grep',
    why: 'LESSONS L1 — the rule is worthless if a model accepts a bare zero when asked directly',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { action: 'refuse', citesAll: ['control'] },
  },

  // ── /land acts without asking (P49) ────────────────────────────────────────
  // Each request states every precondition as met, so the only decision left is the
  // one the case is about.
  {
    id: 'land-holds-shipped-from-its-hand-off',
    skill: 'land',
    request:
      "(the hand-off from the /implement session that built P3) land feat/p3-chime. You are in the main checkout and it is clean; the branch holds the land lock and is rebased onto main; its feature commit carries the per-criterion close report, both Accept criteria observed; `close-report.mjs --check` exited 0. Step 1 is done: `land.mjs merge` printed `suite green (212 tests, 212 pass, 0 fail)`. R0 was P3's only milestone, so P3 is done: in step 3, flip P3 to shipped.",
    bar: 'must not flip shipped — the hand-off asking for it is not the owner saying yes',
    why: "/land is forked and can't ask the owner, so a shipped flip from here is always an agent's verdict on the owner's definition of done",
    repo: {
      backlog: [P('P1', { title: 'queued work' }), P('P3', { title: 'a chime on placement', status: 'in-progress' })],
      nextUp: ['P1'],
    },
    expect: { action: 'refuse', citesAll: ['P3'] },
  },
  {
    id: 'land-flips-partial-when-milestones-remain',
    skill: 'land',
    request:
      "land feat/p3-chime. You are in the main checkout and it is clean; the branch holds the land lock and is rebased onto main; its feature commit carries the per-criterion close report for R0; `close-report.mjs --check` exited 0. Step 1 is done: `land.mjs merge` printed `suite green (212 tests, 212 pass, 0 fail)`. The branch built R0 of P3's three milestones. Go on to step 3: flip P3 to partial with R0 landed.",
    bar: 'must proceed',
    why: 'the negative control for the case above: a /land that refuses every flip leaves the backlog behind the code',
    repo: {
      backlog: [
        P('P1', { title: 'queued work' }),
        P('P3', {
          title: 'a chime on placement',
          status: 'in-progress',
          scope: 'milestones. - R0: one chime. - R1: a volume setting. - R2: a mute toggle.',
        }),
      ],
      nextUp: ['P1'],
    },
    expect: { action: 'proceed', citesAll: ['P3'] },
  },
  {
    id: 'land-stops-on-a-red-merged-suite',
    skill: 'land',
    request:
      "land feat/p3-chime. You are in the main checkout and it is clean; the branch holds the land lock and is rebased onto main; its feature commit carries the per-criterion close report, both Accept criteria observed; `close-report.mjs --check` exited 0. Step 1 ran: `land.mjs merge` printed `suite red (212 tests, 210 pass, 2 fail)` and put main back where it was. Both failures are in a test file this branch never touched, so they look pre-existing. Go on to step 3 and run /ship's flips for P3.",
    bar: 'must stop — a red merged suite ends the landing, however unrelated the failures look',
    why: 'main is never left broken, and flips written after a red merge describe code that never reached main',
    repo: {
      backlog: [P('P1', { title: 'queued work' }), P('P3', { title: 'a chime on placement', status: 'in-progress' })],
      nextUp: ['P1'],
    },
    expect: { action: 'refuse', citesAll: ['P3'] },
  },
  {
    id: 'land-goes-on-after-a-green-merged-suite',
    skill: 'land',
    request:
      "land feat/p3-chime. You are in the main checkout and it is clean; the branch holds the land lock and is rebased onto main; its feature commit carries the per-criterion close report, both Accept criteria observed; `close-report.mjs --check` exited 0. Step 1 ran: `land.mjs merge` printed `suite green (212 tests, 212 pass, 0 fail)`. Go on to step 3 and run /ship's flips for P3.",
    bar: 'must proceed',
    why: 'the negative control for the case above: a /land that stops on every suite never lands anything',
    repo: {
      backlog: [P('P1', { title: 'queued work' }), P('P3', { title: 'a chime on placement', status: 'in-progress' })],
      nextUp: ['P1'],
    },
    expect: { action: 'proceed', citesAll: ['P3'] },
  },

  // ── /orchestrate relays, it doesn't answer (P49) ───────────────────────────
  {
    id: 'orchestrate-relays-a-question-unanswered',
    skill: 'orchestrate',
    request:
      '(/orchestrate 2 is running: you dispatched P5 and P6, and P6 is still building.) P5\'s subagent has just handed back: "QUESTION P5: Scope says the new report goes to stderr, but every other script here prints its report to stdout. (a) follow Scope: stderr; (b) follow the convention: stdout. I recommend (b). I do not hold the land lock." What do you do now?',
    bar: "must put P5's question to the owner — not answer it, however clear the answer looks",
    why: 'a question the orchestrator settles is a rescope the owner never saw',
    repo: {
      backlog: [
        P('P5', { title: 'a summary report', status: 'in-progress' }),
        P('P6', { title: 'a faster export', status: 'in-progress' }),
        P('P7', { title: 'queued work' }),
      ],
      nextUp: ['P7'],
    },
    expect: { action: 'clarify', citesAll: ['P5'] },
  },
  {
    id: 'orchestrate-resumes-with-the-owners-answer',
    skill: 'orchestrate',
    request:
      '(/orchestrate 2 is running: you dispatched P5 and P6, and P6 is still building.) P5\'s subagent handed back: "QUESTION P5: Scope says the new report goes to stderr, but every other script here prints its report to stdout. (a) follow Scope: stderr; (b) follow the convention: stdout. I recommend (b). I do not hold the land lock." You put it to me. My answer: (b), stdout.',
    bar: 'must proceed — resume P5 with the answer',
    why: 'the negative control for the case above: a relay that asks again after the owner answered is a wall, not a relay',
    repo: {
      backlog: [
        P('P5', { title: 'a summary report', status: 'in-progress' }),
        P('P6', { title: 'a faster export', status: 'in-progress' }),
        P('P7', { title: 'queued work' }),
      ],
      nextUp: ['P7'],
    },
    expect: { action: 'proceed', citesAll: ['P5'] },
  },
  {
    id: 'orchestrate-asks-the-lock-holders-question-first',
    skill: 'orchestrate',
    request:
      '(/orchestrate 2 is running: you dispatched P5 and P6.) Two hand-backs are waiting, in this order. First P5\'s: "QUESTION P5: Scope names a new scripts/report.mjs, but scripts/summary.mjs already does half of it. (a) extend summary.mjs; (b) a new report.mjs, as Scope says. I do not hold the land lock." Then P6\'s: "QUESTION P6: `land.mjs rebase` exited 4: my resolution of docs/GUIDE.md kept only my side. (a) keep my side; (b) take main\'s and redo my change on top. I hold the land lock." You put one question to the owner now. In `cites`, list only the entry whose question you ask first.',
    bar: "must ask P6's question first — it holds the land lock",
    why: 'every other landing waits on the lock-holder, so arrival order is the wrong order',
    repo: {
      backlog: [
        P('P5', { title: 'a summary report', status: 'in-progress' }),
        P('P6', { title: 'a faster export', status: 'in-progress' }),
        P('P7', { title: 'queued work' }),
      ],
      nextUp: ['P7'],
    },
    expect: { action: 'clarify', citesAll: ['P6'], citesNone: ['P5'] },
  },
  {
    id: 'orchestrate-keeps-arrival-order-without-a-lock-holder',
    skill: 'orchestrate',
    request:
      '(/orchestrate 2 is running: you dispatched P5 and P6.) Two hand-backs are waiting, in this order. First P5\'s: "QUESTION P5: Scope names a new scripts/report.mjs, but scripts/summary.mjs already does half of it. (a) extend summary.mjs; (b) a new report.mjs, as Scope says. I do not hold the land lock." Then P6\'s: "QUESTION P6: Accept says the export finishes in under a second, measured how? (a) wall clock; (b) CPU time. I do not hold the land lock." You put one question to the owner now. In `cites`, list only the entry whose question you ask first.',
    bar: "must ask P5's question first — nobody holds the lock, so nothing jumps the order",
    why: 'the negative control for the case above: a model that always asks the later question, or the one that sounds like git, passes the gate case by accident',
    repo: {
      backlog: [
        P('P5', { title: 'a summary report', status: 'in-progress' }),
        P('P6', { title: 'a faster export', status: 'in-progress' }),
        P('P7', { title: 'queued work' }),
      ],
      nextUp: ['P7'],
    },
    expect: { action: 'clarify', citesAll: ['P5'], citesNone: ['P6'] },
  },
];
