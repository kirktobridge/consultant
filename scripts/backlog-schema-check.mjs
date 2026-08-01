// Backlog schema check — the keystone of the whole system.
//
// The skills orient off the backlogs by *grepping* only `### <ID>` headings and
// `**Status:**` lines — never by reading whole files, which would cost a fortune
// in tokens and still go stale. That grep is only as trustworthy as the format is
// uniform. This script asserts the format, so retrieval is mechanically reliable:
// the benefit of a structured dataset without leaving markdown.
//
// It only *reads* the docs. The single-writer contract (BACKLOG.md ← /ship,
// research/** ← /research) is untouched; drift it surfaces is fixed by that
// file's owner.
//
// The two halves worth understanding before you edit anything:
//
//   ENTRY conditions (open entries carry their fields) are easy to remember and
//   get enforced socially anyway. EXIT conditions (a terminal entry discharged
//   its obligations) are easy to skip, because by then the work feels done. Both
//   are checked here, and the exit half is the one that has actually caught bugs.
//
//   Checks are COLLECTED, not fail-fast, wherever several independent loose ends
//   can exist. Failing on the first hit hides the rest — and in the original
//   project the very case a check was built for got masked by an unrelated hit.
//
// Run: node scripts/backlog-schema-check.mjs   (exit 1 on any violation)
// Wire it into your test command so CI holds it.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DASH = '—'; // em-dash — the canonical heading + SHIPPED separator

// ── Configuration ────────────────────────────────────────────────────────────
// PORTING: adjust ID namespaces and file paths; keep the shapes.

const BACKLOGS = [
  {
    file: 'docs/product/BACKLOG.md',
    idPattern: /^P\d+$/,
    kind: 'product',
    open: new Set(['proposed', 'in-progress', 'partial']),
    terminal: new Set(['shipped', 'deferred', 'abandoned']),
    // Fields every entry carries, and fields only *open* entries carry.
    always: [['Value', /\*\*Value:\*\*/]],
    whileOpen: [['Scope', /\*\*Scope\b/]],
  },
  {
    file: 'docs/research/backlog/experiments.md',
    idPattern: /^(AE|AD)\d+$/,
    kind: 'research',
    open: new Set(['proposed', 'active']),
    terminal: new Set(['won', 'no-win', 'abandoned', 'deferred', 'played-out']),
    always: [],
    whileOpen: [
      ['Objective', /\*\*Objective\b/],
      ['Hypothesis', /\*\*Hypothesis\b/],
      ['Method', /\*\*Method\b/],
      ['Success criteria', /\*\*Success criteria\b/],
      ['Cost', /\*\*Cost\b/],
    ],
  },
];

const FINDINGS = 'docs/research/FINDINGS.md';
const HEADING = new RegExp(`^###\\s+\\S+\\s+${DASH}\\s+\\S`);

// ── Parsing ──────────────────────────────────────────────────────────────────

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const has = (lines, re) => lines.some((l) => re.test(l));

/**
 * Status vocabulary is read *from the document itself* — the backtick-quoted
 * words in its "Status vocab:" line — not hardcoded here. A doc that documents
 * its own vocabulary and a checker that reads it cannot drift apart.
 */
