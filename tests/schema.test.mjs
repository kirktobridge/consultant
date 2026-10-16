// Layer 1 — does the schema check still bite?
//
// LESSONS L3: a check that stopped looking passes exactly like a check that found
// nothing. Every case here feeds it input that is *known bad* and asserts it fails.
// The green run on the real docs proves nothing on its own; these prove the green
// run means something.
//
// Several assertions are on message *wording*. That is deliberate, not brittleness
// theatre: the messages are the interface skills act on. A violation reworded from
// "the queue is the dependency-ready head" into something vague would keep every
// check green while quietly removing the reason anyone obeys it.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { P, OD, project, schema, run, out, cleanupAll, daysAgo, daysAhead } from './helpers/fixture.mjs';

after(cleanupAll);

const fails = (dir, needle) => {
  const r = schema(dir);
  assert.equal(r.code, 1, `expected a violation, got exit ${r.code}:\n${out(r)}`);
  if (needle) assert.match(out(r), needle);
  return out(r);
};
const passes = (dir) => {
  const r = schema(dir);
  assert.equal(r.code, 0, `expected clean, got exit ${r.code}:\n${out(r)}`);
  return out(r);
};
const patch = (dir, rel, from, to) => {
  const f = join(dir, rel);
  writeFileSync(f, readFileSync(f, 'utf8').replaceAll(from, to));
};

describe('baseline', () => {
  test('a minimal valid project passes', () => {
    passes(project());
  });

  test('the entry count is reported — it is the positive control (L3)', () => {
    const o = passes(project({ backlog: [P('P1'), P('P2', { status: 'shipped' })] }));
    assert.match(o, /OK \(2 entries across 1 register\(s\)\)/);
  });
});

describe('required fields', () => {
  test('an entry with no Value fails', () => {
    fails(project({ backlog: [P('P1', { value: null })] }), /missing \*\*Value\*\*/);
  });

  test('an OPEN entry with no Scope fails', () => {
    fails(project({ backlog: [P('P1', { scope: null })] }), /open P1 missing \*\*Scope\*\*/);
  });

  test('a TERMINAL entry with no Scope passes — terminal entries may compress', () => {
    passes(project({ backlog: [P('P1'), P('P9', { status: 'shipped', scope: null })] }));
  });

  test('an OPEN entry with no Accept fails', () => {
    fails(project({ backlog: [P('P1', { accept: null })] }), /open P1 missing \*\*Accept\*\*/);
  });

  test('a TERMINAL entry with no Accept passes — terminal entries may compress', () => {
    passes(project({ backlog: [P('P1'), P('P9', { status: 'shipped', accept: null })] }));
  });

  test('an open entry with no Drafted date fails', () => {
    fails(project({ backlog: [P('P1', { drafted: null })] }), /no `drafted: YYYY-MM-DD`/);
  });

  test('a future-dated entry fails', () => {
    fails(project({ backlog: [P('P1', { drafted: daysAhead(30) })] }), /drafted in the future/);
  });
});

