// The eval's transcript check (P47) — each rep's subagent got its prompt whole and
// used no tools.
//
// Driven through the real CLI: emit a run into a temp directory, write transcripts in
// the harness's format (one JSONL file per subagent under <session>/subagents/), and
// point --transcripts at them. The format is the harness's, observed by hand on
// 2026-10-21; these fixtures copy its shape, not a real transcript.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, utimesSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const RUN = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals', 'run.mjs');
const CASE = 'depends-gate-refuses-blocked-entry';

const CLEAN = 0;
const FLAGGED = 1;
const CANNOT = 2;

function evalRun(args) {
  const r = spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', all: `${r.stdout}\n${r.stderr}` };
}

function emitted(reps = 2) {
  const dir = tempDir();
  const r = evalRun(['--case', CASE, '--reps', String(reps), '--out', dir]);
  assert.equal(r.code, 0, r.all);
  const { items } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const prompt = (i) => readFileSync(join(dir, 'prompts', `${i.key}.md`), 'utf8');
  return { dir, items, prompt };
}

const replyFor = (key) => `Reasoning for ${key}.\n\n\`\`\`json\n{"action":"refuse"}\n\`\`\`\n`;

/**
 * One subagent's transcript: the sent prompt as the parentless string record, then one
 * assistant record per tool call, then the hand-off carrying `reply`. Like the real
 * format, it ends with an `api-request-blob` record replaying the assistant turns, so
 * every test also proves a replayed call is not counted twice.
 */
function transcript(root, agent, { prompt, tools = [], reply = 'a reply', handoffs = 1 }) {
  const sub = join(root, 'session-1', 'subagents');
  mkdirSync(sub, { recursive: true });
  const recs = [{ type: 'user', parentUuid: null, uuid: 'u0', message: { role: 'user', content: prompt } }];
  let id = 0;
  const use = (name, input = {}) => ({ type: 'tool_use', id: `toolu_${agent}_${id++}`, name, input });
  for (const name of tools) {
    recs.push({ type: 'assistant', parentUuid: 'u0', message: { role: 'assistant', content: [use(name)] } });
  }
  for (let i = 0; i < handoffs; i++) {
    recs.push({
      type: 'assistant',
      parentUuid: 'u0',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }, use('SubagentHandback', { message: reply })] },
    });
  }
  const turns = recs.filter((r) => r.type === 'assistant').flatMap((r) => r.message.content);
  recs.push({ type: 'api-request-blob', agentId: agent, message: { role: 'assistant', content: turns } });
  const path = join(sub, `agent-${agent}.jsonl`);
  writeFileSync(path, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
}

const check = (dir, transcripts) => evalRun(['--check-transcripts', dir, '--transcripts', transcripts]);

