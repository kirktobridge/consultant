// Tests about this repo's own entries — instance-only (P28).
//
// Everything else under tests/ is the suite's, and runs in any project that adopts it.
// These can't: they assert facts about this repo's history (which entries existed on
// the day of a migration, how dense its real graph is), and in a clean copy there is
// no such history to read. A fixture can't stand in for them either, because the
// history is what they check. The manifest marks this directory `instance`, so the
// export leaves it behind and `npm run test:clean` never meets it.
//
// A new test that reads docs/backlog/P*.md (or any other instance file) from REPO
// belongs here. Left in tests/*.test.mjs, it fails the clean run.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, run, out } from '../helpers/fixture.mjs';

describe('the migration to one file per entry lost nothing (P20)', () => {
  // The IDs both registers held on the day they were split into files. A literal rather
  // than `git show <sha>`, because CI clones shallow. New entries may be added freely;
  // none of these may go missing.
  const BEFORE = [
    'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17',
    'P18', 'P19', 'P20', 'P21', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8', 'A-9', 'A-10',
  ];

  test('all 26 entries still exist, each in its own file under its own id', () => {
    assert.equal(BEFORE.length, 26);
    const missing = BEFORE.filter((id) => {
      const f = join(REPO, 'docs', id.startsWith('P') ? 'backlog' : 'assumptions', `${id}.md`);
      return !existsSync(f) || !new RegExp(`^id: ${id}$`, 'm').test(readFileSync(f, 'utf8'));
    });
    assert.deepEqual(missing, []);
  });
});

describe('graph', () => {
  test('on the real repo, every edge joins two real entries', () => {
    const r = run('backlog-schema-check.mjs', ['--graph', '--json'], { cwd: REPO });
    assert.equal(r.code, 0, `graph mode failed:\n${out(r)}`);
    const g = JSON.parse(r.stdout);
    const ids = new Set(g.entries.map((e) => e.id));
    assert.ok(g.edges.length > 5, `only ${g.edges.length} edges — did the parse stop matching?`);
    for (const e of g.edges) assert.ok(ids.has(e.from) && ids.has(e.to), JSON.stringify(e));
  });
});