// The field's failure mode is not absence — it's degrading into ceremony: one
// unfalsifiable sentence restating Value. Presence alone would pass that. These
// pin the bound that makes the field mean something.
describe('Accept criteria are counted, not just present', () => {
  const accept = (n) => Array.from({ length: n }, (_, i) => `observable check ${i + 1}.`);

  test('one criterion fails, and the message says the range', () => {
    const o = fails(project({ backlog: [P('P1', { accept: accept(1) })] }), /1 \*\*Accept\*\* criterion/);
    assert.match(o, /expected 2–4/);
  });

  test('five criteria fail', () => {
    fails(project({ backlog: [P('P1', { accept: accept(5) })] }), /5 \*\*Accept\*\* criteria/);
  });

  test('two and four both pass — the bounds are inclusive', () => {
    passes(project({ backlog: [P('P1', { accept: accept(2) })] }));
    passes(project({ backlog: [P('P1', { accept: accept(4) })] }));
  });

  test('the label with nothing under it fails', () => {
    fails(project({ backlog: [P('P1', { accept: [] })] }), /0 \*\*Accept\*\* criteria/);
  });

  test('one unfalsifiable sentence under the heading fails — the ceremony case', () => {
    const dir = project({ backlog: [P('P1', { accept: [] })] });
    patch(dir, 'docs/backlog/P1.md', '## Accept', '## Accept\n\nit works.');
    fails(dir, /0 \*\*Accept\*\* criteria/);
  });

  // Found by the field's own backlog entry: an entry whose Scope *describes* the
  // Accept field mentions `**Accept:**` in prose, and an unanchored probe read that
  // as the field being present — so the one entry most about acceptance criteria
  // shipped without any.
  test('the field name in prose is not the field — the probe is anchored', () => {
    const dir = project({ backlog: [P('P1', { accept: null, scope: 'add an `**Accept:**` field.' })] });
    fails(dir, /open P1 missing \*\*Accept\*\*/);
  });

  test('a missing Accept raises one violation, not two', () => {
    const o = fails(project({ backlog: [P('P1', { accept: null })] }));
    assert.match(o, /backlog-schema: 1 violation/);
  });

  test('a TERMINAL entry is not counted — only open entries carry the contract', () => {
    passes(project({ backlog: [P('P1'), P('P9', { status: 'shipped', accept: accept(1) })] }));
  });

  test("a following section's bullets are not counted as Accept's", () => {
    passes(project({ backlog: [P('P1', { accept: accept(2), notes: '- nothing\n- really\n- more' })] }));
  });

  // P9 left this open: an indented sub-bullet was read as a field. Here only top-level
  // bullets are criteria, so detail under a criterion is never counted as another.
  test('indented sub-bullets under a criterion are not criteria', () => {
    const accept = ['one check.\n  - detail\n  - more detail\n  - still more', 'another check.'];
    passes(project({ backlog: [P('P1', { accept })] }));
  });
});

describe('status vocabulary is read from the document', () => {
  test('a status outside the documented vocab fails', () => {
    fails(project({ backlog: [P('P1', { status: 'wibble' })] }), /not in vocab/);
  });

  test('an entry with no status in its header fails', () => {
    fails(project({ backlog: [P('P1', { status: null })] }), /docs\/backlog\/P1\.md: no `status:` in the header/);
  });

  test('a doc with no documented vocab at all fails loudly', () => {
    const dir = project();
    patch(dir, 'docs/backlog/README.md', 'Status vocab:', 'Statuses we use:');
    fails(dir, /no documented status vocabulary resolved/);
  });
});

describe('the Next up queue', () => {
  test('an empty queue fails', () => {
    fails(project({ nextUp: [] }), /QUEUE\.md has no queued IDs/);
  });

  test('a queued ID with no entry fails', () => {
    fails(project({ nextUp: ['P1', 'P42'] }), /Next-up ID P42 has no entry/);
  });

  test('a queued ID that has gone terminal fails', () => {
    fails(
      project({ backlog: [P('P1', { status: 'shipped' })], nextUp: ['P1'] }),
      /Next-up P1 is terminal/,
    );
  });
});

