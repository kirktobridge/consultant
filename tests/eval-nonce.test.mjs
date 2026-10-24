// The eval's nonce (P46) — a reply must echo the nonce its own prompt carried.
//
// Driven through the real CLI, emit then grade, into a temp run directory: the check
// lives where a reply meets its manifest entry, so a unit test of the comparison alone
// would miss a reply saved under the wrong key. The run directory is never under
// evals/runs/, where a leftover would leak into other tests.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, cleanupAll } from './helpers/fixture.mjs';

after(cleanupAll);

const RUN = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals', 'run.mjs');
const CASE = 'depends-gate-refuses-blocked-entry'; // expects: refuse, citing A-1

const ALL_PASS = 0;
const TRANSPORT_FAULT = 2;

function evalRun(args) {
  const r = spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', all: `${r.stdout}\n${r.stderr}` };
}

/** Emit CASE with `reps` reps into a fresh directory; returns it with its manifest. */
function emitted(reps = 2) {
  const dir = tempDir();
  const r = evalRun(['--case', CASE, '--reps', String(reps), '--out', dir]);
  assert.equal(r.code, 0, r.all);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return { dir, manifest, items: manifest.items };
}

const RIGHT = { action: 'refuse', classification: 'not-applicable', cites: ['A-1'], reason: 'A-1 is open.' };
const WRONG = { action: 'proceed', classification: 'not-applicable', cites: ['P2'], reason: 'looks fine.' };

/** A reply as a subagent writes one: prose, then the fenced JSON block. */
const reply = (decision) => `Reasoning above the block.\n\n\`\`\`json\n${JSON.stringify(decision, null, 2)}\n\`\`\`\n`;
const save = (dir, key, text) => writeFileSync(join(dir, 'replies', `${key}.txt`), text);
const grade = (dir) => evalRun(['--grade', dir]);

describe('emit', () => {
  test('each rep gets its own nonce, in its prompt and in the manifest', () => {
    const { dir, items } = emitted(3);
    const nonces = items.map((i) => i.nonce);
    assert.ok(nonces.every((n) => /^[0-9a-f]{8}$/.test(n)), `nonces: ${nonces}`);
    assert.equal(new Set(nonces).size, 3, 'reps of one case must not share a nonce');
    for (const i of items) {
      const prompt = readFileSync(join(dir, 'prompts', `${i.key}.md`), 'utf8');
      assert.ok(prompt.includes(`"nonce": "${i.nonce}"`), `${i.key}'s prompt does not carry its nonce`);
      for (const other of nonces.filter((n) => n !== i.nonce)) {
        assert.ok(!prompt.includes(other), `${i.key}'s prompt carries another rep's nonce`);
      }
    }
  });
});

