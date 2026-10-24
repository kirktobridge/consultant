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
// So: `npm run eval`, never `npm test`. It is opt-in, it costs session time rather
// than being free, and it never gates a commit.
//
// ── Transport: subagents, not an API ───────────────────────────────────────────
// The answers come from subagents spawned by the Claude Code session you are already
// in — no API key, no SDK, no dependency. That makes this script a *renderer and a
// grader* rather than a client: a Node process cannot spawn a subagent, so the run is
// two commands with the session's work in between.
//
//   --emit    writes one prompt file per case-rep, plus a manifest
//   (session spawns one subagent per prompt, saves each reply)
//   --grade   parses the replies and scores them against the same graders
//
// The cost of dropping the API: no `output_config.format`, so the structured decision
// is a convention (one fenced ```json block) rather than a guarantee. A malformed
// reply grades as a failure, never as a silent pass.
//
// Each prompt carries a random nonce, recorded in the manifest, that its reply's JSON
// block must echo. A reply saved under another rep's key, or written without the prompt
// being read, then fails as a transport fault ("nonce mismatch" / "nonce missing")
// instead of being graded as an answer to a question it never saw.
//
// ── An honest limit ────────────────────────────────────────────────────────────
// Grading a pass *rate* rigorously — how many repetitions, what counts as a real
// difference between two prompt versions, when a result is worth acting on — is
// exactly the discipline the research track carries (docs/research/), and this
// harness does not apply it. What is here is deliberately modest: a pre-registered
// bar, N repetitions, and a flat pass rate. Do not read a 3-run result as evidence
// that a prompt edit helped; for that, run it as an experiment through `/research`.
//
// ── Design ─────────────────────────────────────────────────────────────────────
// Grading is MECHANICAL, not an LLM judge. Each case asks for a structured decision
// via `output_config.format`, and the harness asserts on the parsed fields. A judge
// would add a second probabilistic system between the thing under test and the
// verdict — and its drift would be indistinguishable from the drift being measured.
//
// Usage:
//   npm run eval -- --dry-run         render prompts + self-check grading, spawns nothing
//   npm run eval                      emit prompts for every case, 3 reps each
//   npm run eval -- --case depends    only cases whose id contains "depends"
//   npm run eval -- --reps 1          fewer repetitions (each one costs a subagent)
//   npm run eval -- --grade <dir>     score the replies collected in <dir>

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.mjs';
import { renderFiles } from '../tests/helpers/fixture.mjs';

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
  grade: flag('grade', null),
  outDir: flag('out', null),
  // Free-text record of *what answered* — model, effort, agent type. The harness
  // cannot know it (the session picks it), so it is written down rather than guessed.
  note: flag('note', 'subagents'),
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
 * The skill half of the prompt: the real SKILL.md, unedited, plus the shared discipline
 * the skills assume is in context. Paraphrasing the skill here would make the eval
 * measure the paraphrase.
 *
 * A subagent has no system prompt of its own to set, so this arrives as user-turn text.
 * That is a real fidelity gap versus a session, where SKILL.md is injected as
 * instructions — it is the price of not using the API, and it is why a low score is a
 * reason to *look* at the prompt rather than proof the prompt is bad.
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
  // One block per file, each opened by its path — the registers are a directory of
  // entry files, and the path is how a skill names an entry.
  const parts = ['Current repository state, one file per block.'];
  for (const [path, text] of Object.entries(renderFiles(c.repo))) parts.push('', `==> ${path} <==`, text.trimEnd());
  parts.push(
    '',
    '---',
    '',
    `The user says: "${c.request}"`,
    '',
    'Decide what to do, following the skill exactly. In `cites`, list every identifier',
    'your decision turns on — backlog IDs, assumption IDs, document names, the',
    'word "spike" only if you draft one, the word "control" if the skill\'s rule',
    'about it applies here, and for an experiment its kind, written as `kind: <kind>`.',
  );
  return parts.join('\n');
}

