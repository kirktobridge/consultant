// entries — the one reader for the tracked registers.
//
// Each entry is its own file: a header block the tools read, then a markdown body only
// people read. The split is the point. When fields lived in the prose, every reader had
// to guess which `**Depends on:**` was the field and which was a sentence about it, and
// each guess that went wrong (prose above the field, an indented sub-bullet, a section
// heading that didn't end the entry) failed green. Here nothing in the body is ever a
// field, so there is nothing to guess.
//
//   ---
//   id: P20
//   title: Entries as files
//   status: proposed
//   drafted: 2026-10-16
//   depends_on: P9, A-3
//   ---
//
//   ## Value
//   …
//
// The header is STRICT: every line between the fences is a known `key: value`, and
// anything else is an error naming the file and the line. A loose header would bring
// the guessing back through the other door. Values are typed: a date is a date, and an
// ID list holds IDs only (or `—` for none), so an explanation can never ride along in
// `depends_on` and be half-read as a dependency.
//
// The body is split on `## ` headings (outside code fences) and nothing more. Which
// sections an entry must carry is the schema check's business, not this reader's.
//
// No dependencies, deliberately: the repo has none, and the checker runs in a hook.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── The registers ────────────────────────────────────────────────────────────
// PORTING: adjust directories and ID namespaces; keep the shapes.

const ID = /^(P\d+|A-\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Value types. Each returns an error message, or null when the value is good.
const TYPES = {
  id: (v) => (ID.test(v) ? null : `not an ID: "${v}"`),
  text: (v) => (v.trim() ? null : 'empty value'),
  word: (v) => (/^[a-z-]+$/.test(v) ? null : `not a single lowercase word: "${v}"`),
  date: (v) => (DATE.test(v) ? null : `not a YYYY-MM-DD date: "${v}"`),
  ids: (v) => {
    if (v === '—') return null;
    const bad = v.split(/,\s*/).filter((x) => !ID.test(x));
    return bad.length ? `not a comma-separated ID list (or —): "${v}" — prose belongs in the body` : null;
  },
};

export const BACKLOG = {
  dir: 'docs/backlog',
  readme: 'docs/backlog/README.md',
  queue: 'docs/backlog/QUEUE.md',
  idPattern: /^P\d+$/,
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    epic: 'text',
    drafted: 'date',
    depends_on: 'ids',
    resolves: 'ids',
    shipped: 'date',
  },
};

export const ASSUMPTIONS = {
  dir: 'docs/assumptions',
  readme: 'docs/assumptions/README.md',
  idPattern: /^A-\d+$/,
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    raised: 'date',
    resolved: 'date',
    spiked_as: 'ids',
  },
};

export const REGISTERS = [BACKLOG, ASSUMPTIONS];

/** Files in a register directory that are not entries. */
const NOT_ENTRIES = new Set(['README.md', 'QUEUE.md']);

// ── One entry ────────────────────────────────────────────────────────────────

/**
 * Parse one entry file. Never throws: a malformed file comes back with `errors`
 * (each `{ line, msg }`, 1-based) so the checker can report every problem at once.
 */
export function parseEntry(text, keys) {
  const lines = text.split('\n');
  const header = {};
  const headerLine = {};
  const errors = [];
  const err = (line, msg) => errors.push({ line, msg });

  let i = 0;
  if (lines[0] !== '---') {
    err(1, 'no header — an entry starts with a `---` line');
  } else {
    for (i = 1; i < lines.length && lines[i] !== '---'; i++) {
      const m = lines[i].match(/^([a-z_]+): (.*\S)\s*$/);
      if (!m) { err(i + 1, `not a \`key: value\` header line: "${lines[i]}"`); continue; }
      const [, key, value] = m;
      if (!(key in keys)) {
        err(i + 1, `unknown header key \`${key}\` (known: ${Object.keys(keys).join(', ')})`);
        continue;
      }
      if (key in header) { err(i + 1, `duplicate header key \`${key}\``); continue; }
      const bad = TYPES[keys[key]](value);
      if (bad) err(i + 1, `${key}: ${bad}`);
      header[key] = value;
      headerLine[key] = i + 1;
    }
    if (i >= lines.length) err(1, 'header never closes — expected a second `---` line');
    i++;
  }

  // Body: `## ` sections, fences skipped so a template or example is never a section.
  const sections = new Map();
  let cur = null;
  let inFence = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) inFence = !inFence;
    const h = !inFence && l.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (sections.has(h[1])) err(i + 1, `duplicate section \`## ${h[1]}\``);
      cur = [];
      sections.set(h[1], cur);
    } else if (cur) {
      cur.push(l);
    }
  }
  return { header, headerLine, sections, errors };
}

/** The IDs in an ID-list header value; `—` and an absent key are both empty. */
export const idsOf = (entry, key) => {
  const v = entry.header[key];
  return !v || v === '—' ? [] : [...new Set(v.split(/,\s*/).filter((x) => ID.test(x)))];
};

// ── A register ───────────────────────────────────────────────────────────────

/**
 * Every entry file in a register, parsed. `present` is false when the directory does
 * not exist (a project that has not adopted that register). Every `.md` file other
 * than the README and the queue is taken as an entry — parse loosely, validate
 * strictly: a stray `notes.md` is reported for having no header rather than skipped.
 */
export function loadRegister(root, reg) {
  const dir = join(root, reg.dir);
  if (!existsSync(dir)) return { reg, present: false, entries: [] };
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !NOT_ENTRIES.has(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((f) => {
      const file = `${reg.dir}/${f}`;
      const e = parseEntry(readFileSync(join(dir, f), 'utf8'), reg.keys);
      return { file, name: f.replace(/\.md$/, ''), id: e.header.id ?? null, status: e.header.status ?? null, ...e };
    });
  return { reg, present: true, entries };
}

// ── The queue ────────────────────────────────────────────────────────────────

/**
 * The queue file holds the queue and nothing else: `# ` headings, blank lines, and
 * numbered items `N. **P#** — why` (an item may wrap onto indented lines). Any other
 * line is an error, so a note that names an ID can never be read as queueing it.
 */
export function parseQueue(text) {
  const ids = [];
  const errors = [];
  let inItem = false;
  text.split('\n').forEach((l, n) => {
    if (l.trim() === '') return;
    if (/^# /.test(l)) { inItem = false; return; }
    const m = l.match(/^\d+\.\s+\*\*(P\d+)\*\*\s+—\s+\S/);
    if (m) { ids.push(m[1]); inItem = true; return; }
    if (inItem && /^\s+\S/.test(l)) return; // the item above, wrapped
    errors.push({ line: n + 1, msg: `not a queue item (expected "N. **P#** — why"): "${l}"` });
  });
  return { ids, errors };
}
