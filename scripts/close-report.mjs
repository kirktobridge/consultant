// close-report — the skeleton of /implement's close report, printed from the entry (P43),
// and the check that a branch's report still quotes it (P44).
//
// The report the product owner accepts against quotes their Accept criteria word for
// word. A session retyping them at the end of a build is how a criterion gets
// paraphrased into one the build happens to satisfy, so code copies them instead. The
// session fills the slots; what each criterion says is never its to write.
//
// Read from the trunk, never the checked-out copy: on a feature branch the entry is as
// old as the branch, and a rescope landed on the trunk since is the contract now.
//
//   a feature  each `## Accept` criterion, quoted on one line, with a verdict and an
//              evidence slot under it.
//   a bug      its `## Repro`, to re-run, and its `## Expected`, verbatim, each with a
//              verdict slot. `Expected` is optional in a bug; its absence is said.
//
// Then the review slot (review.mjs's plain `review:` line and any `eval:` lines, and
// which findings were fixed or left) and the preflight slot, the two lines /implement's close step also owes. Each
// slot is one `<…>` and starts with `<`, so a slot left unfilled is never read as the
// line it holds the place of (`git log --grep '^preflight:'` counts those).
//
// A criterion is what entries.mjs's criteriaOf reads: the reader the schema check counts
// them with, so the two never disagree on how many there are.
//
// --check reads the branch's report (the newest of its commits, trunk..branch, that
// quotes a criterion or comes close to one) and grades each Accept criterion of the
// trunk's entry, whitespace-normalized on both sides, so a rewrap or a re-indent is never
// a difference:
//
//   ok          quoted whole, between quote marks, and a verdict (observed / not
//               observed / not exercised) starts right after the quote
//   NO VERDICT  quoted whole, but no verdict follows (an unfilled `<…>` slot is none)
//   ALTERED     not quoted whole; a list item holds most of its words (the item is shown)
//   MISSING     not quoted, and no item comes close
//
// It warns; /land relays the warnings and lands anyway (refusing is a later entry). Only
// Accept is checked: a bug's Repro and Expected are not, and it says so.
//
// Exit: 0 the skeleton is on stdout, or --check found nothing to warn about | 1 --check
// warns (each criterion named) | 2 nothing to print or check: not a P#/B#, no entry on the
// trunk, an entry that does not parse, no criteria in it (a feature with no Accept, a bug
// with no Repro), no trunk, or (--check) no branch or no commits on it
//
// Usage: node scripts/close-report.mjs <P#|B#> [--base <branch>]
//        node scripts/close-report.mjs --check <P#|B#> [--branch <branch>] [--base <branch>]

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BUGS, buildableRegister, parseEntry, criteriaOf } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { entryOfBranch } from './landing.mjs';

/** A section's text as written, minus the blank lines around it; null when it says nothing. */
const textOf = (lines) => {
  const t = (lines ?? []).join('\n').replace(/^\s*\n|\s+$/g, '');
  return t.trim() ? t : null;
};
const indent = (t) => t.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n');

const SLOTS = [
  '',
  '<review.mjs\'s plain-output `review:` line, and each `eval:` line it printed>',
  '<which findings were fixed, and which were left and why>',
  '',
  '<`preflight: agreed`, or `preflight: disagreed — <gate>: <what each side said>`>',
];

/**
 * The skeleton for one parsed entry, or `{ error }` saying why there is none. `bug` picks
 * the Repro/Expected form.
 */
