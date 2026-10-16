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
import { P, A, D, decidedD, project, schema, run, out, cleanupAll, daysAgo, daysAhead } from './helpers/fixture.mjs';

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

describe('graduated assumption blocking — severity tracks proximity to the work', () => {
  const assumption = () => A('A-1');
  const blocked = (status) => P('P2', { status, dependsOn: ['A-1'] });

  test('PARKED: proposed, not queued, open assumption → passes (blocked-not-rejected)', () => {
    passes(project({ backlog: [P('P1'), blocked('proposed')], assumptions: [assumption()], nextUp: ['P1'] }));
  });

  test('QUEUED: the same entry in Next up → fails', () => {
    const o = fails(
      project({ backlog: [P('P1'), blocked('proposed')], assumptions: [assumption()], nextUp: ['P1', 'P2'] }),
      /P2 is in Next up but depends on A-1, still `open`/,
    );
    assert.match(o, /dependency-ready/, 'the message must say why the queue is the line');
  });

  test('CLAIMED: in-progress → fails, regardless of the queue', () => {
    fails(
      project({ backlog: [P('P1'), blocked('in-progress')], assumptions: [assumption()], nextUp: ['P1'] }),
      /P2 is `in-progress` but depends on A-1, still `open`/,
    );
  });

  test('CLAIMED: partial is treated as claimed too', () => {
    fails(
      project({ backlog: [P('P1'), blocked('partial')], assumptions: [assumption()], nextUp: ['P1'] }),
      /P2 is `partial`/,
    );
  });

  test('a verified assumption lifts the block entirely', () => {
    passes(
      project({
        // Resolution predates the entry, so the staleness rule below stays out of it
        // and this isolates the block itself.
        backlog: [P('P1'), P('P2', { status: 'in-progress', drafted: daysAgo(10), dependsOn: ['A-1'] })],
        assumptions: [A('A-1', { status: 'verified', resolved: daysAgo(40), resolution: 'held.' })],
        nextUp: ['P1'],
      }),
    );
  });

  // A refuted assumption is the urgent case — dependents may be VOID rather than
  // unblocked — and no rule targets it. But coverage is not zero, and the boundary is
  // not where you would guess, so both halves are pinned.

  test('a refuted assumption: an entry drafted BEFORE the refutation is caught, by staleness', () => {
    fails(
      project({
        backlog: [P('P1'), P('P2', { drafted: daysAgo(40), dependsOn: ['A-1'] })],
        assumptions: [A('A-1', { status: 'refuted', resolved: daysAgo(10), resolution: 'wrong.' })],
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
    // Pinned so the gap is a decision rather than a discovery. If a refuted-assumption gate is
    // ever added this test SHOULD fail — change it knowingly.
    passes(
      project({
        backlog: [P('P1'), P('P2', { status: 'in-progress', drafted: daysAgo(5), dependsOn: ['A-1'] })],
        assumptions: [A('A-1', { status: 'refuted', resolved: daysAgo(30), resolution: 'wrong.' })],
        nextUp: ['P1'],
      }),
    );
  });

  test('a dangling assumption reference fails at ANY status — broken audit trail', () => {
    fails(
      project({ backlog: [P('P1'), P('P2', { status: 'shipped', dependsOn: ['A-99'] })] }),
      /P2 depends on A-99, which has no entry/,
    );
  });

  test('an ID listed twice in depends_on raises ONE violation', () => {
    // An inflated count is not cosmetic: the count is the positive control (L3).
    const o = fails(
      project({
        backlog: [P('P1'), P('P2', { dependsOn: ['A-1', 'A-1'] })],
        assumptions: [assumption()],
        nextUp: ['P1', 'P2'],
      }),
    );
    assert.match(o, /^backlog-schema: 1 violation\(s\)/m);
  });
});

describe('spike ↔ assumption pairing', () => {
  test('an open spike pointing at an open assumption passes — the normal live state', () => {
    passes(
      project({
        backlog: [P('P1'), P('P9', { resolves: 'A-1' })],
        assumptions: [A('A-1')],
        nextUp: ['P1'],
      }),
    );
  });

  test('an open spike pointing at an already-settled assumption fails as obsolete', () => {
    fails(
      project({
        backlog: [P('P1'), P('P9', { resolves: 'A-1' })],
        assumptions: [A('A-1', { status: 'refuted', resolved: daysAgo(1), resolution: 'wrong.' })],
        nextUp: ['P1'],
      }),
      /open P9 resolves A-1, but A-1 is already `refuted`/,
    );
  });

  test('a SHIPPED spike whose assumption is still open fails — the answer never came back', () => {
    const o = fails(
      project({
        backlog: [P('P1'), P('P9', { status: 'shipped', resolves: 'A-1' })],
        assumptions: [A('A-1')],
        nextUp: ['P1'],
      }),
      /P9 shipped and resolves A-1, but A-1 is still `open`/,
    );
    assert.match(o, /inventory/, 'the message must name the failure mode (L2)');
  });

  test('a shipped date on an entry that is not shipped fails', () => {
    for (const status of ['proposed', 'in-progress', 'abandoned']) {
      fails(project({ backlog: [P('P1'), P('P2', { status, shipped: daysAgo(1) })] }), new RegExp(`P2 is \`${status}\` but carries \`shipped:\``));
    }
  });

  test('a spike pointing at a nonexistent assumption fails', () => {
    fails(
      project({ backlog: [P('P1'), P('P9', { resolves: 'A-77' })] }),
      /P9 resolves A-77, which has no entry/,
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

describe('decisions — choices only the product owner makes (P10)', () => {
  const blocked = (status) => P('P2', { status, dependsOn: ['D-1'] });

  test('a minimal open decision passes, and is counted', () => {
    const o = passes(project({ decisions: [D('D-1')] }));
    assert.match(o, /OK \(2 entries across 2 register\(s\)\)/);
  });

  // Accept criterion: an entry that depends on an open decision may not be queued.
  test('QUEUED: an entry resting on an open decision fails in Next up', () => {
    const o = fails(
      project({ backlog: [P('P1'), blocked('proposed')], decisions: [D('D-1')], nextUp: ['P1', 'P2'] }),
      /P2 is in Next up but depends on D-1, still `open`/,
    );
    assert.match(o, /decide D-1/, 'the remedy for a decision is to decide it, not to spike it');
  });

  test('PARKED: the same entry in the pool passes (blocked-not-rejected)', () => {
    passes(project({ backlog: [P('P1'), blocked('proposed')], decisions: [D('D-1')], nextUp: ['P1'] }));
  });

  test('CLAIMED: in-progress on an open decision fails', () => {
    fails(
      project({ backlog: [P('P1'), blocked('in-progress')], decisions: [D('D-1')], nextUp: ['P1'] }),
      /P2 is `in-progress` but depends on D-1, still `open`.*a choice nobody has made/s,
    );
  });

  test('deciding lifts the block', () => {
    passes(
      project({
        backlog: [P('P1'), P('P2', { drafted: daysAgo(0), dependsOn: ['D-1'] })],
        decisions: [decidedD('D-1', { decided: daysAgo(1) })],
        nextUp: ['P1', 'P2'],
      }),
    );
  });

  test('a dependent drafted BEFORE the decision was taken is flagged stale', () => {
    fails(
      project({
        backlog: [P('P1'), P('P2', { drafted: daysAgo(30), dependsOn: ['D-1'] })],
        decisions: [decidedD('D-1', { decided: daysAgo(1) })],
      }),
      /P2 \(drafted .*\) depends on D-1, which landed .*presumptively stale/s,
    );
  });

  test('an open decision must say what it is waiting on', () => {
    fails(project({ decisions: [D('D-1', { waitingOn: null })] }), /open D-1 has no `waiting_on:`/);
  });

  test('waiting_on takes IDs and `user`, never prose', () => {
    passes(project({ decisions: [D('D-1', { waitingOn: 'user, P1' })] }));
    fails(
      project({ decisions: [D('D-1', { waitingOn: 'the user, once P1 lands' })] }),
      /waiting_on: not a comma-separated list of IDs and\/or `user`/,
    );
  });

  test('waiting_on an ID with no entry fails', () => {
    fails(project({ decisions: [D('D-1', { waitingOn: 'A-9' })] }), /D-1 waiting_on A-9, which has no entry/);
  });

  test('every decision lists its Options', () => {
    fails(project({ decisions: [D('D-1', { options: null })] }), /D-1 missing \*\*Options\*\*/);
  });

  test('a decided entry owes its date, what it leads to, the choice, why, and what reopens it', () => {
    const owed = [
      [{ decided: null }, /decided D-1 has no `decided:`/],
      [{ leadsTo: null }, /decided D-1 has no `leads_to:`/],
      [{ choice: null }, /decided D-1 missing \*\*Decided\*\*/],
      [{ why: null }, /decided D-1 missing \*\*Why\*\*/],
      [{ reopenIf: null }, /decided D-1 missing \*\*Reopen if\*\*/],
    ];
    passes(project({ decisions: [decidedD('D-1')] }));
    for (const [over, needle] of owed) fails(project({ decisions: [decidedD('D-1', over)] }), needle);
  });

  test('leads_to a shipped feature passes: the consequence landed', () => {
    passes(
      project({
        backlog: [P('P1'), P('P2', { status: 'shipped', shipped: daysAgo(1) })],
        decisions: [decidedD('D-1', { leadsTo: 'P2' })],
      }),
    );
  });

  test('leads_to a feature that was abandoned fails: the consequence was dropped', () => {
    fails(
      project({
        backlog: [P('P1'), P('P2', { status: 'abandoned' })],
        decisions: [decidedD('D-1', { leadsTo: 'P2' })],
      }),
      /D-1 leads to P2, which is `abandoned`.*Supersede D-1/s,
    );
  });

  test('leads_to an entry that does not exist fails', () => {
    fails(project({ decisions: [decidedD('D-1', { leadsTo: 'P42' })] }), /D-1 leads_to P42, which has no entry/);
  });

  test('a superseded decision names an existing D-n that replaced it', () => {
    const sup = (by) => D('D-1', { status: 'superseded', waitingOn: null, supersededBy: by });
    passes(project({ decisions: [sup('D-2'), D('D-2')] }));
    fails(project({ decisions: [sup(null)] }), /superseded D-1 has no `superseded_by:`/);
    fails(project({ decisions: [sup('D-7')] }), /D-1 superseded_by D-7, which has no entry/);
    fails(project({ decisions: [sup('P1')] }), /`superseded_by:` must name the D-n/);
  });

  test('a decisions register with no entries fails — an empty tracked doc is not a pass', () => {
    const dir = project({ decisions: [D('D-1')] });
    rmSync(join(dir, 'docs/decisions/D-1.md'));
    fails(dir, /docs\/decisions: no entry files parsed/);
  });

  test('a D-n in the wrong register is out of namespace', () => {
    fails(project({ assumptions: [A('D-1')] }), /docs\/assumptions\/D-1\.md: ID out of namespace: D-1/);
  });
});

describe('a moved assumption is a forwarding address (P10)', () => {
  const moved = (to) => A('A-1', { status: 'moved', resolved: daysAgo(1), movedTo: to });

  test('moved to an existing entry passes, and the stub stays countable', () => {
    passes(project({ assumptions: [moved('D-1')], decisions: [D('D-1')] }));
  });

  test('moved with no `moved_to:` fails', () => {
    fails(project({ assumptions: [moved(null)] }), /moved A-1 has no `moved_to:`/);
  });

  test('moved to an entry that does not exist fails', () => {
    fails(project({ assumptions: [moved('D-4')] }), /A-1 moved_to D-4, which has no entry/);
  });

  test('moved to itself, or to nothing, fails', () => {
    fails(project({ assumptions: [moved('A-1')] }), /`moved_to:` must name the entry that is its new home/);
    fails(project({ assumptions: [moved('—')] }), /`moved_to:` must name the entry that is its new home/);
  });

  test('an open entry still depending on a moved assumption fails, even parked in the pool', () => {
    fails(
      project({
        backlog: [P('P1'), P('P2', { dependsOn: ['A-1'] })],
        assumptions: [moved('D-1')],
        decisions: [D('D-1')],
      }),
      /P2 depends on A-1, which was moved to D-1 — depend on its new home instead/,
    );
  });

  test('a shipped entry that depended on it before the move is history, not a failure', () => {
    passes(
      project({
        backlog: [P('P1'), P('P2', { status: 'shipped', shipped: daysAgo(30), dependsOn: ['A-1'] })],
        assumptions: [moved('D-1')],
        decisions: [D('D-1')],
      }),
    );
  });
});

describe('identity and ID hygiene', () => {
  test('an ID outside its register namespace fails', () => {
    fails(project({ backlog: [P('P1')], assumptions: [A('P5')] }), /docs\/assumptions\/P5\.md: ID out of namespace: P5/);
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
  const fileIn = (dir) => `${dir}/${{ 'docs/backlog': 'P1', 'docs/assumptions': 'A-1', 'docs/decisions': 'D-1' }[dir]}.md`;

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
  test('the probe list covers every register', () => {
    assert.ok(fields['docs/backlog'].required.includes('Accept'));
    assert.ok(fields['docs/assumptions'].required.includes('Assumption'));
    assert.ok(fields['docs/decisions'].required.includes('Options'));
    assert.ok(fields['docs/backlog'].keys.includes('depends_on'));
  });

  for (const [regDir, { required }] of Object.entries(fields)) {
    for (const label of required) {
      test(`${regDir}: naming ${label} in prose does not count as carrying it`, () => {
        const dir = project({ backlog: [P('P1')], assumptions: [A('A-1')], decisions: [D('D-1')] });
        passes(dir); // the fixture is valid before the section is taken away
        proseOnly(dir, fileIn(regDir), label);
        fails(dir, new RegExp(`missing \\*\\*${label}\\*\\*`));
      });
    }
  }

  // Accept criterion 1. Every header key, written as a header line, in the body: none
  // of them may change what the checker reads. If `status: shipped` were read, the
  // queue would call P2 terminal; if `depends_on: A-2` were read, A-2 (verified)
  // would join the real, open A-1.
  test('an entry whose prose says `status: shipped` or `depends_on: A-3` is unaffected', () => {
    const notes = 'status: shipped\ndepends_on: A-2\nresolves: A-2\n**Depends on:** A-2\n- **Status:** shipped';
    const o = fails(
      project({
        backlog: [P('P1'), P('P2', { notes, dependsOn: ['A-1'] })],
        assumptions: [A('A-1'), A('A-2', { status: 'verified', resolved: daysAgo(40), resolution: 'held.' })],
        nextUp: ['P1', 'P2'],
      }),
      /P2 is in Next up but depends on A-1, still `open`/,
    );
    assert.doesNotMatch(o, /terminal/, 'body prose was read as the status');
    assert.doesNotMatch(o, /A-2/, 'body prose was read as a dependency or a spike pairing');
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
