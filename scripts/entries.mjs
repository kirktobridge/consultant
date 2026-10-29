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

const ID = /^(P\d+|B\d+|A-\d+|D-\d+|X\d+|N\d+|F\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A header percent (`80` or `80%`) as a share, 0.8; null unless at least 1 and under 100.
 * Under 1 is refused rather than read: stats.mjs takes `0.6` as a share, so a header
 * reading it as 0.6% would pass a gate the author meant at 60%.
 */
export function percentOf(v) {
  const m = /^(\d+(?:\.\d+)?)%?$/.exec(v ?? '');
  const p = m ? Number(m[1]) : NaN;
  return p >= 1 && p < 100 ? p / 100 : null;
}

/** A header count (`80`) as a number; null unless a whole number above 0. */
export const countOf = (v) => (/^[1-9]\d*$/.test(v ?? '') ? Number(v) : null);

/**
 * The local date as YYYY-MM-DD: what a person dating an entry by hand writes. Not
 * `toISOString()`, which is UTC and so tomorrow in the local evening west of Greenwich
 * (B13). Every script that writes or compares a date takes it from here, so they agree.
 */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Value types. Each returns an error message, or null when the value is good.
const TYPES = {
  id: (v) => (ID.test(v) ? null : `not an ID: "${v}"`),
  text: (v) => (v.trim() ? null : 'empty value'),
  word: (v) => (/^[a-z-]+$/.test(v) ? null : `not a single lowercase word: "${v}"`),
  date: (v) => (DATE.test(v) ? null : `not a YYYY-MM-DD date: "${v}"`),
  // One date per event, oldest first: `rejected:` grows by one with each rejection (B7).
  dates: (v) => {
    const bad = v.split(/,\s*/).filter((x) => !DATE.test(x));
    return bad.length ? `not a comma-separated list of YYYY-MM-DD dates: "${v}"` : null;
  },
  ids: (v) => {
    if (v === '—') return null;
    const bad = v.split(/,\s*/).filter((x) => !ID.test(x));
    return bad.length ? `not a comma-separated ID list (or —): "${v}" — prose belongs in the body` : null;
  },
  // A test's planned sample size (P45).
  count: (v) => (countOf(v) === null ? `not a whole number above 0: "${v}"` : null),
  // A share written as percent, `80` or `80%` (P45).
  percent: (v) => (percentOf(v) === null ? `not a percent from 1 to under 100 (write 60 for 60%, not 0.6): "${v}"` : null),
  // What an open decision waits on: IDs, and/or `user` for the product owner.
  waits: (v) => {
    const bad = v.split(/,\s*/).filter((x) => x !== 'user' && !ID.test(x));
    return bad.length ? `not a comma-separated list of IDs and/or \`user\`: "${v}" — prose belongs in the body` : null;
  },
};

export const BACKLOG = {
  dir: 'docs/backlog',
  readme: 'docs/backlog/README.md',
  queue: 'docs/backlog/QUEUE.md',
  // The product owner's recorded order (D-3): the queue generator puts its ready
  // entries first (P24). Absent means no recorded order.
  manualOrder: 'docs/backlog/MANUAL-ORDER.md',
  idPattern: /^P\d+$/,
  // Intake (ship.mjs file, P55 R3): the ID's prefix, the status an entry opens in, and
  // the header keys its drafter chooses. `id:`, the status and the `dated` key are the
  // script's; the closing keys come with a flip.
  prefix: 'P',
  opening: 'proposed',
  drafts: ['title', 'epic', 'plan', 'depends_on', 'resolves'],
  // The statuses a build may start or resume from: a feature mid-milestone sits
  // `partial` between claims.
  claimed: ['in-progress', 'partial'],
  // Every register's lifecycle: the statuses still open, the ones done for good, the
  // header key dating when an entry's claims were established, and the one dating when
  // it closed. The schema check and groom both close an entry by these (P42).
  open: new Set(['proposed', 'in-progress', 'partial']),
  terminal: new Set(['shipped', 'deferred', 'abandoned']),
  dated: 'drafted',
  closed: 'shipped',
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    epic: 'text',
    drafted: 'date',
    plan: 'word',
    depends_on: 'ids',
    resolves: 'ids',
    shipped: 'date',
    rejected: 'dates',
  },
};

export const ASSUMPTIONS = {
  dir: 'docs/assumptions',
  readme: 'docs/assumptions/README.md',
  idPattern: /^A-\d+$/,
  prefix: 'A-',
  opening: 'open',
  drafts: ['title'],
  open: new Set(['open']),
  terminal: new Set(['verified', 'refuted', 'moot', 'moved']),
  dated: 'raised',
  closed: 'resolved',
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    raised: 'date',
    resolved: 'date',
    spiked_as: 'ids',
    moved_to: 'ids',
  },
};

