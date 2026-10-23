// titles — every entry in every register, one line each: ID, status, title (P40).
//
// /triage reads this whole list before it classifies an idea, and names the entries
// closest to it by meaning. Its keyword search came first before, and an idea reworded
// from an existing entry shares none of its keywords, so it passed as new. The judging
// stays with the reader: this script prints, it never scores. A similarity score in code
// is a syntactic proxy, and a proxy may flag a duplicate but must never clear one.
//
// The one failure it must not have is a shorter list that looks complete: the entry
// missing from it is exactly the duplicate nobody gets told about. So anything it cannot
// read stops it with exit 2 and no list at all — never a list minus a register.
// A register a project has not adopted is not unreadable: it prints as `not adopted`,
// the way the schema check treats it, so the reader can see what was not searched.
//
// Read from the working tree, like the schema check: /triage and /ship's intake run in
// the main checkout, where a newly filed entry lands.
//
// Exit: 0 the index printed | 2 could not read a register or an entry in it (the
// message names which, and nothing is printed to stdout)
//
// Usage: node scripts/titles.mjs

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKLOG, EXPERIMENTS, REGISTERS, RESEARCH_FRAMEWORK, loadRegister } from './entries.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// The backlog is the one register every project has; the rest are adopted or not. An
// experiment is an idea too (a question to measure), so /triage's search covers it;
// research runs and findings are records of work done, not ideas, and are left out.
// Built from REGISTERS, so a register added there is indexed without touching this file.
const research = existsSync(join(ROOT, RESEARCH_FRAMEWORK));
const SOURCES = [
  ...REGISTERS.map((reg) => ({ reg, required: reg === BACKLOG })),
  { reg: EXPERIMENTS, required: research },
];

const problems = [];
const groups = [];
for (const { reg, required } of SOURCES) {
  let loaded;
  try {
    loaded = loadRegister(ROOT, reg);
  } catch (e) {
    problems.push(`${reg.dir}/: could not be read (${e.code ?? e.message})`);
    continue;
  }
  if (!loaded.present) {
    if (required) {
      problems.push(reg === EXPERIMENTS
        ? `${reg.dir}/: missing, though ${RESEARCH_FRAMEWORK} says the research track is adopted`
        : `${reg.dir}/: missing — every project has a backlog`);
    } else {
      groups.push({ dir: reg.dir, adopted: false, entries: [] });
    }
    continue;
  }
  const entries = [];
  for (const e of loaded.entries) {
    // A header error can leave a field holding the wrong value (a duplicate `status:`
    // keeps the first), so a listed line could carry a stale status. Not read, then.
    if (e.errors.length) {
      const { line, msg } = e.errors[0];
      problems.push(`${e.file}:${line}: ${msg} — run npm run check:docs for every problem in it`);
      continue;
    }
    const { id, status, title } = e.header;
    const lacking = [['id', id], ['status', status], ['title', title]].filter(([, v]) => !v).map(([k]) => k);
    if (lacking.length) {
      problems.push(`${e.file}: no readable ${lacking.join(', ')} — run npm run check:docs for what is wrong with it`);
      continue;
    }
    entries.push({ id, status, title });
  }
  groups.push({ dir: reg.dir, adopted: true, entries });
}

if (problems.length) {
  for (const p of problems) console.error(`titles: ${p}`);
  console.error('titles: printed nothing — a shorter list would look complete. Exit 2.');
  process.exit(2);
}

const lines = [];
for (const g of groups) {
  if (!g.adopted) { lines.push(`# ${g.dir} — not adopted`, ''); continue; }
  lines.push(`# ${g.dir} (${g.entries.length})`);
  for (const e of g.entries) lines.push(`${e.id}\t${e.status}\t${e.title}`);
  lines.push('');
}
const total = groups.reduce((n, g) => n + g.entries.length, 0);
lines.push(`titles: ${total} entries across ${groups.filter((g) => g.adopted).length} register(s)`);
console.log(lines.join('\n'));