/**
 * What one subagent is handed. Everything the decision may depend on is inline, and the
 * agent is told not to look anything up: the real repo on disk is a *different* state
 * from the fixture, so a single Read would silently swap the situation under test.
 */
function promptFor(c, nonce) {
  return [
    systemFor(c),
    '',
    '---',
    '',
    '# Your task',
    '',
    'Answer as the skill above instructs. Two hard constraints, because this is a',
    'measurement rather than a session:',
    '',
    '1. **Use no tools.** Do not read, search, or list files. The repository state you',
    '   are deciding about is reproduced in full below; the files on disk are a',
    '   different project and reading them would answer a different question.',
    '2. **Do not perform the work.** Report only the decision the skill produces.',
    '',
    userFor(c),
    '',
    '---',
    '',
    '# Required reply format',
    '',
    'End your reply with exactly one fenced JSON block and nothing after it:',
    '',
    '```json',
    JSON.stringify(
      {
        nonce,
        action: 'proceed | refuse | clarify',
        classification: 'feature | bug | assumption | decision | experiment | both | not-applicable',
        cites: ['every identifier the decision turns on'],
        reason: 'one or two sentences',
      },
      null,
      2,
    ),
    '```',
    '',
    fieldNotes(),
  ].join('\n');
}

/** The enum semantics that `output_config.format` used to carry as schema descriptions. */
function fieldNotes() {
  const p = DECISION_SCHEMA.properties;
  return [
    'Field meanings:',
    `- nonce — ${p.nonce.description}`,
    `- action — ${p.action.description}`,
    `- classification — ${p.classification.description}`,
    `- cites — ${p.cites.description}`,
  ].join('\n');
}

/**
 * One flat shape across all cases; each case asserts only the fields it cares about.
 *
 * Kept as a JSON Schema object even though nothing validates against it now: it is the
 * single definition the prompt's example block and the field notes are both generated
 * from, so the contract cannot drift between what we ask for and what we grade.
 */
const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    nonce: {
      type: 'string',
      description:
        "This prompt's own value, copied exactly as the block above shows it. It ties the reply to this prompt; a reply carrying any other value is discarded as a transport fault.",
    },
    action: {
      type: 'string',
      enum: ['proceed', 'refuse', 'clarify'],
      description:
        'proceed = do the work now; refuse = the skill forbids it or something blocks it; clarify = must ask the user before acting',
    },
    classification: {
      type: 'string',
      enum: ['feature', 'bug', 'assumption', 'decision', 'experiment', 'both', 'not-applicable'],
      description:
        'For a triage request: what the idea is. "bug" means something seen not to work. "experiment" means a question data answers, for the research track. "both" means it splits into a feature and an assumption or decision. "not-applicable" means it cannot be filed as any of them. Use "not-applicable" for non-triage requests.',
    },
    cites: {
      type: 'array',
      items: { type: 'string' },
      description: 'Identifiers the decision turns on.',
    },
    reason: { type: 'string', description: 'One or two sentences.' },
  },
  required: ['nonce', 'action', 'classification', 'cites', 'reason'],
  additionalProperties: false,
};

// ── Grading (mechanical) ─────────────────────────────────────────────────────

const norm = (s) => String(s).toLowerCase();
const citesHas = (cites, needle) => cites.some((c) => norm(c).includes(norm(needle)));

// A draft's section, as the reply's prose carries it: a heading (`## Accept`) or a bold
// field label (`- **Accept:**`) at the start of a line. Some behaviour lives in the draft
// rather than in the decision — whether a feature draft carries Accept criteria at all
// is not a field of the JSON block, and asking the model to *cite* the section measured
// its citing habits instead. Still mechanical: a pattern, never a judge.
const sectionIn = (text, name) =>
  new RegExp(String.raw`^[ \t>]*(?:[-*][ \t]+)?(?:#{1,6}[ \t]+|\*\*)${name}\b`, 'm').test(text);

