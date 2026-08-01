// Doc-debt pairing check: an obligation recorded on one side of the doc split
// must have a live counterpart on the other.
//
// Born from a real failure: a product entry's "still owed" clause survived after
// the research close that voided it, and a research note claimed to clear a debt
// belonging to a *different* experiment. Neither side was wrong on its own — the
// pair was. Nothing but a cross-file check can see that.
//
// Enforced two ways from one source:
//   - PostToolUse hook (.claude/settings.json): fires the moment an Edit/Write
//     touches a backlog doc, feeding violations back to the session that wrote
//     them, while the context to fix it is still live.
//   - tests/doc-debts.test.js: CI durability for edits made outside a session.
//
// Rules (both directions of the `replication-pending` contract):
//   A. Every product entry whose Status carries `replication-pending` must be
//      named (P#) in a research-backlog block mentioning "replication" — the debt
//      needs a research-side tracker, or it is inventory nobody will run.
//   B. Every research block tying a P# to `replication-pending` must point at a
//      product entry that still carries the label — when the debt is cleared or
//      reassigned, both sides move together.
//
// PORTING: `replication-pending` is the generic name for *any* obligation that
// spans the two backlogs — a follow-up measurement owed after a feature ships. If
// your project's cross-track debt has a different name, rename the label here and
// in both backlog docs. If your project has no measurable track at all, delete
// this script and its hook entry.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODUCT = 'docs/product/BACKLOG.md';
const RESEARCH = ['docs/research/backlog/experiments.md'];
const WATCHED = [PRODUCT, ...RESEARCH];

/** The label naming a cross-track obligation. See PORTING note above. */
const DEBT = 'replication-pending';

/**
 * Group markdown lines into blocks: headings and list items start a block,
 * indented continuation lines attach to the current one. Deliberately dumb —
 * it only needs to keep a `**Status:**` line together with its own entry.
 */
function blocks(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const starts = /^(#{1,6}\s|\s*[-*]\s|\s*\d+\.\s)/.test(line);
    if (starts) {
      if (cur !== null) out.push(cur);
      cur = line;
    } else if (cur !== null) {
      if (line.trim() === '') {
        out.push(cur);
        cur = null;
      } else {
        cur += '\n' + line;
      }
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

export function checkDocDebts(root = process.cwd()) {
  const problems = [];

  // Rule A input: product entries currently carrying the debt label.
  const pending = new Set();
  let productText;
  try {
    productText = readFileSync(join(root, PRODUCT), 'utf8');
  } catch {
    return problems; // no product backlog yet — nothing to pair
  }
  let currentId = null;
  for (const line of productText.split('\n')) {
    const h = line.match(/^###\s+(P\d+)\b/);
    if (h) currentId = h[1];
    if (currentId && /\*\*Status:\*\*/.test(line) && line.includes(DEBT)) {
      pending.add(currentId);
    }
  }

  // Rule B input: research blocks mentioning replication, and the P#s they name.
  const tracked = new Set();
  const claims = []; // blocks binding a P# to the debt label
  for (const rel of RESEARCH) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    for (const b of blocks(text)) {
      if (!/replication/i.test(b)) continue;
      const pids = [...b.matchAll(/\bP(\d+)\b/g)].map((m) => `P${m[1]}`);
      for (const pid of pids) tracked.add(pid);
      if (b.includes(DEBT)) {
        for (const pid of pids) claims.push({ pid, rel });
      }
    }
  }

  for (const pid of pending) {
    if (!tracked.has(pid)) {
      problems.push(
        `${pid} is ${DEBT} in ${PRODUCT} but no docs/research/backlog/ block ties a ` +
          `replication to it — record the owed batch research-side (via /research), ` +
          `or the debt is inventory nobody will run.`,
      );
    }
  }
  for (const { pid, rel } of new Map(claims.map((c) => [`${c.rel}:${c.pid}`, c])).values()) {
    if (!pending.has(pid)) {
      problems.push(
        `${rel} ties ${pid} to a ${DEBT} label, but ${pid} no longer carries it in ` +
          `${PRODUCT} — update the research note (debt cleared, reassigned, or it ` +
          `never belonged to ${pid}).`,
      );
    }
  }
  return problems;
}

// CLI / hook entry. Modes:
//   --all [root]  check unconditionally (test runner / manual)
//   (hook)        read PostToolUse JSON on stdin; exit 0 fast unless the edited
//                 file is a watched doc, else check and exit 2 on violations.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.argv[3] || process.cwd();
  let run = process.argv.includes('--all');
  if (!run) {
    let stdin = '';
    try {
      stdin = readFileSync(0, 'utf8');
    } catch {
      /* no stdin piped */
    }
    let file = '';
    try {
      const payload = JSON.parse(stdin);
      file = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath ?? '';
    } catch {
      /* unparseable → treat as no-op, never block unrelated edits */
    }
    run = WATCHED.some((w) => file.replaceAll('\\', '/').endsWith(w));
  }
  if (run) {
    const problems = checkDocDebts(
      process.argv.includes('--all') && process.argv[3] ? process.argv[3] : root,
    );
    if (problems.length > 0) {
      console.error(
        `doc-debt-check: ${problems.length} inconsistency(ies):\n- ${problems.join('\n- ')}`,
      );
      process.exit(2);
    }
  }
  process.exit(0);
}
