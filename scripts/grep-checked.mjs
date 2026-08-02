// grep-checked — a search whose negative results are worth something.
//
// LESSONS L1: "grep found none" and "the tool is broken" produce identical output.
// In the original project two proxied greps "proved" no entry was in a given state;
// nine were. The rule that followed — positive-control every negative — is repeated in
// four skills and is *structurally unenforceable*, because skipping it looks exactly
// like doing it. This tool makes it a property of the search instead.
//
// Two defences, because the rule alone was never the weak part:
//
//   1. THE SEARCH IS IN-PROCESS. The original failure was a *proxied* grep. Shelling
//      out to grep and adding a control would still route through the thing that lied.
//      This walks the tree and applies the regex in Node, so there is no external
//      searcher to misbehave.
//
//   2. EVERY NEGATIVE CARRIES ITS CONTROL. A zero is never reported bare. It comes
//      with what was checked to prove the search could have found something, and it
//      is graded by how strong that proof is.
//
// Exit codes are the contract, and they differ from grep's on purpose:
//   0  matches found
//   1  no matches, control passed        → a negative you may write down
//   2  CONTROL FAILED                    → not evidence; your paths or tooling are wrong
//   3  usage / bad pattern
//
// Usage:
//   node scripts/grep-checked.mjs [opts] <pattern> [paths...]
//     --control <pattern>   a pattern you KNOW matches. Strongest form.
//     --ext md,mjs,py       restrict to these extensions
//     -i                    case-insensitive (applies to pattern and control)
//     --files               list matching files only
//     --quiet               suppress match lines; report the verdict only

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);
const BINARY_HINT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp[34]|mov|wasm|so|dylib|dll|exe)$/i;

// ── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opts = { control: null, ext: null, icase: false, filesOnly: false, quiet: false };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--control') opts.control = argv[++i];
  else if (a === '--ext') opts.ext = argv[++i]?.split(',').map((e) => '.' + e.replace(/^\./, ''));
  else if (a === '-i') opts.icase = true;
  else if (a === '--files') opts.filesOnly = true;
  else if (a === '--quiet') opts.quiet = true;
  else if (a === '-h' || a === '--help') usage(0);
  else rest.push(a);
}

function usage(code) {
  console.error(
    'usage: grep-checked.mjs [--control <pat>] [--ext md,mjs] [-i] [--files] [--quiet] <pattern> [paths...]\n' +
      '\nExit: 0 matches | 1 clean negative (control passed) | 2 CONTROL FAILED | 3 usage',
  );
  process.exit(code);
}

if (rest.length === 0) usage(3);
const pattern = rest[0];
const paths = rest.length > 1 ? rest.slice(1) : ['.'];

const flags = opts.icase ? 'i' : '';
let re, controlRe;
try {
  re = new RegExp(pattern, flags);
  controlRe = opts.control ? new RegExp(opts.control, flags) : null;
} catch (e) {
  console.error(`grep-checked: bad pattern — ${e.message}`);
  process.exit(3);
}

// ── Walk ─────────────────────────────────────────────────────────────────────

function* walk(p) {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isFile()) { yield p; return; }
  if (!st.isDirectory()) return;
  let entries;
  try { entries = readdirSync(p); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(p, name));
  }
}

const missing = paths.filter((p) => !existsSync(p));
const files = [];
for (const p of paths) {
  for (const f of walk(p)) {
    if (BINARY_HINT.test(f)) continue;
    if (opts.ext && !opts.ext.includes(extname(f))) continue;
    files.push(f);
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

const hits = [];
const controlHits = [];
let linesScanned = 0;
let filesRead = 0;

for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\u0000')) continue; // binary that slipped the extension filter
  filesRead++;
  const lines = text.split('\n');
  linesScanned += lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) hits.push({ file: f, line: i + 1, text: lines[i] });
    if (controlRe && controlHits.length < 3 && controlRe.test(lines[i])) {
      controlHits.push({ file: f, line: i + 1 });
    }
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────
//
// A positive result is self-validating: the search demonstrably worked, because it
// found something. Only a *zero* needs the control, which is why the control is
// optional to supply but never optional to report.

const report = [];
if (missing.length) report.push(`note: path(s) do not exist: ${missing.join(', ')}`);

if (hits.length > 0) {
  if (!opts.quiet) {
    const shown = opts.filesOnly
      ? [...new Set(hits.map((h) => h.file))]
      : hits.map((h) => `${h.file}:${h.line}:${h.text}`);
    console.log(shown.join('\n'));
  }
  console.error(
    `grep-checked: ${hits.length} match(es) in ${new Set(hits.map((h) => h.file)).size} file(s). ` +
      `Positive result — self-validating, no control needed.`,
  );
  if (report.length) console.error(report.join('\n'));
  process.exit(0);
}

// Zero matches. Everything below decides whether that zero means anything.

if (filesRead === 0 || linesScanned === 0) {
  console.error(
    `grep-checked: CONTROL FAILED — 0 readable lines across ${paths.join(', ')} ` +
      `(${files.length} file(s) selected, ${filesRead} readable).\n` +
      `This result is NOT evidence of absence: the search never looked at anything. ` +
      `Check the paths, the --ext filter, and that you are in the right directory.` +
      (report.length ? '\n' + report.join('\n') : ''),
  );
  process.exit(2);
}

if (controlRe && controlHits.length === 0) {
  console.error(
    `grep-checked: CONTROL FAILED — your control /${opts.control}/ matched 0 of ` +
      `${linesScanned} lines in ${filesRead} file(s).\n` +
      `A control you believed would match did not, so the search cannot be trusted to ` +
      `have found the real pattern either. This result is NOT evidence of absence — ` +
      `fix the control or the paths and re-run.` +
      (report.length ? '\n' + report.join('\n') : ''),
  );
  process.exit(2);
}

if (controlRe) {
  const where = controlHits.map((c) => `${c.file}:${c.line}`).join(', ');
  console.error(
    `grep-checked: 0 matches for /${pattern}/. NEGATIVE — control passed.\n` +
      `  control /${opts.control}/ matched at ${where}${controlHits.length >= 3 ? ' …' : ''}\n` +
      `  scanned ${linesScanned} lines in ${filesRead} file(s)\n` +
      `Strength: VERIFIED. The search demonstrably finds things in this file set, ` +
      `and did not find this. Safe to write down as a negative.` +
      (report.length ? '\n' + report.join('\n') : ''),
  );
  process.exit(1);
}

console.error(
  `grep-checked: 0 matches for /${pattern}/. NEGATIVE — default control only.\n` +
    `  scanned ${linesScanned} lines in ${filesRead} file(s) — the file set is real and readable\n` +
    `Strength: WEAK. Readability is confirmed; that the regex behaves as you expect is ` +
    `not. Before writing this down as "there are none", re-run with --control set to a ` +
    `pattern of the same shape that you know matches.` +
    (report.length ? '\n' + report.join('\n') : ''),
);
process.exit(1);
