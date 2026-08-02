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
    dependsOn: [],
    resolves: null,
    shipped: null,
    ...over,
  };
}

/** An open decision. Defaults are a minimal *valid* open OD. */
export function OD(id, over = {}) {
  return {
    id,
    title: `${id} example`,
    status: 'open',
    raised: '2026-08-01',
    assumption: 'we act as if this is true.',
    why: 'things rest on it.',
    howToVerify: 'run the probe.',
    resolution: null,
    ...over,
  };
}

// A null field means the LINE IS ABSENT, not the line with the word "null" on it.
// Rendering `- **Value:** null` still matches the checker's `**Value:**` probe, so a
// missing-field test would have passed while proving nothing — the exact shape of
// failure L3 warns about, produced by the test rather than the check.
const line = (label, v) => (v == null ? null : `- **${label}:** ${v}`);

const renderP = (e) =>
  [
    `### ${e.id} — ${e.title}`,
    line('Status', e.status),
    line('Drafted', e.drafted),
    line('Value', e.value),
    line('Scope', e.scope),
    line('Depends on', e.dependsOn.length ? e.dependsOn.join(', ') : '—'),
    line('Resolves', e.resolves),
    line('Shipped', e.shipped),
  ]
    .filter(Boolean)
    .join('\n');

const renderOD = (d) =>
  [
    `### ${d.id} — ${d.title}`,
    line('Status', d.status),
    line('Raised', d.raised),
    line('Assumption', d.assumption),
    line('Why it matters', d.why),
    line('How to verify', d.howToVerify),
    `- **Resolution:** ${d.resolution ?? '—'}`,
  ]
    .filter(Boolean)
    .join('\n');

// Rendered as text, not just written to disk: the eval harness feeds these exact
// documents to a model as context. One renderer means the state a model reasons about
// and the state the checker validates can never drift apart — which matters, because a
// disagreement between them would make an eval failure impossible to attribute.

export const renderBacklog = ({ backlog = [P('P1')], nextUp = ['P1'] } = {}) =>
  `# Product backlog\n\n` +
  'Status vocab: `proposed` / `in-progress` / `partial` / `shipped` / `deferred` / `abandoned`.\n\n' +
  `## Next up\n\n` +
  (nextUp.length ? nextUp.map((id, i) => `${i + 1}. **${id}** — queued.`).join('\n') : '_(empty)_') +
  `\n\n---\n\n## Epic: Foundations\n\n` +
  backlog.map(renderP).join('\n\n') +
  '\n';

export const renderDecisions = (decisions = []) =>
  `# Open Decisions\n\n` +
  'Status vocab: `open` / `verified` / `refuted` / `moot`.\n\n---\n\n## Register\n\n' +
  decisions.map(renderOD).join('\n\n') +
  '\n';

/**
 * Write a project. `nextUp` is a list of P ids; pass [] deliberately to test the
 * empty-queue failure. Vocab lines are included verbatim because the checker reads
 * its status vocabulary *from the document* — a fixture that omitted them would be
 * testing a different contract than the real docs have.
 */
export function project({ backlog = [P('P1')], decisions = [], nextUp = ['P1'] } = {}) {
  const dir = tempDir();
  mkdirSync(join(dir, 'docs', 'product'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'product', 'BACKLOG.md'), renderBacklog({ backlog, nextUp }));
  if (decisions.length) {
    writeFileSync(join(dir, 'docs', 'OPEN_DECISIONS.md'), renderDecisions(decisions));
  }
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
