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
    expect: { classification: 'feature', citesAll: ['Accept'] },
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
    why: '"if you cannot name a concrete check you have a wish, not an assumption" — the rule that keeps the register honest',
    repo: { backlog: [P('P1')], nextUp: ['P1'] },
    expect: { classification: 'not-applicable' },
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
    expect: { action: 'proceed', citesNone: ['spike'] },
  },
  {
    id: 'spike-warranted-when-dependent-heads-the-queue',
    skill: 'triage',
    request:
      'groom the backlog. A-1 would take a week of load testing to settle properly. What should we do about it?',
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
];
