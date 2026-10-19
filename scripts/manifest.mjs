// manifest — which tracked files are the suite, and which are this repo's own state.
//
// This repo is two things at once: the suite (skills, scripts, hooks, tests, eval), and
// the project that builds the suite with itself (its backlog, assumptions, decisions,
// drills). Nothing recorded which file was which, so every entry built here could tie
// the suite a little more to this repo's state, and nobody would notice until a port
// failed. The manifest records it, and `scripts/export.mjs` reads it to write a clean
// copy (P28).
//
//   suite     ships in every export, verbatim.
//   instance  this repo's own state; never exported. Where a clean copy still needs
//             the file to exist (a register's seed entry, the spec, CLAUDE.md), the
//             export writes its starting state from `template/` instead.
//
// A tracked file that matches neither list fails `--check`, naming the file: a new file
// has to be classified when it's added, not when the next port finds it. One that
// matches both fails too, because then the list's order would be deciding.
//
// PORTING: in a project that adopted the suite, the instance list is your project —
// add its paths so the check keeps meaning "nothing unclassified". (Not a catch-all:
// that would mark every suite file both.)
//
// Modes:
//   node scripts/manifest.mjs --check   every tracked file is marked exactly once (exit 1 if not)
//   node scripts/manifest.mjs --list    every tracked file with its mark, as `mark path`

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Patterns: a path, a directory prefix ending in `/`, or a glob where `*` stays inside
// one path segment.
export const SUITE = [
  '.claude/GUIDE.md',
  '.claude/edit-blocklist',
  '.claude/edit-guard.mjs',
  '.claude/hooks/',
  '.claude/settings.json',
  '.claude/skills/',
  '.github/workflows/',
  '.gitignore',
  'PORTING.md',
  'README.md',
  'package.json',
  'docs/backlog/README.md',
  'docs/assumptions/README.md',
  'docs/decisions/README.md',
  'evals/',
  'scripts/',
  'template/',
  'tests/*.test.mjs',
  'tests/helpers/',
];

export const INSTANCE = [
  'CLAUDE.md',
  'docs/SPEC.md',
  'docs/ARCHITECTURE.md',
  'docs/BUILD_ORDER.md',
  'docs/LESSONS.md',
  'docs/backlog/QUEUE.md',
  'docs/backlog/P*.md',
  'docs/assumptions/A-*.md',
  'docs/decisions/D-*.md',
  'docs/drills/',
  'docs/dev_notes/',
  // Tests that read this repo's own entries. They can't pass in a clean copy, and a
  // fixture can't stand in for them: what they check is this repo's history.
  'tests/instance/',
];

const toRegex = (p) =>
  p.endsWith('/')
    ? new RegExp(`^${esc(p)}`)
    : new RegExp(`^${p.split('*').map(esc).join('[^/]*')}$`);
const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

const SUITE_RE = SUITE.map(toRegex);
const INSTANCE_RE = INSTANCE.map(toRegex);

/** `suite`, `instance`, `both` (a manifest error), or null (unmarked). */
export function classify(path) {
  const s = SUITE_RE.some((r) => r.test(path));
  const i = INSTANCE_RE.some((r) => r.test(path));
  return s && i ? 'both' : s ? 'suite' : i ? 'instance' : null;
}

/** Every tracked file under `root`, as repo-relative paths. */
export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/** The manifest's problems with a file list, one message per file. */
export function problems(files) {
  const out = [];
  for (const f of files) {
    const c = classify(f);
    if (c === null) out.push(`${f}: not marked suite or instance — add it to SUITE or INSTANCE in scripts/manifest.mjs`);
    if (c === 'both') out.push(`${f}: marked both suite and instance — narrow one of the patterns`);
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const files = trackedFiles(root);
  if (process.argv.includes('--list')) {
    for (const f of files) console.log(`${classify(f) ?? 'UNMARKED'} ${f}`);
    process.exit(0);
  }
  const bad = problems(files);
  if (bad.length) {
    for (const b of bad) console.error(`manifest: ${b}`);
    process.exit(1);
  }
  // The count is the positive control (L3): a git call that returned nothing would
  // otherwise pass exactly like a tree where every file is marked.
  if (files.length === 0) {
    console.error('manifest: no tracked files read — is this a git checkout?');
    process.exit(1);
  }
  const suite = files.filter((f) => classify(f) === 'suite').length;
  console.log(`manifest: OK (${files.length} tracked files: ${suite} suite, ${files.length - suite} instance)`);
}