function sectionVocab(text) {
  const out = new Set();
  const m = text.match(/Status vocab[^\n]*(?:\n(?!\n)[^\n]*)*/i);
  if (m) for (const t of m[0].matchAll(/`([^`]+)`/g)) out.add(t[1].toLowerCase());
  return out;
}

function parse(b) {
  const text = read(b.file);
  const lines = text.split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^###\s+(\S+)\s+/);
    if (h) {
      if (cur) entries.push(cur);
      cur = { id: h[1], heading: line, title: line.replace(/^###\s+\S+\s*/, ''), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) entries.push(cur);

  for (const e of entries) {
    const s = e.body.find((l) => /\*\*Status:\*\*/.test(l));
    const tok = s?.match(/\*\*Status:\*\*\s*`?([a-z-]+)`?/i);
    e.statusToken = tok ? tok[1].toLowerCase() : null;
  }
  return { file: b.file, entries, vocab: sectionVocab(text), nextUp: parseNextUp(lines) };
}

function parseNextUp(lines) {
  const out = [];
  let inBlock = false;
  for (const l of lines) {
    if (/^##\s+Next up/i.test(l)) { inBlock = true; continue; }
    if (inBlock && /^##\s/.test(l)) break;
    if (inBlock) for (const m of l.matchAll(/\*\*((?:P|AE|AD)\d+)\*\*/g)) out.push(m[1]);
  }
  return [...new Set(out)];
}

const labelled = (body, re) => {
  const i = body.findIndex((l) => re.test(l));
  if (i < 0) return [];
  const out = [body[i]];
  for (let j = i + 1; j < body.length && /^\s+\S/.test(body[j]); j++) out.push(body[j]);
  return out;
};

const draftedOn = (body) =>
  body.find((l) => /\*\*Drafted:\*\*/.test(l))?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

const terminalDateOf = (body) =>
  body.find((l) => /\*\*(Shipped|Closed|Landed):\*\*/.test(l))?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ??
  null;

const dependsOn = (body) =>
  [...labelled(body, /\*\*Depends on:\*\*/).join(' ').matchAll(/\b((?:P|AE|AD)\d+)\b/g)].map(
    (m) => m[1],
  );

// ── Checks ───────────────────────────────────────────────────────────────────

const problems = [];
const fail = (msg) => problems.push(msg);

const present = BACKLOGS.filter((b) => existsSync(join(ROOT, b.file)));
const parsed = present.map(parse);
const byId = new Map(parsed.flatMap((p) => p.entries.map((e) => [e.id, e])));
const cfgOf = (file) => present.find((b) => b.file === file);

for (const p of parsed) {
  const b = cfgOf(p.file);

  if (p.entries.length === 0) fail(`${p.file}: no \`### \` entries parsed`);
  if (p.vocab.size === 0) fail(`${p.file}: no documented status vocabulary resolved`);

  // — heading shape, ID namespace, uniqueness —
  for (const e of p.entries) {
    if (!HEADING.test(e.heading)) fail(`${p.file}: malformed heading: ${e.heading}`);
    if (!b.idPattern.test(e.id)) fail(`${p.file}: ID out of namespace: ${e.heading}`);
    // SHIPPED is a canonical ` — SHIPPED` suffix, never baked into the title: a
    // status baked into a title is invisible to a status grep and survives the
    // flip that should have removed it. Matched on the uppercase marker only —
    // the word "shipped" in ordinary title prose is not a status claim.
    if (/SHIPPED/.test(e.title.replace(new RegExp(`\\s*${DASH}\\s*SHIPPED\\s*$`), ''))) {
      fail(`${p.file}: SHIPPED in title, not suffix: ${e.heading}`);
    }
  }
  const ids = p.entries.map((e) => e.id);
  if (new Set(ids).size !== ids.length) fail(`${p.file}: duplicate ID within file`);

  // — status drawn from the vocabulary the doc itself documents —
  for (const e of p.entries) {
    if (!e.statusToken) { fail(`${p.file}: no **Status:** line for ${e.id}`); continue; }
    if (p.vocab.size && !p.vocab.has(e.statusToken)) {
      fail(`${p.file}: status "${e.statusToken}" for ${e.id} not in vocab {${[...p.vocab].join(', ')}}`);
    }
  }

  // — required fields: always-fields on every entry, open-fields while open —
  // Terminal entries legitimately compress to a status + a log link.
  for (const e of p.entries) {
    for (const [label, re] of b.always) {
      if (!has(e.body, re)) fail(`${p.file}: ${e.id} missing **${label}**`);
    }
    if (!b.open.has(e.statusToken ?? '')) continue;
    for (const [label, re] of b.whileOpen) {
      if (!has(e.body, re)) fail(`${p.file}: open ${e.id} missing **${label}**`);
    }
  }

  // — every open entry is dated —
  // An entry is a snapshot of what was true when someone wrote it. Without a
  // date, a claim drafted before the code it describes is indistinguishable from
  // one written this morning — which is how an entry gets built against a premise
  // two other entries had already voided. The date is what makes the premise gate
  // *affordable*: re-verify the old ones rather than all of them.
  const today = new Date().toISOString().slice(0, 10);
  for (const e of p.entries) {
    if (!b.open.has(e.statusToken ?? '')) continue;
    const d = draftedOn(e.body);
    if (!d) { fail(`${p.file}: open ${e.id} has no **Drafted:** YYYY-MM-DD`); continue; }
    if (d > today) fail(`${p.file}: ${e.id} is drafted in the future (${d})`);
  }

  // — an open entry older than a dependency that has since landed —
  // Presumptively stale: the dependency usually moved the very code the entry
  // describes. This does not mean the entry is wrong — it means nobody may build
  // it without re-checking against the code and re-dating it. Conservative by
  // construction: fires only when *both* dates parse, so a missing date never
  // invents an alarm.
  for (const e of p.entries) {
    if (!b.open.has(e.statusToken ?? '')) continue;
    const drafted = draftedOn(e.body);
    if (!drafted) continue; // the check above owns that failure
    for (const depId of dependsOn(e.body)) {
      const dep = byId.get(depId);
      if (!dep) continue;
      const depCfg = cfgOf(parsed.find((q) => q.entries.includes(dep))?.file);
      if (!depCfg?.terminal.has(dep.statusToken ?? '')) continue;
      const landed = terminalDateOf(dep.body);
      if (!landed || landed <= drafted) continue;
      fail(
        `${p.file}: ${e.id} (drafted ${drafted}) depends on ${depId}, which landed ${landed} — ` +
          `presumptively stale. Re-verify its claims against the code and bump **Drafted:**, ` +
          `or rescope it, before building.`,
      );
    }
  }

  // — `## Next up` never dangles or goes stale —
  if (p.nextUp.length === 0) fail(`${p.file} has no \`## Next up\` IDs`);
  for (const id of p.nextUp) {
    const e = p.entries.find((x) => x.id === id);
    if (!e) { fail(`${p.file}: Next-up ID ${id} has no entry`); continue; }
    if (b.terminal.has(e.statusToken ?? '')) {
      fail(`${p.file}: Next-up ${id} is terminal ("${e.statusToken}") — refresh the queue`);
    }
  }

  if (b.kind !== 'research') continue;

  // — every `won` entry names where it deployed (the CLOSE side) —
  // A won result with no owner is inventory, not value. The intent is easy to
  // bury in prose ("ship the knob eventually"), where nothing can grep it and
  // nobody is accountable. A structured field is checkable; a sentence is not.
  for (const e of p.entries) {
    if (e.statusToken !== 'won') continue;
    if (!has(e.body, /\*\*Deploys as:\*\*/)) {
      fail(
        `${p.file}: won ${e.id} has no **Deploys as:** — name the product P#, the ` +
          `retune-in-place task, or "no deployment surface"`,
      );
    }
  }

  // — a `won` entry whose deployment target already shipped —
  // The direction that actually burns you. The staleness check above reads an
  // entry's own `Depends on:` and looks *backward*; it fires only on a dependency
  // the entry names. But research amends product scope from the *outside*: a won
  // experiment names a product entry that was drafted first and never mentions it.
  // So the product item gets built, verified and landed with the experiment's
  // delta missing, and every gate passes, because nothing read the pointer aimed
  // at it.
  //
  // The escape hatch is a LEADING marker on the `Deploys as:` line, not the word
  // "shipped" loose in the prose. Written the loose way first, the original check
  // exempted the very entry it was built for — whose block happened to call some
  // *other* constant "already the shipped value". A keyword anywhere in a
  // paragraph cannot express "this result landed"; a marker in a fixed position
  // can.
  const loose = [];
  for (const e of p.entries) {
    if (e.statusToken !== 'won') continue;
    const block = labelled(e.body, /\*\*Deploys as:\*\*/);
    if (block.length === 0) continue; // presence check above owns that
    if (/\*\*Deploys as:\*\*\s*(shipped|landed|deployed)\b/i.test(block[0])) continue;
    for (const pid of new Set([...block.join(' ').matchAll(/\bP\d+\b/g)].map((m) => m[0]))) {
      const target = byId.get(pid);
      const tCfg = cfgOf(parsed.find((q) => q.entries.includes(target))?.file);
      if (!target || !tCfg?.terminal.has(target.statusToken ?? '')) continue;
      loose.push(`${e.id} → ${pid} (${target.statusToken})`);
    }
  }
  if (loose.length) {
    fail(
      `${p.file}: a \`won\` result points at an already-terminal product entry, and its ` +
        `**Deploys as:** never says it shipped: ${loose.join('; ')}. Either the result ` +
        `landed (record that in **Deploys as:**) or the product entry shipped without it ` +
        `and the win is inventory. Check against the code — the answer is usually one ` +
        `grep, and only a human can tell the two apart.`,
    );
  }
}