export function skeletonOf(entry, { bug }) {
  const { sections } = entry;
  if (!bug) {
    const criteria = criteriaOf(sections.get('Accept'));
    if (!criteria.length) {
      return { error: sections.has('Accept') ? 'its ## Accept has no criteria (top-level bullets)' : 'it has no ## Accept section' };
    }
    const lines = ['Accept:'];
    for (const c of criteria) lines.push(`- "${c}"`, '  <OBSERVED | NOT OBSERVED | NOT EXERCISED>. <evidence; for not exercised, which milestone owns it>');
    return { text: [...lines, ...SLOTS].join('\n') };
  }
  const repro = textOf(sections.get('Repro'));
  if (!repro) return { error: sections.has('Repro') ? 'its ## Repro is empty' : 'it has no ## Repro section' };
  const expected = textOf(sections.get('Expected'));
  const lines = ['Repro, re-run:', indent(repro), '  <OBSERVED | NOT OBSERVED> to still break. <evidence>', ''];
  if (expected) lines.push('Expected:', indent(expected), '  <OBSERVED | NOT OBSERVED>. <evidence>');
  else lines.push(`Expected: ${sections.has('Expected') ? 'the entry\'s ## Expected is empty.' : 'none in the entry.'}`);
  return { text: [...lines, ...SLOTS].join('\n') };
}

// ── The check ────────────────────────────────────────────────────────────────

const norm = (s) => s.replace(/\s+/g, ' ').trim();
/** A verdict, at the start of what follows a quote: past any `**`, dash or comma. */
const VERDICT = /^[\s*_.,:;—–-]*(not observed|not exercised|observed)\b/i;
/** The words that carry a criterion's meaning, for telling ALTERED from MISSING. */
const words = (s) => new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []));
const ALTERED_SHARE = 0.6;

/** Where `text` quotes `want` whole, between its own quote marks: the index after each closing mark. */
const quotesOf = (text, want) => {
  const ends = [];
  for (let at = text.indexOf(want); at >= 0; at = text.indexOf(want, at + 1)) {
    const end = at + want.length;
    if (/["“]/.test(text[at - 1] ?? '') && /["”]/.test(text[end] ?? '')) ends.push(end + 1);
  }
  return ends;
};

/** A message's list items, bulleted or numbered, each joined with its continuation lines. */
const itemsOf = (message) => criteriaOf(message.split('\n').map((l) => l.replace(/^\d+[.)]\s+/, '- ')));

/**
 * Grade each criterion against the branch's report. The report is the newest commit
 * message that quotes a criterion or comes close to one: a report re-verified after a
 * conflict resolution supersedes the first, so an older one never covers for a newer
 * one that reworded or dropped a criterion. `messages` is newest first, as git log
 * gives them. A criterion is `ok` quoted whole, between quote marks, with a verdict
 * right after; text that only contains it is not a quote.
 */
