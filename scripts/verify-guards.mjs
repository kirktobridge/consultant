// verify-guards — assert the enforcement layer is still armed.
//
// `.claude/settings.json` is deliberately NOT in the edit blocklist: blocking it would
// stop Claude managing hooks and permissions, which is a legitimate thing to want. The
// cost of leaving it writable is that an agent can disarm the guard that protects the
// spec, by editing the file that declares it.
//
// This closes that, but the *placement* is the whole design, so read this before
// moving it:
//
//   A check declared inside the thing it guards is not a guard. Wiring this to
//   PostToolUse gives fast, in-band feedback — and is removable by the very edit it
//   exists to catch. So the load-bearing copy is the one in `npm test`, which lives in
//   package.json, runs in CI, and cannot be switched off by editing settings.json.
//   The hook is the convenience; the test is the guarantee.
//
// It asserts PROPERTIES, never equality with a blessed config. Adding hooks, matchers
// or permissions is normal and must stay frictionless; what may not happen is the
// guard quietly ceasing to cover writes.
//
// Removing a guard on purpose is still allowed — you edit this file too. That is the
// suite's standing rule: a convention changes in doc, checker and caller together, as
// one deliberate act, never as a side effect of an unrelated edit.
//
// Exit: 0 armed | 1 disarmed (CI) | 2 disarmed (hook, feeds back into the session)
//
// Usage: node scripts/verify-guards.mjs [--all]

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SETTINGS = '.claude/settings.json';
const BLOCKLIST = '.claude/edit-blocklist';

/** Edits that write a file. A guard that does not cover all three has a hole. */
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit'];

/**
 * The invariants. Each names the script it must reach and which tools must be covered;
 * `event` is where in the tool lifecycle it has to run, because a guard that reports
 * *after* the write is not a guard.
 */
const REQUIRED = [
  {
    event: 'PreToolUse',
    script: 'edit-guard',
    covers: WRITE_TOOLS,
    why: 'without it, every human-owned file — the spec included — becomes writable by any session',
  },
  {
    event: 'PostToolUse',
    script: 'backlog-schema-check',
    covers: WRITE_TOOLS,
    why: 'without it, malformed entries land silently and are found by the next session, not this one',
  },
];

/** Files whose edit should trigger the in-session run. */
const WATCHED = [SETTINGS, BLOCKLIST];

// ── Mode ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
let hookMode = false;
let run = argv.includes('--all') || process.stdin.isTTY === true;

if (!run) {
  let stdin = '';
  try { stdin = readFileSync(0, 'utf8'); } catch { /* nothing piped */ }
  if (stdin.trim() === '') {
    run = true;
  } else {
    hookMode = true;
    let file = '';
    try {
      const p = JSON.parse(stdin);
      file = p?.tool_input?.file_path ?? p?.tool_response?.filePath ?? '';
    } catch { /* unparseable → no-op */ }
    run = WATCHED.some((w) => file.replaceAll('\\', '/').endsWith(w));
  }
}
if (!run) process.exit(0);

// ── Checks ───────────────────────────────────────────────────────────────────

const problems = [];
const fail = (m) => problems.push(m);

let settings;
try {
  settings = JSON.parse(readFileSync(join(ROOT, SETTINGS), 'utf8'));
} catch (e) {
  // Unreadable or invalid JSON is itself a disarmed state: the harness silently runs
  // no hooks at all when it cannot parse this file.
  fail(`${SETTINGS} is missing or not valid JSON (${e.message}). No hooks are running.`);
  settings = null;
}

if (settings) {
  const hooks = settings.hooks ?? {};
  for (const req of REQUIRED) {
    const matchers = hooks[req.event] ?? [];
    const entries = matchers.flatMap((m) =>
      (m.hooks ?? []).map((h) => ({ matcher: m.matcher ?? '', command: h.command ?? '' })),
    );
    const mine = entries.filter((e) => e.command.includes(req.script));

    if (mine.length === 0) {
      fail(
        `${req.event} no longer runs ${req.script} — ${req.why}. ` +
          `Restore the hook, or if the removal is deliberate, remove it from REQUIRED in ` +
          `scripts/verify-guards.mjs in the same commit.`,
      );
      continue;
    }

    // The command must reach a file that exists. A hook pointing at a moved or deleted
    // script fails open: the harness reports a non-zero exit nobody reads, and the
    // guard is gone without a single error message about guarding.
    for (const e of mine) {
      const m = e.command.match(/[\w./$-]*(?:scripts|\.claude)\/[\w.-]+\.(?:mjs|js|py|sh)/);
      const target = m?.[0]?.replace(/^.*\$CLAUDE_PROJECT_DIR\/?/, '').replace(/^["']/, '');
      if (target && !existsSync(join(ROOT, target))) {
        fail(`${req.event} runs "${target}", which does not exist — the hook fails open.`);
      }
    }

    // A matcher narrowed to a subset of the write tools leaves the rest unguarded, and
    // is the failure most likely to look like a harmless tidy-up in a diff.
    const uncovered = req.covers.filter((t) => !mine.some((e) => matches(e.matcher, t)));
    if (uncovered.length) {
      fail(
        `${req.event}'s ${req.script} hook does not cover ${uncovered.join(', ')} — ` +
          `those writes are unguarded. Matcher(s): ${mine.map((e) => `"${e.matcher}"`).join(', ')}.`,
      );
    }
  }
}

/**
 * Claude Code matchers are regexes; `*` and an empty matcher mean "everything".
 *
 * Matching is ANCHORED here, deliberately, and it is the one judgement call in this
 * file. Unanchored, the matcher `Edit` would count as covering `MultiEdit` — the
 * string contains it — so narrowing a guard to `Edit` would look fully armed while
 * leaving `Write` open and `MultiEdit` covered only by accident of spelling.
 *
 * Whether the harness itself anchors is recorded as OD-3 and is not yet verified. This
 * check takes the conservative reading on purpose: if the harness turns out to be
 * unanchored we are merely strict — we demand `Edit|Write|MultiEdit` be spelled out,
 * which is clearer anyway. Assuming the other way round would leave a real hole and
 * report it as armed, and only one of those two errors is recoverable.
 */
function matches(matcher, tool) {
  if (!matcher || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return false;
  }
}

// The blocklist must still protect the guard's own files. It is itself blocked from
// in-session edits, but nothing stops an edit made outside a session, and a blocklist
// that no longer names the guard is one ordinary commit away from a disarmed guard.
if (existsSync(join(ROOT, BLOCKLIST))) {
  const patterns = readFileSync(join(ROOT, BLOCKLIST), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  for (const self of [BLOCKLIST, '.claude/edit-guard.mjs']) {
    if (!patterns.some((p) => self.endsWith(p.replace(/\/$/, '')) || p === self)) {
      fail(
        `${BLOCKLIST} no longer protects ${self} — a session that can edit it can grant ` +
          `itself every other file.`,
      );
    }
  }
} else {
  fail(`${BLOCKLIST} is missing — the guard has no patterns and permits everything.`);
}

// ── Report ───────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(
    `verify-guards: THE ENFORCEMENT LAYER IS DISARMED (${problems.length} problem(s)):\n- ` +
      problems.join('\n- ') +
      `\n\nThis check also runs in \`npm test\`, which is where it actually holds — a hook ` +
      `declared in settings.json cannot be trusted to catch settings.json being edited.`,
  );
  process.exit(hookMode ? 2 : 1);
}
if (!hookMode) console.log(`verify-guards: armed (${REQUIRED.length} hooks verified, blocklist intact)`);
