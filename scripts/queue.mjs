// queue — QUEUE.md, generated from the dependency graph (P24).
//
// The queue's order is a claim ("this is what to build next"). Ranked by hand, it rests
// on whichever session last wrote it; generated, it is the same whoever runs it, and
// the schema check fails a queue that isn't what this would write.
//
// The order, one rule applied greedily, at most five items:
//
//   1. The product owner's recorded order (MANUAL-ORDER.md, D-3) first: its ready
//      entries, in its order. One that isn't ready is skipped and reported with what
//      holds it, and stays out of the queue.
//   2. Then the ready entry that unblocks the most open entries, counted transitively
//      through `depends_on`. Ties keep their order in the file being replaced (read
//      from the file, not git, so a shallow clone ranks the same); newcomers follow,
//      lowest ID first.
//
// Ready means every dependency is met as /implement's DEPENDS GATE reads it
// (dependencyMet), except that a `P#` picked above it also counts: the queue is worked
// in order. A claimed entry stays a candidate, so a claim never reshuffles the queue.
//
// Usage: node scripts/queue.mjs   rewrite docs/backlog/QUEUE.md (npm run queue)
// Exit: 0 written | 1 written, but the recorded order has lines it ignored | 2 could not
// run (no backlog here)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKLOG, REGISTERS, EXPERIMENTS, loadRegister, idsOf, dependencyMet, registerOf, parseQueue, parseManualOrder,
} from './entries.mjs';

export const QUEUE_MAX = 5;
const WIDTH = 88;
const byNumber = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/** One item, wrapped at WIDTH with its continuation indented, as parseQueue reads it. */
function wrap(line) {
  const out = [];
  let cur = '';
  for (const w of line.split(' ')) {
    if (cur && (cur + ' ' + w).length > WIDTH) { out.push(cur); cur = '   ' + w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  out.push(cur);
  return out.join('\n');
}

/** QUEUE.md's text for `items` (each `{ id, why }`), in their order. */
export function renderQueue(items) {
  return '# Next up\n' +
    (items.length ? '\n' + items.map((it, i) => wrap(`${i + 1}. **${it.id}** — ${it.why}`)).join('\n') + '\n' : '');
}

/**
 * The queue the rule gives, from every parsed entry (any register) and the current
 * queue and recorded-order texts. `standing(id)` says where any ID stands under the
 * rule, for the schema check's message.
 */
export function generateQueue(entries, { queueText = '', manualText = '' } = {}) {
  const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id, e]));
  const isOpen = (e) => registerOf(e.id)?.open.has(e.status ?? '') ?? false;
  const isCandidate = (e) => BACKLOG.idPattern.test(e.id) && BACKLOG.open.has(e.status ?? '');

  // Everything downstream, open entries only: unblocking one entry that unblocks three
  // is worth more than unblocking two dead ends.
  const next = new Map();
  for (const e of byId.values()) {
    if (!isOpen(e)) continue;
    for (const d of idsOf(e, 'depends_on')) {
      if (d !== e.id && byId.has(d) && isOpen(byId.get(d))) next.set(d, [...(next.get(d) ?? []), e.id]);
    }
  }
  const down = new Map();
  const unblocks = (id) => {
    if (down.has(id)) return down.get(id);
    const seen = new Set();
    const todo = [...(next.get(id) ?? [])];
    while (todo.length) {
      const j = todo.pop();
      if (j !== id && !seen.has(j)) { seen.add(j); todo.push(...(next.get(j) ?? [])); }
    }
    down.set(id, [...seen].sort(byNumber));
    return down.get(id);
  };

  // What holds an entry, given the entries picked above it; null when nothing does.
  const holder = (e, picked) => {
    for (const d of idsOf(e, 'depends_on')) {
      const dep = byId.get(d);
      if (picked.has(d) || dependencyMet(d, dep?.status ?? null)) continue;
      return `waits on ${d} (${dep ? dep.status : 'no entry'})`;
    }
    return null;
  };

  const manual = parseManualOrder(manualText);
  const recorded = manual.ids;
  const picked = new Map(); // id → whether the recorded order placed it
  const skipped = [];
  for (const id of recorded) {
    const e = byId.get(id);
    if (picked.has(id) || skipped.some((s) => s.id === id)) continue; // listed twice: the check fails it

    if (!e || !isCandidate(e)) { skipped.push({ id, why: e ? `is \`${e.status}\`` : 'has no entry' }); continue; }
    const h = holder(e, picked);
    if (h) { skipped.push({ id, why: h }); continue; }
    if (picked.size < QUEUE_MAX) picked.set(id, true);
  }

  const inFile = parseQueue(queueText).ids;
  const place = (id) => (inFile.includes(id) ? inFile.indexOf(id) : inFile.length);
  const pool = [...byId.values()].filter((e) => isCandidate(e) && !recorded.includes(e.id));
  while (picked.size < QUEUE_MAX) {
    const ready = pool.filter((e) => !picked.has(e.id) && !holder(e, picked));
    if (!ready.length) break;
    ready.sort((a, b) => unblocks(b.id).length - unblocks(a.id).length || place(a.id) - place(b.id) || byNumber(a.id, b.id));
    picked.set(ready[0].id, false);
  }

  const whyOf = (id) => {
    const e = byId.get(id);
    const title = (e?.header.title ?? id).replace(/\.$/, '');
    const down = unblocks(id);
    return `${title}.${picked.get(id) ? ' In your recorded order.' : ''} ` +
      (down.length ? `Unblocks ${down.join(', ')}.` : 'Unblocks no open entry.');
  };
  const items = [...picked.keys()].map((id) => ({ id, recorded: picked.get(id), unblocks: unblocks(id), why: whyOf(id) }));
  const text = renderQueue(items);

  const standing = (id) => {
    if (picked.has(id)) return picked.get(id) ? 'in your recorded order' : `unblocks ${unblocks(id).length}`;
    const s = skipped.find((x) => x.id === id);
    if (s) return `in your recorded order, but ${s.why}`;
    if (recorded.includes(id)) return `in your recorded order, past the last of ${QUEUE_MAX} slots`;
    const e = byId.get(id);
    if (!e) return 'no entry';
    if (!isCandidate(e)) return `\`${e.status}\``;
    const h = holder(e, picked);
    return h ? `not ready: ${h}` : `unblocks ${unblocks(id).length}`;
  };

  // Whether a queue in this order is dependency-ready on its own terms: each entry
  // ready given the ones above it in `ids`, not given the generator's picks.
  const readyInOrder = (ids) => ids.every((id, i) => {
    const e = byId.get(id);
    return e && isCandidate(e) && !holder(e, new Set(ids.slice(0, i)));
  });

  return { text, items, skipped, standing, whyOf, readyInOrder, manualErrors: manual.errors };
}