describe('the prompt arrived whole', () => {
  test('every rep sent its prompt unedited and used no tools: clean', () => {
    const { dir, items, prompt } = emitted(2);
    const t = tempDir();
    // The harness drops the prompt's trailing newline in transit; that is not an edit.
    items.forEach((i, n) => transcript(t, `a${n}`, { prompt: prompt(i).replace(/\n$/, '') }));
    const r = check(dir, t);
    assert.equal(r.code, CLEAN, r.all);
    for (const i of items) assert.match(r.stdout, new RegExp(`✔ ${i.key.replace(/\./g, '\\.')} {2}prompt whole, no tools`));
  });

  test('a rep whose subagent received an edited prompt is named, with the first differing line', () => {
    const { dir, items, prompt } = emitted(2);
    const t = tempDir();
    transcript(t, 'a0', { prompt: prompt(items[0]) });
    const lines = prompt(items[1]).split('\n');
    const original = lines[4];
    lines[4] = 'An edited line the file never had.';
    transcript(t, 'a1', { prompt: lines.join('\n') });
    const r = check(dir, t);
    assert.equal(r.code, FLAGGED, r.all);
    assert.match(r.stdout, new RegExp(`✔ ${items[0].key.replace(/\./g, '\\.')} `));
    const flagged = r.stdout.split('\n').find((l) => l.includes(items[1].key));
    assert.match(flagged, /✖ .*prompt differs at line 5: sent "An edited line the file never had\.", file /);
    assert.ok(flagged.includes(JSON.stringify(original).slice(1, 40)), flagged);
    assert.match(r.stdout, /1 with a prompt that differs/);
  });

  test('a summarized prompt, which lost its nonce, is found by its saved reply and named', () => {
    const { dir, items } = emitted(1);
    const t = tempDir();
    const [i] = items;
    writeFileSync(join(dir, 'replies', `${i.key}.txt`), replyFor(i.key));
    transcript(t, 'a0', { prompt: 'Summary: decide whether to build P2.', reply: replyFor(i.key) });
    const r = check(dir, t);
    assert.equal(r.code, FLAGGED, r.all);
    assert.match(r.stdout, /prompt differs at line 1: sent "Summary: decide whether to build P2\.", file "You are operating/);
  });
});

describe('no tools were used', () => {
  test('a rep whose subagent used any tool is named, with the tools', () => {
    const { dir, items, prompt } = emitted(2);
    const t = tempDir();
    transcript(t, 'a0', { prompt: prompt(items[0]) });
    transcript(t, 'a1', { prompt: prompt(items[1]), tools: ['Read', 'Grep', 'Read'] });
    const r = check(dir, t);
    assert.equal(r.code, FLAGGED, r.all);
    const flagged = r.stdout.split('\n').find((l) => l.includes(items[1].key));
    assert.match(flagged, /✖ .*used tools: Read, Grep \(3 call\(s\)\)/);
    assert.match(r.stdout, /1 that used tools/);
  });

  test('one hand-off is the reply\'s transport and is not counted; a second one is', () => {
    const { dir, items, prompt } = emitted(2);
    const t = tempDir();
    transcript(t, 'a0', { prompt: prompt(items[0]), handoffs: 1 });
    transcript(t, 'a1', { prompt: prompt(items[1]), handoffs: 2 });
    const r = check(dir, t);
    assert.equal(r.code, FLAGGED, r.all);
    assert.match(r.stdout, new RegExp(`✔ ${items[0].key.replace(/\./g, '\\.')} `));
    assert.match(r.stdout, /used tools: SubagentHandback \(1 call\(s\)\)/);
    assert.match(r.stdout, /One SubagentHandback call per rep carries its reply back and is not counted/);
  });
});

describe('transcripts that cannot be found', () => {
  test('no transcripts at all: exits 2 and says where it looked, instead of reporting every rep clean', () => {
    const { dir } = emitted(2);
    const t = tempDir();
    const r = check(dir, t);
    assert.equal(r.code, CANNOT, r.all);
    assert.match(r.stderr, new RegExp(`no subagent transcripts found — looked in ${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.doesNotMatch(r.stdout, /✔/);
  });

  test('a directory that does not exist: exits 2 and names it', () => {
    const { dir } = emitted(1);
    const missing = join(tempDir(), 'nowhere');
    const r = check(dir, missing);
    assert.equal(r.code, CANNOT, r.all);
    assert.ok(r.stderr.includes(`looked in ${missing}`), r.stderr);
  });

  test('one rep with no transcript: the others are checked, and it exits 2 naming that rep', () => {
    const { dir, items, prompt } = emitted(2);
    const t = tempDir();
    transcript(t, 'a0', { prompt: prompt(items[0]) });
    const r = check(dir, t);
    assert.equal(r.code, CANNOT, r.all);
    assert.match(r.stdout, new RegExp(`\\? ${items[1].key.replace(/\./g, '\\.')} {2}no transcript`));
    assert.match(r.stderr, new RegExp(`1 rep\\(s\\) have no transcript[\\s\\S]*${items[1].key.replace(/\./g, '\\.')}`));
  });

  test('a transcript written before the run was emitted is not one of its reps', () => {
    const { dir, items, prompt } = emitted(1);
    const t = tempDir();
    const path = transcript(t, 'a0', { prompt: prompt(items[0]) });
    const old = new Date(Date.now() - 86_400_000);
    utimesSync(path, old, old);
    const r = check(dir, t);
    assert.equal(r.code, CANNOT, r.all);
  });
});

describe('a run the check cannot tie to its transcripts', () => {
  test('a manifest with no valid createdAt exits 2 and says so, rather than blaming the location', () => {
    const { dir, items, prompt } = emitted(1);
    const t = tempDir();
    transcript(t, 'a0', { prompt: prompt(items[0]) });
    const manifestPath = join(dir, 'manifest.json');
    const { createdAt, ...rest } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify(rest));
    const r = check(dir, t);
    assert.equal(r.code, CANNOT, r.all);
    assert.match(r.stderr, /has no valid createdAt/);
  });

  test('a rep whose prompt file is gone is named, and the check exits 2', () => {
    const { dir, items, prompt } = emitted(2);
    const t = tempDir();
    items.forEach((i, n) => transcript(t, `a${n}`, { prompt: prompt(i) }));
    rmSync(join(dir, 'prompts', `${items[1].key}.md`));
    const r = check(dir, t);
    assert.equal(r.code, CANNOT, r.all);
    assert.match(r.stdout, new RegExp(`✔ ${items[0].key.replace(/\./g, '\\.')} `));
    assert.match(r.stdout, /its prompt file is gone/);
  });

  test('--grade and --check-transcripts together are refused, so a pass cannot hide the check', () => {
    const { dir } = emitted(1);
    const r = evalRun(['--grade', dir, '--check-transcripts', dir]);
    assert.equal(r.code, CANNOT, r.all);
    assert.match(r.stderr, /two steps/);
  });
});

test('a saved reply matches its hand-off whatever trailing whitespace the saving added', () => {
  const { dir, items } = emitted(1);
  const t = tempDir();
  const [i] = items;
  writeFileSync(join(dir, 'replies', `${i.key}.txt`), `${replyFor(i.key)}\n\n`);
  transcript(t, 'a0', { prompt: 'Summary: decide whether to build P2.', reply: replyFor(i.key).trimEnd() });
  const r = check(dir, t);
  assert.equal(r.code, FLAGGED, r.all);
  assert.match(r.stdout, /prompt differs at line 1/);
});

test('a re-run rep is settled by its saved reply, not reported twice', () => {
  const { dir, items, prompt } = emitted(1);
  const t = tempDir();
  const [i] = items;
  transcript(t, 'first', { prompt: prompt(i), tools: ['Read'], reply: 'the discarded first answer' });
  transcript(t, 'rerun', { prompt: prompt(i), reply: replyFor(i.key) });

  const before = check(dir, t); // no reply saved yet: two candidates, neither settled
  assert.equal(before.code, FLAGGED, before.all);
  assert.match(before.stdout, /2 transcripts match and none is settled by a saved reply/);

  writeFileSync(join(dir, 'replies', `${i.key}.txt`), replyFor(i.key));
  const after = check(dir, t);
  assert.equal(after.code, CLEAN, after.all);
  assert.match(after.stdout, /prompt whole, no tools {2}\(agent-rerun\.jsonl\)/);
});
