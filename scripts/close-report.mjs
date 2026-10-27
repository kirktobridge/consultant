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
// trunk's entry (a bug: its Repro and Expected, below), whitespace-normalized on both
// sides, so a rewrap or a re-indent is never a difference:
//
//   ok          quoted whole, between quote marks, and a verdict (observed / not
//               observed / not exercised) starts right after the quote
//   NO VERDICT  quoted whole, but no verdict follows (an unfilled `<…>` slot is none)
//   ALTERED     not quoted whole; a list item holds most of its words (the item is shown)
//   MISSING     not quoted, and no item comes close
//
// A bug's report is graded the same way, section by section (P56). The skeleton prints
// each section as an indented block under its own heading, not between quote marks, so a
// section is quoted when the region under the report's heading for it holds the section's
// whole text, and what follows that text is the verdict. Text running on past the
// section is a change, so it is ALTERED. With no heading, the whole report is the region.
//
// It warns; /land relays the warnings and lands anyway (refusing is a later entry).
//
// --clears B# decides D-7's question for /land and /ship: does the report clear the bug,
// so /land may mark it `fixed` without asking the owner (P60)? Only when --check would
// be quiet, the Repro is *not observed* to still break, and the Expected is *observed*
// (clearsBug), and, when land.mjs's landing record shows a conflict resolved, the report
// that says so was committed after the rebase. With no readable landing record, nothing
// clears. A feature is refused: its `shipped` is the owner's verdict.
//
// Exit: 0 the skeleton is on stdout, --check found nothing to warn about, or --clears
// clears | 1 --check warns (each criterion or section named), or --clears does not clear
// (saying why) | 2 nothing to print or check: not a P#/B#, no entry on the trunk, an entry
// that does not parse, no criteria in it (a feature with no Accept, a bug with no Repro),
// no trunk, (--check, --clears) no branch or no commits on it, or --clears given a feature
//
// Usage: node scripts/close-report.mjs <P#|B#> [--base <branch>]
//        node scripts/close-report.mjs --check <P#|B#> [--branch <branch>] [--base <branch>]
//        node scripts/close-report.mjs --clears <B#> [--branch <branch>] [--base <branch>]

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BUGS, buildableRegister, parseEntry, criteriaOf } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';
import { entryOfBranch, readLandingRecord } from './landing.mjs';

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
/** The share of `want`'s words that `text` holds. */
const share = (text, want) => {
  const mine = words(want);
  const theirs = words(text);
  return mine.size ? [...mine].filter((w) => theirs.has(w)).length / mine.size : 0;
};

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
  const parsed = messages.map((m) => ({ text: norm(m), items: itemsOf(m).map(norm) }));
  const report = parsed.find(({ text, items }) => wants.some((w) => quotesOf(text, w).length
    || items.some((i) => share(i, w) >= ALTERED_SHARE))) ?? parsed[0] ?? { text: '', items: [] };

  return criteria.map((c, n) => {
    const want = wants[n];
    const ends = quotesOf(report.text, want);
    if (ends.some((e) => VERDICT.test(report.text.slice(e)))) return { criterion: c, grade: 'ok' };
    if (ends.length) return { criterion: c, grade: 'NO VERDICT' };
    let best = null;
    for (const item of report.items) {
      if (wants.some((o) => quotesOf(item, o).length)) continue; // quotes another criterion whole
      const s = share(item, want);
      if (s >= ALTERED_SHARE && (!best || s > best.share)) best = { share: s, item };
    }
    if (!best) return { criterion: c, grade: 'MISSING' };
    const shown = best.item.match(/^["“](.+?)["”](?=\s|$)/)?.[1] ?? best.item.slice(0, 160);
    return { criterion: c, grade: 'ALTERED', report: shown };
  });
}

/**
 * Grade a bug's report: its `## Repro` and `## Expected` (when it has one), each as the
 * skeleton prints them, an indented block under its own heading (P56). The block has no
 * quote marks to bound it, so the report's headings do: each section is looked for in
 * the region under the report's heading for it (the heading line's own text included, up
 * to the next section heading or a closing `review:`/`preflight:` line), or in the whole
 * report when it has no such heading.
 *
 *   ok          the region holds the section's whole text, and a verdict follows it
 *   NO VERDICT  it holds the whole text and nothing follows, or an unfilled `<…>` slot
 *   ALTERED     the text is changed, cut, or runs on past the section; the region holds
 *               most of its words (the region is shown)
 *   MISSING     the region doesn't come close
 *
 * The report is the newest message holding a section heading or a section's text, so an
 * unrelated later commit that happens to share words never stands in for it.
 */