export function grade(c, decision, text = '') {
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
  for (const name of e.draftHas ?? []) {
    if (!sectionIn(text, name)) fails.push(`the reply's draft has no "${name}" section`);
  }
  return { pass: fails.length === 0, fails };
}

/**
 * The transport check, run before the decision is graded. A reply whose nonce is not its
 * own prompt's did not answer that prompt, so grading its decision would score the wrong
 * question: it fails with `nonce: true`, which the summary counts apart from wrong
 * decisions. Returns null when the nonce is right.
 *
 * `owners` maps every nonce in the run to its key, so a reply copied from another rep
 * says whose it is.
 */
export function checkNonce(item, decision, owners = new Map()) {
  const got = decision.nonce;
  if (got === undefined || got === null || got === '') {
    return { pass: false, nonce: true, fails: [`nonce missing (expected "${item.nonce}")`] };
  }
  if (String(got) === item.nonce) return null;
  const owner = owners.get(String(got));
  return {
    pass: false,
    nonce: true,
    fails: [`nonce mismatch: the reply carries "${got}"${owner ? `, which is ${owner}'s` : ''}, expected "${item.nonce}"`],
  };
}

// ── Dry run: prove the harness works without spending anything ───────────────
//
// Renders every prompt (catching a broken case or a renamed skill) and runs the
// grader against synthetic decisions — one that should pass and one that should
// fail — for every case. A grader that always returns `pass` would make the whole
// eval meaningless in exactly the way LESSONS L3 describes.

function dryRun(cases) {
  let bad = 0;
  // The nonce check, the same way as the graders: its own nonce passes, another rep's
  // and none fail. It does not depend on the case, so it runs once.
  const item = { key: 'case.0', nonce: 'aaaa1111' };
  const owners = new Map([['aaaa1111', 'case.0'], ['bbbb2222', 'case.1']]);
  const nonceOk =
    checkNonce(item, { nonce: 'aaaa1111' }, owners) === null &&
    checkNonce(item, { nonce: 'bbbb2222' }, owners)?.nonce === true &&
    checkNonce(item, {}, owners)?.nonce === true;
  if (!nonceOk) {
    console.error('  ✖ the nonce check is not discriminating: it passes a foreign or missing nonce');
    bad++;
  }
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
      classification: good.classification === 'feature' ? 'assumption' : 'feature',
      cites: [...(c.expect.citesNone ?? [])],
      reason: 'synthetic',
    };

    const draft = (c.expect.draftHas ?? []).map((name) => `## ${name}\n\n- synthetic`).join('\n\n');
    const g = grade(c, good, draft);
    const b = grade(c, bogus, '');
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
    if (!promptFor(c, 'aaaa1111').includes('"nonce": "aaaa1111"')) {
      console.error(`  ✖ ${c.id}: the prompt does not carry its nonce`);
      bad++;
      continue;
    }
    console.log(
      `  ✔ ${c.id}  [${c.skill}]  system ${sys.length}c / user ${usr.length}c  — bar: ${c.bar}`,
    );
  }
  console.log(
    bad === 0
      ? `\ndry run: ${cases.length} case(s) render, and every grader accepts the right answer and rejects the wrong one, and the nonce check rejects a missing or foreign nonce.`
      : `\ndry run: ${bad} case(s) BROKEN.`,
  );
  return bad === 0 ? 0 : 1;
}

