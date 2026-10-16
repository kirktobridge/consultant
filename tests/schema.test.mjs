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
import { readFileSync, writeFileSync } from 'node:fs';
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
    assert.match(o, /OK \(2 entries across 1 file\(s\)\)/);
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
    fails(project({ backlog: [P('P1', { drafted: null })] }), /no \*\*Drafted:\*\*/);
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

  test('one unfalsifiable sentence on the label line fails — the ceremony case', () => {
    const dir = project({ backlog: [P('P1', { accept: [] })] });
    patch(dir, 'docs/product/BACKLOG.md', '- **Accept:**', '- **Accept:** it works.');
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

  test("a following field's bullets are not counted as Accept's", () => {
    const dir = project({ backlog: [P('P1', { accept: accept(2) })] });
    patch(dir, 'docs/product/BACKLOG.md', '- **Depends on:** —', '- **Depends on:**\n  - nothing\n  - really');
    passes(dir);
  });
});

describe('status vocabulary is read from the document', () => {
  test('a status outside the documented vocab fails', () => {
    fails(project({ backlog: [P('P1', { status: 'wibble' })] }), /not in vocab/);
  });

  test('an entry with no Status line fails', () => {
    const dir = project();
    patch(dir, 'docs/product/BACKLOG.md', '- **Status:** proposed', '- **State:** proposed');
    fails(dir, /no \*\*Status:\*\* line for P1/);
  });

  test('a doc with no documented vocab at all fails loudly', () => {
    const dir = project();
    patch(dir, 'docs/product/BACKLOG.md', 'Status vocab:', 'Statuses we use:');
    fails(dir, /no documented status vocabulary resolved/);
  });
});

describe('the Next up queue', () => {
  test('an empty queue fails', () => {
    fails(project({ nextUp: [] }), /no `## Next up` IDs/);
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
      /P2 is in `## Next up` but depends on OD-1, still `open`/,
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
        decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(40)} — held.` })],
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
        decisions: [OD('OD-1', { status: 'refuted', resolution: `${daysAgo(10)} — wrong.` })],
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
        decisions: [OD('OD-1', { status: 'refuted', resolution: `${daysAgo(30)} — wrong.` })],
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

  test('an ID named several times in one Depends on block raises ONE violation', () => {
    // An inflated count is not cosmetic: the count is the positive control (L3).
    const o = fails(
      project({
        backlog: [P('P1'), P('P2', { dependsOn: ['OD-1 — see OD-1, and note OD-1 again'] })],
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
        decisions: [OD('OD-1', { status: 'refuted', resolution: `${daysAgo(1)} — wrong.` })],
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

describe('heading and ID hygiene', () => {
  test('an ID outside its file namespace fails', () => {
    const dir = project({ backlog: [P('P1')], decisions: [OD('OD-1')] });
    patch(dir, 'docs/OPEN_DECISIONS.md', 'OD-1', 'XX-1');
    fails(dir, /ID out of namespace/);
  });

  test('SHIPPED baked into a title fails — it is invisible to a status grep', () => {
    const dir = project();
    patch(dir, 'docs/product/BACKLOG.md', '### P1 — P1 example', '### P1 — SHIPPED thing');
    fails(dir, /SHIPPED in title, not suffix/);
  });

  test('the entry template inside a fenced block is not parsed as a real entry', () => {
    const dir = project();
    const f = join(dir, 'docs/product/BACKLOG.md');
    writeFileSync(
      f,
      readFileSync(f, 'utf8') +
        '\n## Template\n\n```markdown\n### P1 — duplicate id inside a fence\n- **Status:** proposed\n```\n',
    );
    passes(dir); // would be a duplicate-ID cascade if fences were parsed
  });
});

