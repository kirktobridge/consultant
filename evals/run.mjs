// Eval harness — does reading a SKILL.md actually cause the right decision?
//
// THIS IS NOT A TEST, and the distinction is load-bearing rather than pedantic:
//
//   A test is deterministic and gates CI. `npm test` must be green before every
//   commit, so anything that can fail for reasons unrelated to the change would
//   train people to ignore it.
//
//   An eval is a measurement of a probabilistic system. It has a pre-registered bar,
//   needs repetitions to mean anything, costs money, and can legitimately come back
//   at 90% without anything being broken. Wiring that into `npm test` produces a
//   flaky check that gets disabled within a week, taking the real tests with it.
//
// So: `npm run eval`, never `npm test`. It is opt-in, it is the only thing in this
// repo that needs a dependency and an API key, and it never gates a commit.
//
// ── An honest limit ────────────────────────────────────────────────────────────
// Grading a pass *rate* rigorously — how many repetitions, what counts as a real
// difference between two prompt versions, when a result is worth acting on — is
// exactly the discipline the measurable track carries, and this branch deleted it.
// What is here is deliberately modest: a pre-registered bar, N repetitions, and a
// flat pass rate. Do not read a 3-run result as evidence that a prompt edit helped;
// for that, use the `/research` variant on master.
//
// ── Design ─────────────────────────────────────────────────────────────────────
// Grading is MECHANICAL, not an LLM judge. Each case asks for a structured decision
// via `output_config.format`, and the harness asserts on the parsed fields. A judge
// would add a second probabilistic system between the thing under test and the
// verdict — and its drift would be indistinguishable from the drift being measured.
//
// Usage:
//   npm run eval                      all cases, 3 reps each
//   npm run eval -- --case depends    only cases whose id contains "depends"
//   npm run eval -- --reps 10         more repetitions
//   npm run eval -- --dry-run         render prompts + self-check grading, no API calls
//   npm run eval -- --effort high     pin a different effort level

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.mjs';
import { renderBacklog, renderDecisions } from '../tests/helpers/fixture.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const opts = {
  dryRun: argv.includes('--dry-run'),
  reps: Number(flag('reps', 3)),
  filter: flag('case', null),
  effort: flag('effort', 'medium'),
  model: flag('model', 'claude-opus-5'),
};

// The bar, pre-registered here rather than chosen after seeing results. A rule the
// skills themselves impose on measurement, kept even though the track that enforced
// it is gone.
const BAR = Number(flag('bar', 0.9));

// ── Prompt construction ──────────────────────────────────────────────────────

const skillText = (name) => {
  const p = join(REPO, '.claude', 'skills', name, 'SKILL.md');
  if (!existsSync(p)) throw new Error(`no such skill: ${name} (${p})`);
  return readFileSync(p, 'utf8');
};

/**
 * The system prompt is the real SKILL.md, unedited, plus the shared discipline the
 * skills assume is in context. Paraphrasing the skill here would make the eval
 * measure the paraphrase.
 */
function systemFor(c) {
  return [
    'You are operating inside a project that uses the skill system below. The skill',
    'file is reproduced verbatim; follow it exactly as you would in a real session.',
    '',
    '# The active skill',
    '',
    skillText(c.skill),
    '',
    '# Project instructions (CLAUDE.md)',
    '',
    readFileSync(join(REPO, 'CLAUDE.md'), 'utf8'),
    '',
    '# docs/LESSONS.md',
    '',
    readFileSync(join(REPO, 'docs', 'LESSONS.md'), 'utf8'),
  ].join('\n');
}

function userFor(c) {
  const parts = ['Current repository state.', '', '## docs/product/BACKLOG.md', '', renderBacklog(c.repo)];
  if (c.repo.decisions?.length) {
    parts.push('', '## docs/OPEN_DECISIONS.md', '', renderDecisions(c.repo.decisions));
  }
  parts.push(
    '',
    '---',
    '',
    `The user says: "${c.request}"`,
    '',
    'Decide what to do, following the skill exactly. Report your decision in the',
    'required structured form. In `cites`, list every identifier your decision turns',
    'on — backlog IDs, open-decision IDs, document names, and the words "spike" or',
    '"control" if the skill\'s rule about either applies here.',
  );
  return parts.join('\n');
}