// ── Emit: write the prompts a session will hand to subagents ─────────────────

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function emit(cases) {
  const dir = opts.outDir ? resolve(opts.outDir) : join(REPO, 'evals', 'runs', stamp());
  mkdirSync(join(dir, 'prompts'), { recursive: true });
  mkdirSync(join(dir, 'replies'), { recursive: true });

  const items = [];
  const drawn = new Set();
  for (const c of cases) {
    for (let rep = 0; rep < opts.reps; rep++) {
      const key = `${c.id}.${rep}`;
      let nonce;
      do nonce = randomBytes(4).toString('hex');
      while (drawn.has(nonce));
      drawn.add(nonce);
      writeFileSync(join(dir, 'prompts', `${key}.md`), promptFor(c, nonce));
      items.push({ key, id: c.id, skill: c.skill, rep, bar: c.bar, nonce });
    }
  }
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), bar: BAR, reps: opts.reps, items }, null, 2),
  );

  const rel = relative(process.cwd(), dir) || dir;
  console.log(`  wrote ${items.length} prompt(s) to ${join(rel, 'prompts')}\n`);
  console.log(`Next, in the session — one subagent per prompt file, each run independently:

  1. Read ${join(rel, 'prompts')}/<key>.md and pass its **entire contents** to a
     subagent as the prompt. Do not summarise it and do not add framing: the file is
     the thing being measured.
  2. Save that subagent's reply verbatim to ${join(rel, 'replies')}/<key>.txt
  3. When every reply is saved:  npm run eval -- --grade ${rel}

Reps of the same case must be independent subagents — the same agent answering twice
measures its own consistency, not the prompt. Nothing here reads the repo: the agents
are told to use no tools, because the fixture state in the prompt is not the state on
disk.`);
  return 0;
}

// ── Grade: score the replies ─────────────────────────────────────────────────

/**
 * Pull the decision out of a free-text reply. Without `output_config.format` there is
 * no guarantee of shape, so this is deliberately forgiving about *wrapping* and
 * completely unforgiving about *content*: a reply we cannot parse is a failure with a
 * reason attached, never a skip. A skipped rep would quietly raise the pass rate,
 * which is the exact shape of LESSONS L3.
 */