// P9. An entry that *describes* a field names it in prose; an unanchored probe reads
// that prose as the field. These walk every probe the checker reports, so a field
// added to its config later is covered without anyone adding a test for it.
describe('field probes are anchored to field lines, not prose', () => {
  const fields = JSON.parse(run('backlog-schema-check.mjs', ['--fields']).stdout);

  // Drop the field's line (and its continuation lines) from the one entry in `rel`,
  // and add a prose line that names it instead.
  const proseOnly = (dir, rel, label) => {
    const f = join(dir, rel);
    const lines = readFileSync(f, 'utf8').split('\n');
    const i = lines.findIndex((l) => l.startsWith(`- **${label}:**`));
    assert.ok(i >= 0, `fixture has no ${label} line in ${rel}`);
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
    lines.splice(i, j - i, `- **Notes:** this entry describes the \`**${label}:**\` field.`);
    writeFileSync(f, lines.join('\n'));
  };

  // Positive control: an empty or truncated list would make the walk below pass by
  // walking nothing (L3).
  test('the probe list covers both tracked docs', () => {
    assert.ok(fields['docs/product/BACKLOG.md'].required.includes('Accept'));
    assert.ok(fields['docs/OPEN_DECISIONS.md'].required.includes('Assumption'));
    assert.ok(fields['docs/product/BACKLOG.md'].accessed.includes('Depends on'));
  });

  for (const [rel, { required }] of Object.entries(fields)) {
    for (const label of required) {
      test(`${rel}: naming **${label}:** in prose does not count as carrying it`, () => {
        const dir = project({ backlog: [P('P1')], decisions: [OD('OD-1')] });
        passes(dir); // the fixture is valid before the field is taken away
        proseOnly(dir, rel, label);
        fails(dir, new RegExp(`missing \\*\\*${label}\\*\\*`));
      });
    }
  }

  // The first entry most worth protecting: `labelled` takes the first match, so prose
  // above the real field used to win — and the field it read drives the OD gate.
  // BACKLOG.md's own P9 entry is the live case; this is its fixture twin.
  test('prose naming **Depends on:** above the real field does not hide the real dependency', () => {
    const accept = ['an entry whose prose names `**Depends on:** OD-2` still has its real dependency read.', 'it is still blocked.'];
    fails(
      project({
        backlog: [P('P1'), P('P2', { accept, dependsOn: ['OD-1'] })],
        decisions: [OD('OD-1'), OD('OD-2', { status: 'verified', resolution: `${daysAgo(40)} — held.` })],
        nextUp: ['P1', 'P2'],
      }),
      /P2 is in `## Next up` but depends on OD-1, still `open`/,
    );
  });

  test('prose naming **Resolves:** is not a spike pairing', () => {
    passes(
      project({
        backlog: [P('P1', { scope: 'teach the checker the `**Resolves:** OD-1` field.' })],
        decisions: [OD('OD-1', { status: 'verified', resolution: `${daysAgo(40)} — held.` })],
      }),
    );
  });
});

// P9. Which `###` lines are entries is a decision, not a side effect of the ID regex.
describe('section headings are told apart from entry headings', () => {
  const append = (dir, text) => {
    const f = join(dir, 'docs/product/BACKLOG.md');
    writeFileSync(f, readFileSync(f, 'utf8') + text);
  };

  test('a one-word section heading is skipped, not reported', () => {
    const dir = project();
    append(dir, '\n### Notes\n\nSome prose.\n');
    assert.match(passes(dir), /OK \(1 entries/);
  });

  test('a several-word section heading is skipped, not reported', () => {
    const dir = project();
    append(dir, '\n### How these entries are ranked\n\nSome prose.\n');
    assert.match(passes(dir), /OK \(1 entries/);
  });

  test("a section heading ends the entry above — its prose is not that entry's fields", () => {
    const dir = project({ backlog: [P('P1', { accept: null })] });
    append(dir, '\n### Example\n\n- **Accept:**\n  - shown here.\n  - as an example.\n');
    fails(dir, /open P1 missing \*\*Accept\*\*/);
  });

  // Parse loosely, validate strictly: skipping section headings must not swallow a
  // broken entry heading too.
  test('an entry heading with no em-dash is still reported', () => {
    const dir = project();
    append(dir, '\n### P2 no dash here\n- **Status:** proposed\n');
    fails(dir, /malformed entry heading .*### P2 no dash here/);
  });

  test('an entry-shaped heading with a digit-less ID is reported, not skipped', () => {
    const dir = project();
    append(dir, '\n### PX — typo in the id\n- **Status:** proposed\n');
    fails(dir, /ID out of namespace: ### PX/);
  });

  test('an em-dash later in a prose heading does not make it an entry', () => {
    const dir = project();
    append(dir, '\n### Notes on ranking — part two\n\nSome prose.\n');
    assert.match(passes(dir), /OK \(1 entries/);
  });

  test('a bare ID heading is reported, not mistaken for a one-word section', () => {
    const dir = project();
    append(dir, '\n### P2\n- **Status:** proposed\n');
    fails(dir, /malformed entry heading .*### P2$/m);
  });
});
