// Fixture builder — a throwaway project the checks can be pointed at.
//
// Every test here works the same way: build a project in a known state, run a real
// check against it as a real subprocess, assert on exit code and message. Nothing is
// stubbed, because the thing most worth testing about these scripts is their *exit
// codes and wording* — both are the interface that skills act on.
//
// Entries are built from data rather than by patching markdown strings. That matters
// for the loop walk: a state transition should read as `status: 'shipped'`, not as a
// regex replacing one line of prose with another. String surgery is how a test starts
// passing for a reason unrelated to what it claims to check.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Git exports repo-locating variables to the hooks it runs — under `git commit -a`,
// GIT_INDEX_FILE points at the outer repo's temporary index. The pre-commit hook runs
// this suite, every subprocess inherits process.env, and a fixture repo's `git commit`
// then writes against the wrong index and fails on correct code. Every test file
// imports this module, so clearing them here, once, covers every spawn.
for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const script = (name) => join(REPO, 'scripts', name);

const made = [];
export function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'skillsuite-'));
  made.push(d);
  return d;
}
export function cleanupAll() {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

// ── Dates ────────────────────────────────────────────────────────────────────
// The checker compares `Drafted:` against `new Date()`, so any test about dating has
// to be expressed relative to today. Hardcoded dates in a date-sensitive test are a
// slow fuse: they pass until the wall clock walks past them.

export const daysAgo = (n) =>
  new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
export const daysAhead = (n) => daysAgo(-n);

// ── Entry construction ───────────────────────────────────────────────────────

/** A product backlog entry. Defaults are a minimal *valid* open entry. */
export function P(id, over = {}) {
  return {
    id,
    title: `${id} example`,
    status: 'proposed',
    drafted: '2026-08-01',
    value: 'a user can do the thing.',
    scope: 'in: the thing. out: everything else.',
    // An array, not a string: the checker counts criteria, so a test that wants a
    // bad count has to express it as a count. `accept: null` omits the section.
    accept: ['the thing is visible in the UI.', 'doing it twice is idempotent.'],
    dependsOn: [],
    resolves: null,
    shipped: null,
    notes: null,
    ...over,
  };
}

/** A bug. Defaults are a minimal *valid* open bug: a repro and a severity, no Value. */
export function B(id, over = {}) {
  return {
    id,
    title: `${id} example`,
    status: 'open',
    severity: 'major',
    reported: '2026-08-01',
    dependsOn: [],
    repro: '1. do the thing.\n2. it breaks.',
    expected: null,
    value: null,
    notes: null,
    ...over,
  };
}

/** An open assumption. Defaults are a minimal *valid* open assumption. */
export function A(id, over = {}) {
  return {
    id,
    title: `${id} example`,
    status: 'open',
    raised: '2026-08-01',
    assumption: 'we act as if this is true.',
    why: 'things rest on it.',
    howToVerify: 'run the probe.',
    // `resolved` is the header date; `resolution` the body text saying what was found.
    resolved: null,
    resolution: null,
    movedTo: null,
    ...over,
  };
}

/** A decision. Defaults are a minimal *valid* open decision, waiting on the user. */
export function D(id, over = {}) {
  return {
    id,
    title: `${id} example`,
    status: 'open',
    raised: '2026-08-01',
    waitingOn: 'user',
    options: '(a) one way. (b) the other.',
    // Set together on decide: header keys and the sections a decided entry owes.
    decided: null,
    leadsTo: null,
    choice: null,
    why: null,
    reopenIf: null,
    supersededBy: null,
    ...over,
  };
}

/** A decided decision: the fields `decided` owes, filled. */
export const decidedD = (id, over = {}) =>
  D(id, {
    status: 'decided',
    waitingOn: null,
    decided: '2026-08-02',
    leadsTo: '—',
    choice: '(a).',
    why: 'because.',
    reopenIf: 'it stops being true.',
    ...over,
  });

// A null field means the LINE IS ABSENT, not the line with the word "null" on it.
// Rendering `status: null` would still be a header line, so a missing-field test would
// pass while proving nothing — the exact shape of failure L3 warns about, produced by
// the test rather than the check.
const key = (k, v) => (v == null ? null : `${k}: ${v}`);
const section = (name, text) => (text == null ? null : `## ${name}\n\n${text}`);

// A section whose value is a list of bullets. Same null contract: null omits the
// section entirely, and an empty array renders the heading with nothing under it —
// which is a real state the checker has to reject, not a bug here.
const list = (name, items) => (items == null ? null : `## ${name}\n\n${items.map((i) => `- ${i}`).join('\n')}`);

const entry = (header, body) =>
  ['---', ...header.filter(Boolean), '---', '', body.filter(Boolean).join('\n\n')].join('\n') + '\n';

const renderP = (e) =>
  entry(
    [
      key('id', e.id),
      key('title', e.title),
      key('status', e.status),
      key('drafted', e.drafted),
      key('depends_on', e.dependsOn.length ? e.dependsOn.join(', ') : '—'),
      key('resolves', e.resolves),
      key('shipped', e.shipped),
    ],
    [section('Value', e.value), section('Scope', e.scope), list('Accept', e.accept), section('Notes', e.notes)],
  );

const renderB = (e) =>
  entry(
    [
      key('id', e.id),
      key('title', e.title),
      key('status', e.status),
      key('severity', e.severity),
      key('reported', e.reported),
      key('depends_on', e.dependsOn.length ? e.dependsOn.join(', ') : '—'),
    ],
    [section('Value', e.value), section('Repro', e.repro), section('Expected', e.expected), section('Notes', e.notes)],
  );

const renderA = (d) =>
  entry(
    [
      key('id', d.id),
      key('title', d.title),
      key('status', d.status),
      key('raised', d.raised),
      key('resolved', d.resolved),
      key('moved_to', d.movedTo),
    ],
    [
      section('Assumption', d.assumption),
      section('Why it matters', d.why),
      section('How to verify', d.howToVerify),
      section('Resolution', d.resolution),
    ],
  );

const renderD = (d) =>
  entry(
    [
      key('id', d.id),
      key('title', d.title),
      key('status', d.status),
      key('raised', d.raised),
      key('waiting_on', d.waitingOn),
      key('decided', d.decided),
      key('leads_to', d.leadsTo),
      key('superseded_by', d.supersededBy),
    ],
    [
      section('Options', d.options),
      section('Decided', d.choice),
      section('Why', d.why),
      section('Reopen if', d.reopenIf),
    ],
  );

// Rendered as text, not just written to disk: the eval harness feeds these exact
// files to a model as context. One renderer means the state a model reasons about
// and the state the checker validates can never drift apart — which matters, because a
// disagreement between them would make an eval failure impossible to attribute.

/**
 * Every file of a project's registers, as `{ relative path: content }`. `nextUp` is a
 * list of P ids; pass [] deliberately to test the empty-queue failure. The READMEs
 * carry the status vocab lines verbatim because the checker reads its vocabulary *from
 * them* — a fixture that omitted them would be testing a different contract than the
 * real docs have. The bugs, assumptions and decisions registers are only written when
 * they have entries — pass `bugs: []` with `bugsReadme: true` for an empty bug register.
 */
export function renderFiles({ backlog = [P('P1')], bugs = [], bugsReadme = false, assumptions = [], decisions = [], nextUp = ['P1'] } = {}) {
  const files = {
    'docs/backlog/README.md':
      '# Product backlog\n\nStatus vocab: `proposed` / `in-progress` / `partial` / `shipped` / `deferred` / `abandoned`.\n',
    'docs/backlog/QUEUE.md':
      '# Next up\n\n' + nextUp.map((id, i) => `${i + 1}. **${id}** — queued.`).join('\n') + '\n',
  };
  for (const e of backlog) files[`docs/backlog/${e.id}.md`] = renderP(e);
  if (bugs.length || bugsReadme) {
    files['docs/bugs/README.md'] =
      '# Bugs\n\nStatus vocab: `open` / `in-progress` / `fixed` / `wontfix`.\n\nSeverity vocab: `critical` / `major` / `minor`.\n';
    for (const e of bugs) files[`docs/bugs/${e.id}.md`] = renderB(e);
  }
  if (assumptions.length) {
    files['docs/assumptions/README.md'] = '# Assumptions\n\nStatus vocab: `open` / `verified` / `refuted` / `moot` / `moved`.\n';
    for (const d of assumptions) files[`docs/assumptions/${d.id}.md`] = renderA(d);
  }
  if (decisions.length) {
    files['docs/decisions/README.md'] = '# Decisions\n\nStatus vocab: `open` / `decided` / `superseded`.\n';
    for (const d of decisions) files[`docs/decisions/${d.id}.md`] = renderD(d);
  }
  return files;
}

/** Write a file map (from renderFiles) under `dir`. */
export function writeFiles(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

/** A throwaway project holding the given registers. */
export function project(state = {}) {
  const dir = tempDir();
  writeFiles(dir, renderFiles(state));
  return dir;
}

// ── Running the real scripts ─────────────────────────────────────────────────

// spawnSync, not execFileSync: the latter discards stderr on a zero exit, and half of
// what these scripts say — every verdict line in grep-checked — goes to stderr even
// when they succeed. A helper that silently drops it makes assertions about wording
// pass vacuously.
//
// node is invoked via process.execPath so tests can blank PATH to prove a script does
// not shell out.
export function run(scriptName, args = [], { cwd, input, env } = {}) {
  const r = spawnSync(process.execPath, [script(scriptName), ...args], {
    cwd: cwd ?? REPO,
    input: input ?? '',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd ?? REPO, ...env },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Run the schema check against a fixture dir. */
export const schema = (dir) => run('backlog-schema-check.mjs', ['--all'], { cwd: dir });

/** Combined output — several checks report on stdout, several on stderr. */
export const out = (r) => `${r.stdout}\n${r.stderr}`;

// ── Git fixtures (session-audit) ─────────────────────────────────────────────

export function gitInit(dir, base = 'main') {
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'ignore' });
  sh(`git init -q -b ${base}`);
  sh('git config user.email test@example.com');
  sh('git config user.name Test');
  sh('git add -A');
  sh('git commit -qm init --allow-empty');
  return {
    sh,
    commitAll: (msg = 'wip') => { sh('git add -A'); sh(`git commit -qm "${msg}" --allow-empty`); },
    branch: (name) => sh(`git branch ${name}`),
    checkout: (name, create = false) => sh(`git checkout -q ${create ? '-b ' : ''}${name}`),
    merge: (name) => sh(`git merge -q --no-ff ${name} -m "merge ${name}"`),
  };
}