export const DECISIONS = {
  dir: 'docs/decisions',
  readme: 'docs/decisions/README.md',
  idPattern: /^D-\d+$/,
  prefix: 'D-',
  opening: 'open',
  // A decision answered on the spot is filed open, then decided (owner, 2026-10-27).
  drafts: ['title', 'waiting_on'],
  open: new Set(['open']),
  terminal: new Set(['decided', 'superseded']),
  dated: 'raised',
  closed: 'decided',
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    raised: 'date',
    waiting_on: 'waits',
    decided: 'date',
    leads_to: 'ids',
    superseded_by: 'ids',
  },
};

// Bugs: something that worked, or was meant to, and doesn't. Kept apart from the
// backlog because a bug's shape is a repro and a severity, not a `Value` someone has
// to invent for it (P5).
export const BUGS = {
  dir: 'docs/bugs',
  readme: 'docs/bugs/README.md',
  idPattern: /^B\d+$/,
  prefix: 'B',
  opening: 'open',
  drafts: ['title', 'severity', 'depends_on'],
  claimed: ['in-progress'],
  // Most urgent first. Every open bug is picked up before the queue, in this order,
  // rather than being ranked into it (P5 R1) — so it lives in code, not in QUEUE.md.
  severity: ['critical', 'major', 'minor'],
  open: new Set(['open', 'in-progress']),
  terminal: new Set(['fixed', 'wontfix']),
  dated: 'reported',
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    severity: 'word',
    reported: 'date',
    depends_on: 'ids',
    rejected: 'dates',
  },
};

// The research track (P13): questions a test can't answer, answered from data. Three
// registers, one per document kind photocull keeps — what we intend to measure, what was
// run, and what we now believe. They are not part of the build loop's REGISTERS: nothing
// here is claimed, queued or built. The schema check reads them; /research (P13 R1)
// writes them. docs/research/README.md is the framework they are held to.
export const EXPERIMENTS = {
  dir: 'docs/research/experiments',
  readme: 'docs/research/experiments/README.md',
  idPattern: /^X\d+$/,
  open: new Set(['proposed', 'active']),
  terminal: new Set(['answered', 'abandoned', 'deferred', 'played-out']),
  dated: 'drafted',
  closed: 'closed',
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    kind: 'word',
    drafted: 'date',
    feeds: 'ids',
    depends_on: 'ids',
    // A test's plan, in numbers code can check: the sample size, the decision rule's
    // threshold, and the effect the hypothesis predicts (P45).
    n: 'count',
    bar: 'percent',
    effect: 'percent',
    runs: 'ids',
    closed: 'date',
  },
};

// Append-only: a wrong run stays, marked `retracted`, rather than being rewritten.
export const RUNS = {
  dir: 'docs/research/runs',
  readme: 'docs/research/runs/README.md',
  idPattern: /^N\d+$/,
  // A run is a record, not work: nothing about it is open. Its status is its outcome.
  open: new Set(),
  terminal: new Set(['answered', 'inconclusive', 'abandoned', 'retracted']),
  dated: 'ran',
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    ran: 'date',
    experiment: 'ids',
  },
};

export const FINDINGS = {
  dir: 'docs/research/findings',
  readme: 'docs/research/findings/README.md',
  idPattern: /^F\d+$/,
  open: new Set(['current']),
  terminal: new Set(['retracted']),
  dated: 'recorded',
  keys: {
    id: 'id',
    title: 'text',
    status: 'word',
    confidence: 'word',
    recorded: 'date',
    runs: 'ids',
  },
};

/** The research track's framework: its presence means the track is adopted. */
export const RESEARCH_FRAMEWORK = 'docs/research/README.md';

export const REGISTERS = [BACKLOG, BUGS, ASSUMPTIONS, DECISIONS];

// The registers /implement builds from: a feature (`P#`) or a bug fix (`B#`). Assumptions
// and decisions are settled, not built.
export const BUILDABLE = [BACKLOG, BUGS];

/** The register a buildable ID (`P#` / `B#`) belongs to, or null. */
export const buildableRegister = (id) => BUILDABLE.find((r) => r.idPattern.test(id)) ?? null;

/** The register any ID belongs to, or null. */
export const registerOf = (id) => REGISTERS.find((r) => r.idPattern.test(id)) ?? null;