export function checkBugReport(sections, messages) {
  const wanted = [['Repro', textOf(sections.get('Repro'))], ['Expected', textOf(sections.get('Expected'))]]
    .filter(([, t]) => t).map(([name, t]) => ({ name, text: t, want: norm(t) }));
  // A heading starts its line, unindented (the skeleton indents everything under it), and
  // ends at a colon soon after the name: `Repro, re-run:`, `**Expected:**`. A repro step
  // reading "Expected exit 2, got 0." is indented, or has no such colon.
  const HEADING = /^\**(Repro|Expected)\b[^:\n]{0,20}:\**\s*(.*)$/i;
  const CLOSER = /^(review|preflight|security-review|suite)\b/i;
  /** The report's region for each section name it heads, keyed by name. */
  const regionsOf = (message) => {
    const out = new Map();
    let cur = null;
    for (const line of message.split('\n')) {
      const h = HEADING.exec(line);
      if (h) { cur = []; out.set(h[1].toLowerCase(), cur); if (h[2]) cur.push(h[2]); continue; }
      if (CLOSER.test(line)) cur = null;
      else cur?.push(line);
    }
    return new Map([...out].map(([k, v]) => [k, norm(v.join('\n'))]));
  };
  const parsed = messages.map((m) => ({ text: norm(m), regions: regionsOf(m) }));
  const report = parsed.find(({ text, regions }) => regions.size || wanted.some(({ want }) => text.includes(want)))
    ?? parsed[0] ?? { text: '', regions: new Map() };

  return wanted.map(({ name, text, want }) => {
    const region = report.regions.get(name.toLowerCase()) || report.text;
    const criterion = `${text.split('\n')[0]}${text.includes('\n') ? ' …' : ''}`;
    const graded = (grade) => ({ criterion, section: name, grade });
    const ends = [];
    for (let at = region.indexOf(want); at >= 0; at = region.indexOf(want, at + 1)) ends.push(at + want.length);
    // The last quote's verdict is the report's final word, when it quotes a section twice.
    const verdict = ends.map((e) => VERDICT.exec(region.slice(e))).filter(Boolean).at(-1);
    if (verdict) return { ...graded('ok'), verdict: verdict[1].toLowerCase() };
    // Whole, then nothing but a slot: unfilled. Whole, then more text: it runs on.
    if (ends.some((e) => /^\s*(<|$)/.test(region.slice(e)))) return graded('NO VERDICT');
    if (share(region, want) < ALTERED_SHARE) return graded('MISSING');
    return { ...graded('ALTERED'), report: region.slice(0, 160) };
  });
}

/**
 * Whether checkBugReport's grades clear the bug (D-7, P60): the report quotes its Repro
 * and Expected word for word, the Repro *not observed* to still break, the Expected
 * *observed*. Code reads the verdicts, so no session judges whether its own report
 * clears; the verdicts themselves are still the report's, written by the build. A bug
 * with no Expected never clears: nothing in it says what
 * working looks like, so it goes to the owner.
 *
 * `landing` is what land.mjs's landing record says (readLandingRecord): `{ record }`, or
 * `{ error }` when it could not be read. A report written before a conflict resolution
 * describes code that no longer exists, so when the record shows one, `graded` must come
 * from the commits after the rebase (`rebasedTip..branch`) alone: an older report, or a
 * later commit that is no report, clears nothing. Without a readable record nothing
 * clears: it fails closed. `{ clears, why }`, `why` empty on a clear.
 */
