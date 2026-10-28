// dependencyMet — /implement's DEPENDS GATE, the one rule every script reads (P32).
//
// The scripts' own tests pin the wiring; this pins the table, every register's
// statuses, so a status that changes sides shows up here first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyMet, newHomeOf, percentOf, unmetDependencies, describeUnmet, dependencyAdvice, parseEntry, today, BACKLOG } from '../scripts/entries.mjs';

// A test's `bar:` and `effect:` (P45): one form, percent, so `1` can't mean 100%.
describe('percentOf', () => {
  test('percent, with or without the sign, from 1 to under 100; a share is refused', () => {
    assert.equal(percentOf('70'), 0.7);
    assert.equal(percentOf('62.5%'), 0.625);
    for (const bad of ['0', '0.7', '100', '150', '0.7.1', '-5', '70 %', '', null]) assert.equal(percentOf(bad), null, String(bad));
  });
});

describe('today', () => {
  test('is the local calendar date, late in the evening too (B13)', () => {
    assert.equal(today(new Date(2026, 9, 27, 23, 30)), '2026-10-27');
    assert.equal(today(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
  });
});

describe('newHomeOf', () => {
  test('a moved or superseded entry names its new home as IDs; anything else names none', () => {
    assert.deepEqual(newHomeOf({ header: { status: 'moved', moved_to: 'P3' } }), ['P3']);
    assert.deepEqual(newHomeOf({ header: { status: 'superseded', superseded_by: 'D-2, D-2' } }), ['D-2']);
    assert.deepEqual(newHomeOf({ header: { status: 'superseded', superseded_by: 'D-2 (see thread)' } }), []);
    assert.deepEqual(newHomeOf({ header: { status: 'moved', moved_to: '—' } }), []);
    assert.deepEqual(newHomeOf({ header: { status: 'verified', moved_to: 'P3' } }), []);
    assert.deepEqual(newHomeOf(null), []);
  });
});

describe('dependencyMet', () => {
  const table = {
    P1: { met: ['shipped'], holds: ['proposed', 'in-progress', 'partial', 'deferred', 'abandoned'] },
    B1: { met: ['fixed'], holds: ['open', 'in-progress', 'wontfix'] },
    X1: { met: ['answered', 'abandoned', 'played-out'], holds: ['proposed', 'active', 'deferred'] },
    // B10: a moved assumption or a superseded decision settled nothing.
    'A-1': { met: ['verified', 'refuted', 'moot'], holds: ['open', 'moved'] },
    'D-1': { met: ['decided'], holds: ['open', 'superseded'] },
  };
  for (const [id, { met, holds }] of Object.entries(table)) {
    test(`${id}: met when ${met.join(', ')}; held otherwise`, () => {
      for (const s of met) assert.equal(dependencyMet(id, s), true, `${id} ${s}`);
      for (const s of holds) assert.equal(dependencyMet(id, s), false, `${id} ${s}`);
    });
  }

  test('a status nobody listed holds, and so does a dependency with no entry', () => {
    assert.equal(dependencyMet('A-1', 'verifed'), false);
    assert.equal(dependencyMet('D-1', 'deferred'), false);
    assert.equal(dependencyMet('A-1', null), false);
  });
});

// The shared refusal: ship.mjs and worktree.mjs both read and word it from here.
describe('unmetDependencies and dependencyAdvice', () => {
  const entry = (deps) => parseEntry(`---\nid: P1\ntitle: t\nstatus: proposed\ndepends_on: ${deps}\n---\n`, BACKLOG.keys);
  const files = {
    P2: '---\nid: P2\nstatus: shipped\n---\n',
    P3: '---\nid: P3\nstatus: partial\n---\n',
    'D-1': '---\nid: D-1\nstatus: open\n---\n',
    'A-1': '---\nid: A-1\nstatus: moved\nmoved_to: A-2\n---\n',
    X1: '---\nid: X1\nstatus: answered\n---\n',
    X2: '---\nid: X2\nstatus: active\n---\n',
  };
  const read = (id) => files[id] ?? null;

  test('only what still holds the entry, each with its status and any new home', () => {
    assert.deepEqual(unmetDependencies(entry('P2, P3, D-1, A-1, P9'), read), [
      { id: 'P3', status: 'partial', to: [] },
      { id: 'D-1', status: 'open', to: [] },
      { id: 'A-1', status: 'moved', to: ['A-2'] },
      { id: 'P9', status: null, to: [] },
    ]);
    assert.deepEqual(unmetDependencies(entry('P2'), read), []);
  });

  test('the advice fits each kind of blocker, and a missing entry is not told to be built', () => {
    assert.equal(dependencyAdvice(unmetDependencies(entry('P3, D-1, A-1'), read)),
      'Build what it depends on first; an open decision is the owner\'s to take; re-point its `depends_on:` via /ship: A-1 → A-2');
    assert.equal(dependencyAdvice(unmetDependencies(entry('P9'), read)), 'A dependency with no entry has to be filed or dropped');
  });

  test('an experiment is read from its own register: a closed one is met, an open one waits', () => {
    assert.deepEqual(unmetDependencies(entry('X1, X2'), read), [{ id: 'X2', status: 'active', to: [] }]);
    assert.equal(dependencyAdvice(unmetDependencies(entry('X2'), read)), 'An experiment it waits on has to close');
  });

  test('describeUnmet lists each with its status, or that it has no entry', () => {
    assert.equal(describeUnmet(unmetDependencies(entry('P3, P9'), read)), 'P3 (`partial`), P9 (no entry)');
  });
});