describe('grade', () => {
  test('a reply copied from one rep into another rep\'s file fails with "nonce mismatch", not as a wrong decision', () => {
    const { dir, items } = emitted(2);
    const [a, b] = items;
    const first = reply({ nonce: a.nonce, ...RIGHT });
    save(dir, a.key, first);
    save(dir, b.key, first); // the copy: a right decision, under the wrong key
    const r = grade(dir);
    assert.equal(r.code, TRANSPORT_FAULT, r.all);
    assert.match(r.stdout, new RegExp(`nonce mismatch: the reply carries "${a.nonce}", which is ${a.key.replace(/\./g, '\\.')}'s`));
    assert.doesNotMatch(r.stdout, /action was|did not cite/, 'a nonce failure must not be graded as a decision');
    assert.match(r.stdout, /failures: 0 decision, 1 nonce/);
    // Left out of the rate, so the prompt is not blamed for a transport fault.
    assert.match(r.stdout, /✔ depends-gate-refuses-blocked-entry {2}1\/1 {2}\(\+1 nonce\)/);
    assert.doesNotMatch(r.stdout, /below the bar/);
    assert.match(r.stdout, new RegExp(`re-run:\\n  ${b.key.replace(/\./g, '\\.')}`));
  });

  test('a reply with no nonce fails with "nonce missing"', () => {
    const { dir, items } = emitted(1);
    save(dir, items[0].key, reply(RIGHT));
    const r = grade(dir);
    assert.equal(r.code, TRANSPORT_FAULT, r.all);
    assert.match(r.stdout, new RegExp(`nonce missing \\(expected "${items[0].nonce}"\\)`));
  });

  test('a reply with the right nonce grades exactly as a run without nonces does', () => {
    // "As today" is the grader before P46: a manifest emitted without nonces still takes
    // that path, so the same replies graded both ways must read the same.
    const { dir, items } = emitted(2);
    save(dir, items[0].key, reply({ nonce: items[0].nonce, ...RIGHT }));
    save(dir, items[1].key, reply({ nonce: items[1].nonce, ...WRONG }));
    const withNonce = grade(dir);

    const manifestPath = join(dir, 'manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...m, items: m.items.map(({ nonce, ...rest }) => rest) }));
    const without = grade(dir);

    const verdicts = (s) => s.split('\n').filter((l) => /^ {2}[✔✖] |^ {8}|^eval: /.test(l));
    assert.equal(withNonce.code, without.code);
    assert.equal(withNonce.code, 1, 'one wrong decision of two is below the bar');
    assert.deepEqual(verdicts(withNonce.stdout), verdicts(without.stdout));
    assert.match(withNonce.stdout, /1\/2/);
    assert.match(withNonce.stdout, /action was "proceed", expected "refuse"/);
    assert.doesNotMatch(withNonce.stdout, /nonce (mismatch|missing)/);
  });

  test('every reply right, nonce and decision, passes', () => {
    const { dir, items } = emitted(2);
    for (const i of items) save(dir, i.key, reply({ nonce: i.nonce, ...RIGHT }));
    const r = grade(dir);
    assert.equal(r.code, ALL_PASS, r.all);
    assert.match(r.stdout, /2\/2/);
    assert.match(r.stdout, /failures: 0 decision, 0 nonce/);
  });

  test('the summary counts nonce failures apart from decision failures', () => {
    const { dir, items } = emitted(3);
    const [ok, wrongDecision, foreign] = items;
    save(dir, ok.key, reply({ nonce: ok.nonce, ...RIGHT }));
    save(dir, wrongDecision.key, reply({ nonce: wrongDecision.nonce, ...WRONG }));
    save(dir, foreign.key, reply({ nonce: 'deadbeef', ...RIGHT })); // a nonce from no prompt in this run
    const r = grade(dir);
    assert.equal(r.code, TRANSPORT_FAULT, r.all);
    assert.match(r.stdout, /failures: 1 decision, 1 nonce/);
    assert.match(r.stdout, /1\/2 {2}\(\+1 nonce\)/);
    assert.match(r.stdout, /nonce mismatch: the reply carries "deadbeef", expected/);
  });

  test('a reply with no JSON block is a decision failure, and the summary says how many', () => {
    const { dir, items } = emitted(2);
    save(dir, items[0].key, reply({ nonce: items[0].nonce, ...RIGHT }));
    save(dir, items[1].key, 'I refuse, because A-1 is open.');
    const r = grade(dir);
    assert.equal(r.code, 1, r.all);
    assert.match(r.stdout, /failures: 1 decision \(1 with no parseable JSON block\), 0 nonce/);
  });

  test('a manifest where only some items carry a nonce is refused, not graded unchecked', () => {
    const { dir, items } = emitted(2);
    const manifestPath = join(dir, 'manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete m.items[1].nonce;
    writeFileSync(manifestPath, JSON.stringify(m));
    for (const i of items) save(dir, i.key, reply({ nonce: items[0].nonce, ...RIGHT }));
    const r = grade(dir);
    assert.equal(r.code, TRANSPORT_FAULT, r.all);
    assert.match(r.stderr, /1 of 2 manifest items carry no nonce/);
  });

  test('a run emitted before nonces grades as before, and says the nonce was not checked', () => {
    const { dir, items } = emitted(1);
    const manifestPath = join(dir, 'manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...m, items: m.items.map(({ nonce, ...rest }) => rest) }));
    save(dir, items[0].key, reply(RIGHT));
    const r = grade(dir);
    assert.equal(r.code, ALL_PASS, r.all);
    assert.match(r.stdout, /nonce not checked/);
  });
});

test('the dry run self-checks the nonce check', () => {
  const r = evalRun(['--dry-run', '--case', CASE]);
  assert.equal(r.code, 0, r.all);
  assert.match(r.stdout, /the nonce check rejects a missing or foreign nonce/);
});