/**
 * Whether a dependency has stopped holding what depends on it — /implement's DEPENDS
 * GATE, in one place so every script that applies it agrees (P32). A `P#` must be
 * `shipped` (not `partial`), a `B#` `fixed`, an `X#` closed; an assumption or decision
 * holds while `open`, and also once `moved` or `superseded` (B10): neither settled
 * anything, and its dependents must re-point to `moved_to:` / `superseded_by:` first.
 * `status` is the dependency's, or null when it has no entry: a dangling ref is the
 * schema check's to report, and it is not met.
 */
export function dependencyMet(id, status) {
  if (!status) return false;
  if (BACKLOG.idPattern.test(id)) return status === 'shipped';
  if (BUGS.idPattern.test(id)) return status === 'fixed';
  // A decision waiting on an experiment is held until the experiment closes — answered,
  // or given up on. A `deferred` one has not run, so it still holds.
  if (EXPERIMENTS.idPattern.test(id)) return ['answered', 'abandoned', 'played-out'].includes(status);
  // Named, not "anything but open": a status nobody listed holds, so a new one fails closed.
  if (ASSUMPTIONS.idPattern.test(id)) return ['verified', 'refuted', 'moot'].includes(status);
  if (DECISIONS.idPattern.test(id)) return status === 'decided';
  return false;
}

/** Files in a register directory that are not entries. */
const NOT_ENTRIES = new Set(['README.md', 'QUEUE.md', 'MANUAL-ORDER.md']);

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

/**
 * A section's criteria: its top-level bullets, each joined with the lines that continue
 * it, so the schema check counts what the close report quotes (P43). An indented
 * sub-bullet is detail under a criterion, not another one, and is joined to it. A line
 * continues the bullet when it is indented, or unindented straight after it (a lazy
 * wrap); a blank line followed by an unindented one ends it, so a paragraph after the
 * list is not a criterion. Joining changes only whitespace.
 */
export function criteriaOf(lines) {
  const out = [];
  let cur = null;
  let blank = false;
  for (const l of lines ?? []) {
    const m = l.match(/^[-*]\s+(\S.*?)\s*$/);
    if (m) { cur = [m[1]]; out.push(cur); blank = false; continue; }
    if (!l.trim()) { blank = true; continue; }
    if (cur && (/^\s/.test(l) || !blank)) cur.push(l.trim());
    else cur = null;
    blank = false;
  }
  return out.map((c) => c.join(' '));
}

/**
 * A moved assumption's or superseded decision's new home: the IDs its dependents must
 * re-point to, since it settled nothing (B10). Empty for any other entry.
 */
export const newHomeOf = (entry) => {
  const key = { moved: 'moved_to', superseded: 'superseded_by' }[entry?.header?.status];
  return key ? idsOf(entry, key) : [];
};

/**
 * An entry's direct dependencies that still hold it, each `{ id, status, to }` (`to`
 * is newHomeOf's re-point targets). `read(id, reg)` returns the dependency's file text,
 * or null when it has none. Shared by every script that refuses a blocked claim, so they
 * agree on what blocks and on how to say it (describeUnmet, dependencyAdvice). An
 * experiment is looked up too: registerOf covers only the build loop's registers.
 */
export function unmetDependencies(entry, read) {
  return idsOf(entry, 'depends_on').map((id) => {
    const reg = registerOf(id) ?? (EXPERIMENTS.idPattern.test(id) ? EXPERIMENTS : null);
    const text = reg ? read(id, reg) : null;
    const parsed = text ? parseEntry(text, reg.keys) : null;
    return { id, status: parsed?.header.status ?? null, to: newHomeOf(parsed) };
  }).filter((d) => !dependencyMet(d.id, d.status));
}

/** unmetDependencies' list as the refusals print it: `P2 (`proposed`), P9 (no entry)`. */
export const describeUnmet = (unmet) =>
  unmet.map((d) => `${d.id} (${d.status ? `\`${d.status}\`` : 'no entry'})`).join(', ');

/**
 * What to do about unmetDependencies' list, as one sentence with no full stop (the caller
 * ends it): the fix fits what blocks.
 * A moved assumption or superseded decision is forwarded, not settled, so its fix is a
 * re-point to its new home (B10).
 */
export function dependencyAdvice(unmet) {
  const open = unmet.filter((d) => !d.to.length);
  const forwarded = unmet.filter((d) => d.to.length);
  const kind = (re) => open.some((d) => d.status && re.test(d.id));
  const s = [
    kind(/^[PB]\d/) && 'build what it depends on first',
    kind(/^D-/) && 'an open decision is the owner\'s to take',
    kind(/^A-/) && 'an open assumption needs its Resolution',
    kind(/^X\d/) && 'an experiment it waits on has to close',
    open.some((d) => !d.status) && 'a dependency with no entry has to be filed or dropped',
    forwarded.length && `re-point its \`depends_on:\` via /ship: ${forwarded.map((d) => `${d.id} → ${d.to.join(', ')}`).join(', ')}`,
  ].filter(Boolean).join('; ');
  return s && `${s[0].toUpperCase()}${s.slice(1)}`;
}