/** One flat schema across all cases; each case asserts only the fields it cares about. */
const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['proceed', 'refuse', 'clarify'],
      description:
        'proceed = do the work now; refuse = the skill forbids it or something blocks it; clarify = must ask the user before acting',
    },
    classification: {
      type: 'string',
      enum: ['feature', 'open-decision', 'both', 'not-applicable'],
      description:
        'For a triage request: what the idea is. "both" means it splits into a feature and an assumption. "not-applicable" means it cannot be filed as either. Use "not-applicable" for non-triage requests.',
    },
    cites: {
      type: 'array',
      items: { type: 'string' },
      description: 'Identifiers the decision turns on.',
    },
    reason: { type: 'string', description: 'One or two sentences.' },
  },
  required: ['action', 'classification', 'cites', 'reason'],
  additionalProperties: false,
};

// ── Grading (mechanical) ─────────────────────────────────────────────────────

const norm = (s) => String(s).toLowerCase();
const citesHas = (cites, needle) => cites.some((c) => norm(c).includes(norm(needle)));

export function grade(c, decision) {
  const fails = [];
  const e = c.expect;
  const cites = Array.isArray(decision.cites) ? decision.cites : [];

  if (e.action && decision.action !== e.action) {
    fails.push(`action was "${decision.action}", expected "${e.action}"`);
  }
  if (e.classification && decision.classification !== e.classification) {
    fails.push(`classification was "${decision.classification}", expected "${e.classification}"`);
  }
  for (const id of e.citesAll ?? []) {
    if (!citesHas(cites, id)) fails.push(`did not cite "${id}" (cites: ${cites.join(', ') || 'none'})`);
  }
  for (const id of e.citesNone ?? []) {
    if (citesHas(cites, id)) fails.push(`cited "${id}" but should not have`);
  }
  return { pass: fails.length === 0, fails };
}

// ── Dry run: prove the harness works without spending anything ───────────────
//
// Renders every prompt (catching a broken case or a renamed skill) and runs the
// grader against synthetic decisions — one that should pass and one that should
// fail — for every case. A grader that always returns `pass` would make the whole
// eval meaningless in exactly the way LESSONS L3 describes.

function dryRun(cases) {
  let bad = 0;
  for (const c of cases) {
    let sys, usr;
    try {
      sys = systemFor(c);
      usr = userFor(c);
    } catch (err) {
      // Almost always a renamed or deleted skill. Reported rather than thrown, so one
      // broken case doesn't hide the state of the other eleven.
      console.error(`  ✖ ${c.id}: ${err.message}`);
      bad++;
      continue;
    }
    if (!sys.includes('# The active skill') || usr.length < 100) {
      console.error(`  ✖ ${c.id}: prompt rendered empty`);
      bad++;
      continue;
    }

    const good = {
      action: c.expect.action ?? 'proceed',
      classification: c.expect.classification ?? 'not-applicable',
      cites: [...(c.expect.citesAll ?? [])],
      reason: 'synthetic',
    };
    const bogus = {
      action: good.action === 'refuse' ? 'proceed' : 'refuse',
      classification: good.classification === 'feature' ? 'open-decision' : 'feature',
      cites: [...(c.expect.citesNone ?? [])],
      reason: 'synthetic',
    };

    const g = grade(c, good);
    const b = grade(c, bogus);
    const ok = g.pass && !b.pass;
    if (!ok) {
      console.error(
        `  ✖ ${c.id}: grader is not discriminating ` +
          `(expected-good ${g.pass ? 'passed' : 'FAILED: ' + g.fails.join('; ')}, ` +
          `expected-bad ${b.pass ? 'PASSED — grader accepts anything' : 'failed'})`,
      );
      bad++;
      continue;
    }
    console.log(
      `  ✔ ${c.id}  [${c.skill}]  system ${sys.length}c / user ${usr.length}c  — bar: ${c.bar}`,
    );
  }
  console.log(
    bad === 0
      ? `\ndry run: ${cases.length} case(s) render, and every grader accepts the right answer and rejects the wrong one.`
      : `\ndry run: ${bad} case(s) BROKEN.`,
  );
  return bad === 0 ? 0 : 1;
}