export function clearsBug(graded, landing) {
  const of = (name) => graded.find((g) => g.section === name);
  const why = [];
  if (landing?.error) why.push(`its landing record could not be read (${landing.error})`);
  else if (!landing?.record) why.push('there is no landing record for its branch: --clears runs during /land, before `land.mjs finish`');
  else if (landing.record.conflicts?.length && !landing.record.rebasedTip) why.push(`${landing.record.conflicts.length} conflict region(s) were resolved and the record does not say where the rebase left the branch`);
  for (const g of graded) if (g.grade !== 'ok') why.push(`its ${g.section} is ${g.grade} in the report`);
  const repro = of('Repro');
  const expected = of('Expected');
  if (repro?.grade === 'ok' && repro.verdict !== 'not observed') why.push(`its Repro is ${repro.verdict} to still break, not "not observed"`);
  if (!expected) why.push('it has no Expected, so nothing in it says what working looks like');
  else if (expected.grade === 'ok' && expected.verdict !== 'observed') why.push(`its Expected is ${expected.verdict}, not "observed"`);
  return { clears: !why.length, why };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const clears = argv.includes('--clears');
  const check = clears || argv.includes('--check');
  const [ID] = argv.filter((a, i) => !a.startsWith('--') && !['--base', '--branch'].includes(argv[i - 1]));
  const usage = 'usage: node scripts/close-report.mjs [--check] <P#|B#> [--branch <branch>] [--base <branch>]\n       node scripts/close-report.mjs --clears <B#> [--branch <branch>] [--base <branch>]';
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
  // D-7 covers bugs only: a feature's `shipped` is the owner's verdict, never code's.
  if (clears && reg !== BUGS) stop(`--clears takes a bug (B#): ${ID} is a feature, and whether it shipped is the owner's call (D-7).`);
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
  // The branch's own commits: trunk..branch before the merge. After it (where /land's
  // step 3 and /ship run --clears) that range is empty, so read what the merge brought
  // in: the first-parent merge whose second parent is the branch tip, from its first
  // parent to the tip.
  let range = `${trunk}..${branch}`;
  const tip = git('rev-parse', branch)?.trim();
  if (git('merge-base', '--is-ancestor', branch, trunk) !== null) {
    const merges = (git('rev-list', '--first-parent', '--merges', '--parents', trunk) ?? '').split('\n').map((l) => l.split(' '));
    const merge = merges.find((p) => p.slice(2).includes(tip));
    if (merge) range = `${merge[1]}..${branch}`;
  }
  // NUL-separated: a message may hold any text, a line of dashes included.
  const log = git('log', '--format=%B%x00', range);
  if (log === null) stop(`could not read ${range}. git: ${lastError.split('\n')[0]}`);
  let messages = log.split('\0').map((m) => m.trim()).filter(Boolean);
  if (!messages.length) stop(`${branch} has no commits beyond ${trunk}, and no merge into ${trunk} brought it in: there is no report to read.`);

  const bug = reg === BUGS;
  // --clears: when the landing record shows a conflict resolved, only a report committed
  // after the rebase counts, so only those commits are graded (clearsBug).
  let landing = null;
  let graded;
  if (clears) {
    const common = git('rev-parse', '--path-format=absolute', '--git-common-dir')?.trim();
    try { landing = { record: common ? readLandingRecord(common, branch) : null }; } catch (e) { landing = { error: e.message }; }
    const rec = landing.record;
    if (rec?.conflicts?.length && rec.rebasedTip) {
      const after = git('log', '--format=%B%x00', `${rec.rebasedTip}..${branch}`);
      if (after === null) stop(`could not read ${rec.rebasedTip}..${branch}. git: ${lastError.split('\n')[0]}`);
      messages = after.split('\0').map((m) => m.trim()).filter(Boolean);
    }
  }
  if (bug) {
    if (!textOf(entry.sections.get('Repro'))) stop(`${ID} on ${trunk} has no Repro to check a report against.`);
    graded = checkBugReport(entry.sections, messages);
  } else {
    const criteria = criteriaOf(entry.sections.get('Accept'));
    if (!criteria.length) stop(`${ID} on ${trunk} has no Accept criteria to check a report against.`);
    graded = checkReport(criteria, messages);
  }
  if (clears) {
    const { clears: ok, why } = clearsBug(graded, landing);
    const after = landing.record?.conflicts?.length ? `, only those after the rebase (${landing.record.conflicts.length} conflict region(s) were resolved)` : '';
    const head = `close-report --clears ${ID}: ${branch} against ${trunk}, ${messages.length} commit(s) read${after}`;
    console.log(ok
      ? `${head}\nclears: the report quotes the Repro, not observed to still break, and the Expected, observed. /land may mark it fixed (D-7).`
      : `${head}\ndoes not clear: ${why.join('; ')}. It stays in-progress: ask the owner whether it is fixed.`);
    process.exit(ok ? 0 : 1);
  }
  const warned = graded.filter((g) => g.grade !== 'ok');
  const against = bug ? graded.map((g) => g.section).join(' and ') : 'Accept';
  const out = [`close-report --check ${ID}: ${branch} against ${trunk}'s ${against}, ${messages.length} commit(s) read`];
  for (const g of graded) {
    out.push(`  ${g.grade.padEnd(11)} ${bug ? `${g.section}: ` : ''}"${g.criterion}"`);
    if (g.report) out.push(`  ${''.padEnd(11)} the report has: "${g.report}"`);
  }
  const what = bug ? 'section' : 'criterion';
  out.push(warned.length
    ? `warnings: ${warned.length} — a ${what} the report does not quote word for word with a verdict. Relay each in the handshake; the landing goes on.`
    : `no warnings: every ${what} is quoted word for word with a verdict.`);
  console.log(out.join('\n'));
  process.exit(warned.length ? 1 : 0);
}