/** Whether a string is one ID in any register's namespace. */
export const isId = (v) => ID.test(v);

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
    if (/^\d+\.\s+\*\*B\d+\*\*/.test(l)) {
      errors.push({ line: n + 1, msg: `a bug is never ranked into the queue — every open bug is picked up before it, by severity (scripts/next.mjs): "${l}"` });
      return;
    }
    errors.push({ line: n + 1, msg: `not a queue item (expected "N. **P#** — why"): "${l}"` });
  });
  return { ids, errors };
}

/**
 * The recorded order holds IDs only: `# ` headings, blank lines, and numbered items
 * `N. P#`. Any other line is an error, for the same reason as the queue's: a sentence
 * naming an ID can never be read as ordering it.
 */
export function parseManualOrder(text) {
  const ids = [];
  const errors = [];
  text.split('\n').forEach((l, n) => {
    if (l.trim() === '' || /^# /.test(l)) return;
    const m = l.match(/^\d+\.\s+(\S+)\s*$/);
    if (m && BACKLOG.idPattern.test(m[1])) { ids.push(m[1]); return; }
    errors.push({ line: n + 1, msg: `not a recorded-order item (expected "N. P#", one ID and nothing else): "${l}"` });
  });
  return { ids, errors };
}

// ── The dependency graph ─────────────────────────────────────────────────────

/**
 * The `P#` → `P#` edges of `depends_on`, built once for every check that walks them.
 * Only feature dependencies are edges here: an `A-n` or `D-n` is a leaf with its own
 * gate, and chasing one transitively is out of scope (P23).
 *
 * `unmet(id)` is every feature dependency of `id`, direct or through another entry, that
 * is not `shipped`, each with the `path` it was reached by. It walks *through* an unmet
 * entry (what that one waits on is waited on too) and stops at a met one: a shipped
 * dependency is met, whatever it once rested on. Only `shipped` is met — a `partial`
 * one may have shipped the milestone a dependent needs, but `depends_on` cannot say
 * which. `starts` walks from those IDs instead of `id`'s own dependencies, for an entry
 * that is not in the graph (a bug naming features). `cycles` lists each cycle once, as the IDs around it with the first repeated
 * at the end.
 */
export function dependencyGraph(entries) {
  const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id, e]));
  const deps = new Map(
    [...byId.values()].map((e) => [e.id, idsOf(e, 'depends_on').filter((id) => BACKLOG.idPattern.test(id))]),
  );
  const met = (id) => byId.get(id)?.status === 'shipped';

  const unmet = (id, starts = deps.get(id) ?? []) => {
    const found = [];
    const seen = new Set([id]);
    const walk = (next, path) => {
      for (const d of next) {
        if (seen.has(d) || !byId.has(d) || met(d)) continue;
        seen.add(d);
        found.push({ id: d, status: byId.get(d).status, path: [...path, d] });
        walk(deps.get(d) ?? [], [...path, d]);
      }
    };
    walk(starts, [id]);
    return found;
  };

  // Depth-first, colouring nodes: an edge back to a node still on the stack closes a cycle.
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 'open');
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!byId.has(d)) continue;
      if (state.get(d) === 'open') cycles.push([...stack.slice(stack.indexOf(d)), d]);
      else if (!state.has(d)) visit(d);
    }
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of byId.keys()) if (!state.has(id)) visit(id);

  return { deps, unmet, cycles };
}

/**
 * What holds an entry back from a build, so next.mjs's single pick and --count judge it
 * the same way (P37). Feature dependencies with an entry go through `graph`
 * (dependencyGraph over the backlog), direct or through another entry, and the graph
 * judges whether they are met. Every other direct dependency is a leaf — a bug, an
 * assumption, a decision, an experiment — and so is an ID with no entry, which is unmet;
 * `statusOf(id)` gives a leaf's status, or null for no entry. Each hold is
 * `{ id, status, path }`, `path` running from the entry to the hold.
 */
export function holdsOf(entry, graph, statusOf) {
  const inGraph = (id) => BACKLOG.idPattern.test(id) && graph.deps.has(id);
  const direct = idsOf(entry, 'depends_on');
  const features = graph.unmet(entry.id, graph.deps.get(entry.id) ?? direct.filter(inGraph));
  const leaves = direct.filter((id) => !inGraph(id) && !dependencyMet(id, statusOf(id)))
    .map((id) => ({ id, status: statusOf(id), path: [entry.id, id] }));
  return [...features, ...leaves];
}