/** Why a queue file is not the generated one, naming the IDs on both sides; null if it is. */
export function queueMismatch(fileText, gen) {
  if (fileText === gen.text) return null;
  const have = parseQueue(fileText).ids;
  const want = gen.items.map((i) => i.id);
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    const [h, w] = [have[i], want[i]];
    if (h === w) continue;
    if (!w) return `item ${i + 1} is ${h} (${gen.standing(h)}), but the generator queues ${want.length} item(s)`;
    if (!h) return `it ends at item ${i}, but the generator puts ${w} (${gen.standing(w)}) at item ${i + 1}`;
    return `item ${i + 1} is ${h} (${gen.standing(h)}), but the generator puts ${w} (${gen.standing(w)}) there`;
  }
  return 'its IDs are in the generated order, but its text is not the generated text — the queue holds generated lines only';
}

/** Every entry under `root`, in the registers whose statuses a dependency can name. */
export function loadAll(root) {
  return [...REGISTERS, EXPERIMENTS].flatMap((r) => loadRegister(root, r).entries);
}

const readOr = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!existsSync(join(ROOT, BACKLOG.dir))) {
    console.error(`queue: no ${BACKLOG.dir}/ under ${ROOT} — nothing to generate.`);
    process.exit(2);
  }
  const gen = generateQueue(loadAll(ROOT), {
    queueText: readOr(join(ROOT, BACKLOG.queue)),
    manualText: readOr(join(ROOT, BACKLOG.manualOrder)),
  });
  writeFileSync(join(ROOT, BACKLOG.queue), gen.text);
  console.log(`queue: wrote ${gen.items.length} item(s) to ${BACKLOG.queue}`);
  for (const it of gen.items) console.log(`  ${it.id}  ${it.recorded ? 'recorded order' : `unblocks ${it.unblocks.length}`}`);
  for (const s of gen.skipped) console.log(`  skipped ${s.id} from the recorded order: it ${s.why}`);
  // A malformed line drops out of the recorded order, so it is said here, not only by the check.
  for (const e of gen.manualErrors) console.error(`queue: ${BACKLOG.manualOrder}:${e.line}: ${e.msg} — ignored`);
  process.exit(gen.manualErrors.length ? 1 : 0);
}
