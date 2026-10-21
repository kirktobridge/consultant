// trunk-graph — P11's graph JSON as it is on the integration branch, for every reader.
//
// The graph (`backlog-schema-check.mjs --graph --json`) is the one contract for what
// blocks what; nobody re-derives it. It is read from the trunk, not the checked-out
// copy, for the claim gate's reason: a worktree's registers are as old as its branch.
// So the registers are copied out of git into a temporary directory and the graph runs
// there. A reader that comes through here, and walks the graph with graphIndex, cannot
// disagree with another about which tree it read or what still blocks what.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTERS, dependencyMet } from './entries.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];

/** The graph version these readers understand; a different one is a failure, not a guess. */
export const GRAPH_VERSION = 1;

/**
 * Many blobs in one git call: each spec (`<rev>:<path>`) comes back as its text, or null
 * when it does not exist. One process however large the registers or a history grows.
 */
export function catBlobs(root, specs) {
  if (!specs.length) return [];
  let buf;
  try {
    buf = execFileSync('git', ['-c', 'safe.directory=*', ...WIN, 'cat-file', '--batch'], {
      cwd: root, input: specs.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 << 20,
    });
  } catch { return specs.map(() => null); }
  const out = [];
  let at = 0;
  for (let n = 0; n < specs.length; n++) {
    const nl = buf.indexOf(10, at);
    const head = buf.subarray(at, nl).toString('utf8');
    const m = head.match(/ blob (\d+)$/);
    if (!m) { out.push(null); at = nl + 1; continue; }
    const size = Number(m[1]);
    out.push(buf.subarray(nl + 1, nl + 1 + size).toString('utf8'));
    at = nl + 1 + size + 1;
  }
  return out;
}

/**
 * The graph on `base`: `{ graph, failed, warning }`, exactly one of graph and failed
 * set. `warning` is the schema check's own note that a malformed tree may have dropped
 * an edge. `git` is the caller's wrapper (null on failure). `onTree(dir)` sees the
 * copied registers before the directory goes, for a reader that needs a header the
 * graph does not carry. Never throws: a reader whose graph is optional must not lose
 * the rest of its report to it.
 */
export function trunkGraph({ root, base, git, onTree = null }) {
  let tmp = null;
  let graph = null;
  let failed = null;
  let warning = null;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'trunk-graph-'));
    // docs/research whole: the graph's experiments, and the framework that adopts the track.
    const files = (git('ls-tree', '-r', '--name-only', base, '--', ...REGISTERS.map((r) => r.dir), 'docs/research') || '')
      .split('\n').filter(Boolean);
    catBlobs(root, files.map((f) => `${base}:${f}`)).forEach((text, n) => {
      mkdirSync(dirname(join(tmp, files[n])), { recursive: true });
      writeFileSync(join(tmp, files[n]), text ?? '');
    });
    if (onTree) onTree(tmp);
    const r = spawnSync(process.execPath, [join(HERE, 'backlog-schema-check.mjs'), '--graph', '--json'], {
      cwd: tmp, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
    });
    try { graph = JSON.parse(r.stdout); } catch { graph = null; }
    if (!graph || typeof graph !== 'object' || !Array.isArray(graph.entries)) {
      failed = `the graph did not run on ${base}: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`;
      graph = null;
    } else if (graph.version !== GRAPH_VERSION) {
      failed = `graph version ${graph.version} is not one this reader reads (${GRAPH_VERSION})`;
      graph = null;
    } else if ((r.stderr || '').trim()) {
      warning = r.stderr.trim().split('\n')[0];
    }
  } catch (e) {
    failed = `could not read the graph on ${base}: ${e.message}`;
    graph = null;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  return { graph, failed, warning };
}

/**
 * Walks over a graph: `holds(id)` is /implement's DEPENDS GATE (dependencyMet), not
 * the graph's `open` flag — an abandoned `P#` is closed, and it never ships, so
 * whatever rests on it stays blocked. `blockersOf` is what still holds an entry back,
 * `unblocksOf` the open entries it holds, `downstream` everything beyond those too.
 * `field` is a label, never matched on: each repo names its own headers.
 */
export function graphIndex(graph) {
  const meta = new Map(graph.entries.map((e) => [e.id, e]));
  const live = (id) => meta.get(id)?.open === true;
  const holds = (from) => !dependencyMet(from, meta.get(from)?.status ?? null);
  const blockers = new Map();
  const unblocks = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(v)) m.get(k).push(v); };
  for (const x of graph.edges) {
    if (holds(x.from)) add(blockers, x.to, x.from);
    if (live(x.to)) add(unblocks, x.from, x.to);
  }
  const blockersOf = (id) => blockers.get(id) ?? [];
  const unblocksOf = (id) => unblocks.get(id) ?? [];
  const downstream = (id) => {
    const seen = new Set();
    const todo = [...unblocksOf(id)];
    while (todo.length) { const j = todo.pop(); if (!seen.has(j) && j !== id) { seen.add(j); todo.push(...unblocksOf(j)); } }
    return [...seen];
  };
  return { meta, live, holds, blockersOf, unblocksOf, downstream };
}
