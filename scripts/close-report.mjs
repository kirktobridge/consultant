// close-report — the skeleton of /implement's close report, printed from the entry (P43).
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
// Then the review slot (review.mjs's plain `review:` line, and which findings were fixed
// or left) and the preflight slot, the two lines /implement's close step also owes. Each
// slot is one `<…>` and starts with `<`, so a slot left unfilled is never read as the
// line it holds the place of (`git log --grep '^preflight:'` counts those).
//
// A criterion is what entries.mjs's criteriaOf reads: the reader the schema check counts
// them with, so the two never disagree on how many there are.
//
// Exit: 0 the skeleton is on stdout | 2 no skeleton: not a P#/B#, no entry on the trunk,
// an entry that does not parse, no criteria in it (a feature with no Accept, a bug with
// no Repro), or no trunk
//
// Usage: node scripts/close-report.mjs <P#|B#> [--base <branch>]

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BUGS, buildableRegister, parseEntry, criteriaOf } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';

/** A section's text as written, minus the blank lines around it; null when it says nothing. */
const textOf = (lines) => {
  const t = (lines ?? []).join('\n').replace(/^\s*\n|\s+$/g, '');
  return t.trim() ? t : null;
};
const indent = (t) => t.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n');

const SLOTS = [
  '',
  '<review.mjs\'s plain-output `review:` line>',
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

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const [ID] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--base');
  const usage = 'usage: node scripts/close-report.mjs <P#|B#> [--base <branch>]';
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
  const { text: skeleton, error: none } = skeletonOf(entry, { bug: reg === BUGS });
  if (none) stop(`${ID} on ${trunk}: ${none}, so there is nothing to report against. Rescope the entry via /ship.`);
  console.log(skeleton);
}