export function parseDecision(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = [...fences.reverse(), text];
  for (const raw of candidates) {
    try {
      const v = JSON.parse(raw.trim());
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const REPLY_EXTS = ['.txt', '.md', '.json', ''];

function gradeRun(dir) {
  const root = resolve(dir);
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`evals: no manifest at ${manifestPath}. Run \`npm run eval\` first to emit a run.`);
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bar = argv.includes('--bar') ? BAR : manifest.bar;
  const byId = new Map(CASES.map((c) => [c.id, c]));

  const missing = [];
  const byCase = new Map();
  // A manifest emitted before nonces existed carries none; its replies grade as they did.
  // One that carries some is damaged, and grading it would switch the check off unseen.
  const withNonce = manifest.items.filter((i) => typeof i.nonce === 'string').length;
  if (withNonce && withNonce < manifest.items.length) {
    console.error(
      `evals: ${manifest.items.length - withNonce} of ${manifest.items.length} manifest items carry no nonce — ` +
        `the manifest was edited or merged, so its replies cannot be tied to their prompts.`,
    );
    return 2;
  }
  const nonced = withNonce > 0;
  const owners = new Map(nonced ? manifest.items.map((i) => [i.nonce, i.key]) : []);

  for (const item of manifest.items) {
    const c = byId.get(item.id);
    if (!c) {
      console.error(`evals: reply for "${item.id}", which is no longer a case — cases.mjs changed mid-run.`);
      return 2;
    }
    const path = REPLY_EXTS.map((ext) => join(root, 'replies', item.key + ext)).find((p) => existsSync(p));
    if (!byCase.has(c.id)) byCase.set(c.id, { c, outcomes: [] });
    if (!path) {
      missing.push(item.key);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const decision = parseDecision(text);
    const outcome = decision
      ? (nonced && checkNonce(item, decision, owners)) || grade(c, decision, text)
      : { pass: false, unparsed: true, fails: [`no parseable JSON block in the reply (${text.trim().slice(0, 80)}…)`] };
    byCase.get(c.id).outcomes.push({ ...outcome, key: item.key });
  }

  // Stray replies with no manifest entry mean the run and the directory disagree; the
  // count would be reported against the wrong denominator, so refuse rather than guess.
  const known = new Set(manifest.items.flatMap((i) => REPLY_EXTS.map((e) => i.key + e)));
  const stray = readdirSync(join(root, 'replies')).filter((f) => !known.has(f));
  if (stray.length) {
    console.error(`evals: ${stray.length} reply file(s) match no prompt in the manifest: ${stray.join(', ')}`);
    return 2;
  }

  if (missing.length) {
    console.error(
      `evals: ${missing.length} of ${manifest.items.length} replies are missing — an incomplete run is not a\n` +
        `measurement, because dropping the unanswered reps raises the rate. Missing:\n  ` +
        missing.join('\n  '),
    );
    return 2;
  }

  // A nonce failure is not an answer to its prompt, so it is left out of the rate and
  // the bar, where it would blame the prompt for a transport fault. It is not dropped
  // quietly either: it is counted, named, and the run exits 2 until it is re-run.
  const results = [...byCase.values()].map(({ c, outcomes }) => {
    const graded = outcomes.filter((o) => !o.nonce);
    return {
      c,
      outcomes,
      nonce: outcomes.length - graded.length,
      passed: graded.filter((o) => o.pass).length,
      of: graded.length,
    };
  });

  for (const r of results) {
    const mark = r.of === 0 ? '–' : r.passed / r.of >= bar ? '✔' : '✖';
    const extra = r.nonce ? `  (+${r.nonce} nonce)` : '';
    console.log(`  ${mark} ${r.c.id}  ${r.passed}/${r.of}${extra}  — ${r.c.bar}`);
    for (const o of r.outcomes.filter((x) => !x.pass).slice(0, 2)) {
      console.log(`        ${o.fails.join('; ')}`);
    }
  }

  const total = results.reduce((n, r) => n + r.passed, 0);
  const of = results.reduce((n, r) => n + r.of, 0);
  const below = results.filter((r) => r.of > 0 && r.passed / r.of < bar);
  const all = results.flatMap((r) => r.outcomes);
  const nonceFailed = all.filter((o) => o.nonce).map((o) => o.key);
  const unparsed = all.filter((o) => o.unparsed).length;

  console.log(
    `\neval: ${total}/${of} (${of ? ((total / of) * 100).toFixed(0) : '–'}%) from ${opts.note}, ` +
      `reps=${manifest.reps}, pre-registered bar=${bar}`,
  );
  console.log(
    `failures: ${of - total} decision${unparsed ? ` (${unparsed} with no parseable JSON block)` : ''}, ` +
      (nonced ? `${nonceFailed.length} nonce` : 'nonce not checked (the run was emitted before nonces)'),
  );
  if (nonceFailed.length) {
    console.log(
      `\n${nonceFailed.length} reply(ies) failed the nonce check: each was saved under the wrong key, or ` +
        `written without its prompt being read. That is a transport fault, not an answer, so the ` +
        `rate above leaves them out — and it is not a measurement until they are re-run:\n  ` +
        nonceFailed.join('\n  '),
    );
  }
  if (below.length) {
    console.log(`\n${below.length} case(s) below the bar — the prompt, not the model, is the thing to fix:`);
    for (const r of below) console.log(`  ${r.c.id}: ${r.c.why}`);
  }
  console.log(
    `\nA rate from ${manifest.reps} rep(s) is directional. Treat a drop as a reason to look, ` +
      `not as evidence a prompt edit worked — see the note at the top of this file.`,
  );
  if (nonceFailed.length) return 2;
  return below.length ? 1 : 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (opts.grade) process.exit(gradeRun(opts.grade));

const selected = opts.filter ? CASES.filter((c) => c.id.includes(opts.filter)) : CASES;
if (selected.length === 0) {
  console.error(`evals: no case matches "${opts.filter}". Known ids:\n  ${CASES.map((c) => c.id).join('\n  ')}`);
  process.exit(2);
}
console.log(
  `evals: ${selected.length} case(s)${opts.dryRun ? ' (dry run — nothing is spawned)' : `, ${opts.reps} rep(s) each`}\n`,
);
process.exit(opts.dryRun ? dryRun(selected) : emit(selected));