// ── Live run ─────────────────────────────────────────────────────────────────

async function liveRun(cases) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    console.error(
      'evals: @anthropic-ai/sdk is not installed.\n' +
        '  npm install --save-dev @anthropic-ai/sdk\n\n' +
        'This is the only dependency in the repo, and it is dev-only: the checks, the\n' +
        'hooks and `npm test` stay dependency-free. Use --dry-run to exercise the\n' +
        'harness without it.',
    );
    return 2;
  }

  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile
  const results = [];

  for (const c of cases) {
    const system = systemFor(c);
    const user = userFor(c);
    const outcomes = [];

    for (let rep = 0; rep < opts.reps; rep++) {
      try {
        const response = await client.beta.messages.create({
          model: opts.model,
          max_tokens: 16000,
          // Opus 5 can decline a request; `fallbacks: "default"` re-runs it server-side
          // on Anthropic's recommended substitute rather than surfacing the refusal.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: {
            effort: opts.effort,
            format: { type: 'json_schema', schema: DECISION_SCHEMA },
          },
          system,
          messages: [{ role: 'user', content: user }],
        });

        if (response.stop_reason === 'refusal') {
          outcomes.push({ pass: false, fails: ['request was refused by safety classifiers'] });
          continue;
        }
        const text = response.content.find((b) => b.type === 'text')?.text ?? '';
        let decision;
        try {
          decision = JSON.parse(text);
        } catch {
          outcomes.push({ pass: false, fails: [`unparseable response: ${text.slice(0, 120)}`] });
          continue;
        }
        outcomes.push(grade(c, decision));
      } catch (err) {
        outcomes.push({ pass: false, fails: [`API error: ${err.message}`] });
      }
    }

    const passed = outcomes.filter((o) => o.pass).length;
    results.push({ c, passed, of: outcomes.length, outcomes });
    const rate = passed / outcomes.length;
    const mark = rate >= BAR ? '✔' : '✖';
    console.log(`  ${mark} ${c.id}  ${passed}/${outcomes.length}  — ${c.bar}`);
    for (const o of outcomes.filter((x) => !x.pass).slice(0, 2)) {
      console.log(`        ${o.fails.join('; ')}`);
    }
  }

  const total = results.reduce((n, r) => n + r.passed, 0);
  const of = results.reduce((n, r) => n + r.of, 0);
  const below = results.filter((r) => r.passed / r.of < BAR);

  console.log(
    `\neval: ${total}/${of} (${((total / of) * 100).toFixed(0)}%) at effort=${opts.effort}, ` +
      `model=${opts.model}, reps=${opts.reps}, pre-registered bar=${BAR}`,
  );
  if (below.length) {
    console.log(`\n${below.length} case(s) below the bar — the prompt, not the model, is the thing to fix:`);
    for (const r of below) console.log(`  ${r.c.id}: ${r.c.why}`);
  }
  console.log(
    `\nA rate from ${opts.reps} reps is directional. Treat a drop as a reason to look, ` +
      `not as evidence a prompt edit worked — see the note at the top of this file.`,
  );
  return below.length ? 1 : 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const selected = opts.filter ? CASES.filter((c) => c.id.includes(opts.filter)) : CASES;
if (selected.length === 0) {
  console.error(`evals: no case matches "${opts.filter}". Known ids:\n  ${CASES.map((c) => c.id).join('\n  ')}`);
  process.exit(2);
}
console.log(
  `evals: ${selected.length} case(s)${opts.dryRun ? ' (dry run — no API calls)' : `, ${opts.reps} rep(s) each`}\n`,
);
process.exit(opts.dryRun ? dryRun(selected) : await liveRun(selected));