describe('graduated OD blocking — severity tracks proximity to the work', () => {
  const od = () => OD('OD-1');
  const blocked = (status) => P('P2', { status, dependsOn: ['OD-1'] });

  test('PARKED: proposed, not queued, open OD → passes (blocked-not-rejected)', () => {
    passes(project({ backlog: [P('P1'), blocked('proposed')], decisions: [od()], nextUp: ['P1'] }));
  });

  test('QUEUED: the same entry in Next up → fails', () => {
    const o = fails(
      project({ backlog: [P('P1'), blocked('proposed')], decisions: [od()], nextUp: ['P1', 'P2'] }),
      /P2 is in Next up but depends on OD-1, still `open`/,
    );
    assert.match(o, /dependency-ready/, 'the message must say why the queue is the line');
  });

  test('CLAIMED: in-progress → fails, regardless of the queue', () => {
    fails(
      project({ backlog: [P('P1'), blocked('in-progress')], decisions: [od()], nextUp: ['P1'] }),
      /P2 is `in-progress` but depends on OD-1, still `open`/,
    );
  });

  test('CLAIMED: partial is treated as claimed too', () => {
    fails(
      project({ backlog: [P('P1'), blocked('partial')], decisions: [od()], nextUp: ['P1'] }),
      /P2 is `partial`/,
    );
  });

  test('a verified OD lifts the block entirely', () => {
    passes(
      project({
        // Resolution predates the entry, so the staleness rule below stays out of it
        // and this isolates the block itself.
        backlog: [P('P1'), P('P2', { status: 'in-progress', drafted: daysAgo(10), dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1', { status: 'verified', resolved: daysAgo(40), resolution: 'held.' })],
        nextUp: ['P1'],
      }),
    );
  });

  // A refuted assumption is the urgent case — dependents may be VOID rather than
  // unblocked — and no rule targets it. But coverage is not zero, and the boundary is
  // not where you would guess, so both halves are pinned.

  test('a refuted OD: an entry drafted BEFORE the refutation is caught, by staleness', () => {
    fails(
      project({
        backlog: [P('P1'), P('P2', { drafted: daysAgo(40), dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1', { status: 'refuted', resolved: daysAgo(10), resolution: 'wrong.' })],
        nextUp: ['P1'],
      }),
      /presumptively stale/,
    );
  });

  test('KNOWN GAP: an entry drafted AFTER a refutation rests on it unchallenged', () => {
    // Nothing fires: the block lifts (only `open` blocks) and staleness cannot see it
    // (the entry is newer than the resolution). Sweeping refuted dependents is prose
    // in /ship and /triage groom, held by nobody.
    //
    // Pinned so the gap is a decision rather than a discovery. If a refuted-OD gate is
    // ever added this test SHOULD fail — change it knowingly.
    passes(
      project({
        backlog: [P('P1'), P('P2', { status: 'in-progress', drafted: daysAgo(5), dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1', { status: 'refuted', resolved: daysAgo(30), resolution: 'wrong.' })],
        nextUp: ['P1'],
      }),
    );
  });

  test('a dangling OD reference fails at ANY status — broken audit trail', () => {
    fails(
      project({ backlog: [P('P1'), P('P2', { status: 'shipped', dependsOn: ['OD-99'] })] }),
      /P2 depends on OD-99, which has no entry/,
    );
  });

  test('an ID listed twice in depends_on raises ONE violation', () => {
    // An inflated count is not cosmetic: the count is the positive control (L3).
    const o = fails(
      project({
        backlog: [P('P1'), P('P2', { dependsOn: ['OD-1', 'OD-1'] })],
        decisions: [od()],
        nextUp: ['P1', 'P2'],
      }),
    );
    assert.match(o, /^backlog-schema: 1 violation\(s\)/m);
  });
});

describe('spike ↔ assumption pairing', () => {
  test('an open spike pointing at an open OD passes — the normal live state', () => {
    passes(
      project({
        backlog: [P('P1'), P('P9', { resolves: 'OD-1' })],
        decisions: [OD('OD-1')],
        nextUp: ['P1'],
      }),
    );
  });

  test('an open spike pointing at an already-settled OD fails as obsolete', () => {
    fails(
      project({
        backlog: [P('P1'), P('P9', { resolves: 'OD-1' })],
        decisions: [OD('OD-1', { status: 'refuted', resolved: daysAgo(1), resolution: 'wrong.' })],
        nextUp: ['P1'],
      }),
      /open P9 resolves OD-1, but OD-1 is already `refuted`/,
    );
  });

  test('a SHIPPED spike whose OD is still open fails — the answer never came back', () => {
    const o = fails(
      project({
        backlog: [P('P1'), P('P9', { status: 'shipped', resolves: 'OD-1' })],
        decisions: [OD('OD-1')],
        nextUp: ['P1'],
      }),
      /P9 shipped and resolves OD-1, but OD-1 is still `open`/,
    );
    assert.match(o, /inventory/, 'the message must name the failure mode (L2)');
  });

  test('a spike pointing at a nonexistent OD fails', () => {
    fails(
      project({ backlog: [P('P1'), P('P9', { resolves: 'OD-77' })] }),
      /P9 resolves OD-77, which has no entry/,
    );
  });
});

describe('staleness', () => {
  test('an entry drafted BEFORE a dependency landed is flagged presumptively stale', () => {
    fails(
      project({
        backlog: [
          P('P1'),
          P('P2', { drafted: daysAgo(200), dependsOn: ['P3'] }),
          P('P3', { status: 'shipped', shipped: daysAgo(60) }),
        ],
        nextUp: ['P1'],
      }),
      /P2 \(drafted .*\) depends on P3, which landed .*presumptively stale/s,
    );
  });

  test('an entry drafted AFTER its dependency landed is fine', () => {
    passes(
      project({
        backlog: [
          P('P1'),
          P('P2', { drafted: daysAgo(10), dependsOn: ['P3'] }),
          P('P3', { status: 'shipped', shipped: daysAgo(60) }),
        ],
        nextUp: ['P1'],
      }),
    );
  });
});

describe('identity and ID hygiene', () => {
  test('an ID outside its register namespace fails', () => {
    fails(project({ backlog: [P('P1')], decisions: [OD('P5')] }), /docs\/decisions\/P5\.md: ID out of namespace: P5/);
  });

  test('a header id that does not match its file name fails', () => {
    const dir = project();
    patch(dir, 'docs/backlog/P1.md', 'id: P1', 'id: P3');
    fails(dir, /P1\.md: header id P3 does not match the file name/);
  });

  test('SHIPPED in a title fails — the status lives in the header', () => {
    fails(project({ backlog: [P('P1', { title: 'SHIPPED thing' })] }), /SHIPPED in title/);
  });

  test('a template inside a fenced block is not read as a section', () => {
    const notes = '```markdown\n## Accept\n\n- shown here.\n- as an example.\n```';
    fails(project({ backlog: [P('P1', { accept: null, notes })] }), /open P1 missing \*\*Accept\*\*/);
  });
});

// P20. The header is the only place a field lives. An entry *about* a field names it
// in prose, and before the split every reader had to guess which mention was the
// field. These walk every required section and header key the checker reports, so
// one added to its config later is covered without anyone adding a test for it.
describe('only the header is read: prose about a field is never the field', () => {
  const fields = JSON.parse(run('backlog-schema-check.mjs', ['--fields']).stdout);
  const fileIn = (dir) => `${dir}/${dir.endsWith('backlog') ? 'P1' : 'OD-1'}.md`;

  // Drop the section from the one entry in `rel`, and add a prose section that names
  // it in every shape it used to be written in.
  const proseOnly = (dir, rel, label) => {
    const f = join(dir, rel);
    const text = readFileSync(f, 'utf8');
    const i = text.indexOf(`## ${label}\n`);
    assert.ok(i >= 0, `fixture has no ${label} section in ${rel}`);
    const next = text.indexOf('\n## ', i + 1);
    const rest = next < 0 ? '' : text.slice(next + 1);
    writeFileSync(f, `${text.slice(0, i)}${rest}\n## Prose\n\nthis entry describes the \`## ${label}\` section.\n- **${label}:** as a bullet, too.\n`);
  };

  // Positive control: an empty or truncated list would make the walk below pass by
  // walking nothing (L3).
  test('the probe list covers both registers', () => {
    assert.ok(fields['docs/backlog'].required.includes('Accept'));
    assert.ok(fields['docs/decisions'].required.includes('Assumption'));
    assert.ok(fields['docs/backlog'].keys.includes('depends_on'));
  });

  for (const [regDir, { required }] of Object.entries(fields)) {
    for (const label of required) {
      test(`${regDir}: naming ${label} in prose does not count as carrying it`, () => {
        const dir = project({ backlog: [P('P1')], decisions: [OD('OD-1')] });
        passes(dir); // the fixture is valid before the section is taken away
        proseOnly(dir, fileIn(regDir), label);
        fails(dir, new RegExp(`missing \\*\\*${label}\\*\\*`));
      });
    }
  }

  // Accept criterion 1. Every header key, written as a header line, in the body: none
  // of them may change what the checker reads. If `status: shipped` were read, the
  // queue would call P2 terminal; if `depends_on: OD-2` were read, OD-2 (verified)
  // would join the real, open OD-1.
  test('an entry whose prose says `status: shipped` or `depends_on: OD-3` is unaffected', () => {
    const notes = 'status: shipped\ndepends_on: OD-2\nresolves: OD-2\n**Depends on:** OD-2\n- **Status:** shipped';
    const o = fails(
      project({
        backlog: [P('P1'), P('P2', { notes, dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1'), OD('OD-2', { status: 'verified', resolved: daysAgo(40), resolution: 'held.' })],
        nextUp: ['P1', 'P2'],
      }),
      /P2 is in Next up but depends on OD-1, still `open`/,
    );
    assert.doesNotMatch(o, /terminal/, 'body prose was read as the status');
    assert.doesNotMatch(o, /OD-2/, 'body prose was read as a dependency or a spike pairing');
    assert.match(o, /^backlog-schema: 1 violation/m);
  });
});

describe('the header is strict — every line is a known `key: value`', () => {
  // Accept criterion 2: the message names the file and the line.
  test('an unknown key is rejected, naming the file and the line', () => {
    const dir = project();
    patch(dir, 'docs/backlog/P1.md', 'status: proposed\n', 'status: proposed\npriority: high\n');
    const o = fails(dir, /docs\/backlog\/P1\.md:5: unknown header key `priority`/);
    assert.match(o, /known: id, title, status/, 'the message should say what is allowed');
  });

  test('a line that is not `key: value` is rejected, naming the file and the line', () => {
    const dir = project();
    patch(dir, 'docs/backlog/P1.md', 'status: proposed\n', 'status: proposed\njust some words\n');
    fails(dir, /docs\/backlog\/P1\.md:5: not a `key: value` header line/);
  });

  test('a blank line inside the header is rejected', () => {
    const dir = project();
    patch(dir, 'docs/backlog/P1.md', 'status: proposed\n', 'status: proposed\n\n');
    fails(dir, /P1\.md:5: not a `key: value` header line/);
  });

  test('a duplicate key is rejected', () => {
    const dir = project();
    patch(dir, 'docs/backlog/P1.md', 'status: proposed\n', 'status: proposed\nstatus: shipped\n');
    fails(dir, /P1\.md:5: duplicate header key `status`/);
  });

  test('prose in depends_on is rejected — an explanation belongs in the body', () => {
    fails(
      project({ backlog: [P('P1', { dependsOn: ['P3 — once it lands'] })] }),
      /P1\.md:6: depends_on: not a comma-separated ID list/,
    );
  });

  test('a date that is not a date is rejected', () => {
    fails(project({ backlog: [P('P1', { drafted: 'last week' })] }), /P1\.md:\d+: drafted: not a YYYY-MM-DD date/);
  });

  test('a file with no header is reported, not skipped', () => {
    const dir = project();
    writeFileSync(join(dir, 'docs/backlog/notes.md'), '# Notes\n\nSome prose.\n');
    fails(dir, /docs\/backlog\/notes\.md:1: no header/);
  });

  test('a header that never closes is reported', () => {
    const dir = project();
    writeFileSync(join(dir, 'docs/backlog/P2.md'), '---\nid: P2\ntitle: x\nstatus: proposed\n');
    fails(dir, /P2\.md:1: header never closes/);
  });
});

// Accept criterion 3: the queue lives in its own file and holds the queue only.
describe('the queue file holds the queue and nothing else', () => {
  test('a missing queue file fails', () => {
    const dir = project();
    rmSync(join(dir, 'docs/backlog/QUEUE.md'));
    fails(dir, /QUEUE\.md: missing/);
  });

  test('a note naming an ID is rejected, and does not queue the ID', () => {
    const dir = project();
    const f = join(dir, 'docs/backlog/QUEUE.md');
    writeFileSync(f, readFileSync(f, 'utf8') + '\nNote what is absent: **P7** is high payoff.\n');
    const o = fails(dir, /QUEUE\.md:5: not a queue item/);
    assert.doesNotMatch(o, /P7 has no entry/, 'the note was read as queueing P7');
  });

  test('an item may wrap onto indented lines', () => {
    const dir = project();
    patch(dir, 'docs/backlog/QUEUE.md', '— queued.', '— queued, for a reason\n   that runs onto a second line.');
    passes(dir);
  });
});
