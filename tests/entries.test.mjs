// dependencyMet — /implement's DEPENDS GATE, the one rule every script reads (P32).
//
// The scripts' own tests pin the wiring; this pins the table, every register's
// statuses, so a status that changes sides shows up here first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyMet, newHomeOf, percentOf } from '../scripts/entries.mjs';

// A test's `bar:` and `effect:` (P45): one form, percent, so `1` can't mean 100%.
describe('percentOf', () => {
  test('percent, with or without the sign, from 1 to under 100; a share is refused', () => {
    assert.equal(percentOf('70'), 0.7);
    assert.equal(percentOf('62.5%'), 0.625);
    for (const bad of ['0', '0.7', '100', '150', '0.7.1', '-5', '70 %', '', null]) assert.equal(percentOf(bad), null, String(bad));
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