// — IDs are globally unique across all backlogs —
const all = parsed.flatMap((p) => p.entries.map((e) => e.id));
const dupes = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))];
if (dupes.length) fail(`duplicate IDs across backlogs: ${dupes.join(', ')}`);

// — findings carry their scope tag —
// PORTING: this enforces that a claim states the context it was measured in, so a
// constant tuned under one configuration is never silently read as universal.
// Set SCOPE_TAGGED_FROM to the first finding number the rule binds from; earlier
// ones are grandfathered (the rule usually exists *because* they didn't say).
const SCOPE_TAGGED_FROM = 1;
const SCOPE_VOCAB = ['default', 'variant-a', 'variant-b', 'both', 'mechanism'];
if (existsSync(join(ROOT, FINDINGS))) {
  const tag = new RegExp(`\\*\\*\\((${SCOPE_VOCAB.join('|')})\\)\\*\\*`, 'i');
  const text = read(FINDINGS).split('\n');
  let cur = null;
  const findings = [];
  for (const l of text) {
    const h = l.match(/^###\s+F(\d+)\b/);
    if (h) { if (cur) findings.push(cur); cur = { n: +h[1], body: [] }; }
    else if (cur) cur.body.push(l);
  }
  if (cur) findings.push(cur);
  for (const f of findings) {
    if (f.n < SCOPE_TAGGED_FROM) continue;
    if (!f.body.some((l) => tag.test(l))) {
      fail(`${FINDINGS}: F${f.n} has no scope tag — add one of **(${SCOPE_VOCAB.join(')** / **(')})**`);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(`backlog-schema: ${problems.length} violation(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`backlog-schema: OK (${all.length} entries across ${parsed.length} backlog(s))`);