export function checkReport(criteria, messages) {
  const wants = criteria.map(norm);
  const near = (item, want) => {
    const mine = words(want);
    const theirs = words(item);
    return mine.size ? [...mine].filter((w) => theirs.has(w)).length / mine.size : 0;
  };
  const parsed = messages.map((m) => ({ text: norm(m), items: itemsOf(m).map(norm) }));
  const report = parsed.find(({ text, items }) => wants.some((w) => quotesOf(text, w).length
    || items.some((i) => near(i, w) >= ALTERED_SHARE))) ?? parsed[0] ?? { text: '', items: [] };

  return criteria.map((c, n) => {
    const want = wants[n];
    const ends = quotesOf(report.text, want);
    if (ends.some((e) => VERDICT.test(report.text.slice(e)))) return { criterion: c, grade: 'ok' };
    if (ends.length) return { criterion: c, grade: 'NO VERDICT' };
    let best = null;
    for (const item of report.items) {
      if (wants.some((o) => quotesOf(item, o).length)) continue; // quotes another criterion whole
      const share = near(item, want);
      if (share >= ALTERED_SHARE && (!best || share > best.share)) best = { share, item };
    }
    if (!best) return { criterion: c, grade: 'MISSING' };
    const shown = best.item.match(/^["“](.+?)["”](?=\s|$)/)?.[1] ?? best.item.slice(0, 160);
    return { criterion: c, grade: 'ALTERED', report: shown };
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const [ID] = argv.filter((a, i) => !a.startsWith('--') && !['--base', '--branch'].includes(argv[i - 1]));
  const usage = 'usage: node scripts/close-report.mjs [--check] <P#|B#> [--branch <branch>] [--base <branch>]';
  const stop = (msg) => { console.error(`close-report: ${msg}`); process.exit(2); };

  // Same git invocation as claims, for the reasons given in session-audit.
  const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
  let lastError = '';
  const git = (...args) => {
    try {
      return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
      });
    } catch (e) {
      lastError = String(e.stderr ?? e.message ?? '').trim();
      return null;
    }
  };

  const reg = ID ? buildableRegister(ID) : null;
  if (!reg) stop(`"${ID ?? ''}" is not a buildable id (P# or B#).\n${usage}`);
  if (git('rev-parse', '--git-dir') === null) stop(`not a git repository, or git refused it.${lastError ? ` git: ${lastError.split('\n')[0]}` : ''}`);
  const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
  const { trunk, error } = trunkFromArgv(argv, branches);
  if (error) stop(error);

  const path = `${reg.dir}/${ID}.md`;
  // Untrimmed, as claims reads it: trim() would quietly repair a header the check rejects.
  const text = git('show', `${trunk}:${path}`);
  if (text === null) stop(`${ID} has no entry on ${trunk} (${path}): an untriaged idea goes to /triage first.`);
  const entry = parseEntry(text, reg.keys);
  // A broken header swallows the body, so "no Accept" would name the wrong fault.
  if (entry.errors.length) stop(`${path} on ${trunk} does not parse (line ${entry.errors[0].line}: ${entry.errors[0].msg}). Run npm run check:docs for every problem.`);

  if (!check) {
    const { text: skeleton, error: none } = skeletonOf(entry, { bug: reg === BUGS });
    if (none) stop(`${ID} on ${trunk}: ${none}, so there is nothing to report against. Rescope the entry via /ship.`);
    console.log(skeleton);
    process.exit(0);
  }

  const i = argv.indexOf('--branch');
  let branch = i >= 0 ? argv[i + 1] : null;
  if (i >= 0 && (!branch || branch.startsWith('--'))) stop('--branch needs a branch.');
  if (!branch) {
    const mine = branches.filter((b) => entryOfBranch(b) === ID);
    if (mine.length !== 1) stop(`${mine.length ? `several branches build ${ID} (${mine.join(', ')})` : `no local branch builds ${ID}`}. Name it with --branch <branch>.`);
    [branch] = mine;
  }
  if (!branches.includes(branch)) stop(`--branch ${branch} is not a local branch.`);
  // NUL-separated: a message may hold any text, a line of dashes included.
  const log = git('log', '--format=%B%x00', `${trunk}..${branch}`);
  if (log === null) stop(`could not read ${trunk}..${branch}. git: ${lastError.split('\n')[0]}`);
  const messages = log.split('\0').map((m) => m.trim()).filter(Boolean);
  if (!messages.length) stop(`${branch} has no commits beyond ${trunk}: run --check before the merge, on the rebased branch.`);

  if (reg === BUGS) {
    console.log(`close-report --check ${ID}: a bug's Repro and Expected are not checked, only a feature's Accept criteria. Nothing to warn about.`);
    process.exit(0);
  }
  const criteria = criteriaOf(entry.sections.get('Accept'));
  if (!criteria.length) stop(`${ID} on ${trunk} has no Accept criteria to check a report against.`);

  const graded = checkReport(criteria, messages);
  const warned = graded.filter((g) => g.grade !== 'ok');
  const out = [`close-report --check ${ID}: ${branch} against ${trunk}'s Accept, ${messages.length} commit(s) read`];
  for (const g of graded) {
    out.push(`  ${g.grade.padEnd(11)} "${g.criterion}"`);
    if (g.report) out.push(`  ${''.padEnd(11)} the report has: "${g.report}"`);
  }
  out.push(warned.length
    ? `warnings: ${warned.length} — a criterion the report does not quote word for word with a verdict. Relay each in the handshake; the landing goes on.`
    : 'no warnings: every criterion is quoted word for word with a verdict.');
  console.log(out.join('\n'));
  process.exit(warned.length ? 1 : 0);
}
