// Does the *process* hang together?
//
// loop.test.mjs walks the document state machine — the half of the process the schema
// check knows about. This is the other half: the skills' own instructions, which are
// prose, which nothing has ever held, and which rot the instant a file is renamed.
//
// That is not hypothetical. Building this suite, two renames silently invalidated
// instructions in four skills: doc-debt-check.mjs was deleted while /checkpoint still
// told you to run it, and edit-guard.py became .mjs while README and PORTING still
// printed the old command. Both were caught by hand-grepping, which is exactly the
// method LESSONS L1 says not to trust.
//
// So: every command a skill tells you to run must exist, every skill it hands off to
// must exist, every link must resolve, and the single-writer map must agree with the
// skills it describes. None of that needs a model — it is all decidable, which means
// there is no excuse for it being unheld.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { REPO } from './helpers/fixture.mjs';

// ── Corpus ───────────────────────────────────────────────────────────────────

const SKILL_DIR = join(REPO, '.claude', 'skills');
const SKILLS = readdirSync(SKILL_DIR).filter((d) => statSync(join(SKILL_DIR, d)).isDirectory());

/** Skills provided by the harness or the user, not by this repo. */
const EXTERNAL_SKILLS = new Set(['run']);

function markdownFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['.git', 'node_modules', 'tests'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.md')) out.push(p);
    }
  };
  walk(REPO);
  return out;
}

const DOCS = markdownFiles();
const rel = (p) => relative(REPO, p);
const read = (p) => readFileSync(p, 'utf8');
const pkg = JSON.parse(read(join(REPO, 'package.json')));

/** Strip fenced code blocks — a template inside a fence is illustrative, not a claim. */
const unfenced = (t) => t.replace(/```[\s\S]*?```/g, '');

describe('the corpus is what we think it is', () => {
  test('six skills, and the docs that describe them agree', () => {
    assert.equal(SKILLS.length, 6, `skills on disk: ${SKILLS.join(', ')}`);
    for (const doc of ['README.md', '.claude/GUIDE.md', 'CLAUDE.md']) {
      const t = read(join(REPO, doc));
      assert.match(t, /\b[Ss]ix skills\b/, `${doc} must state the real skill count`);
    }
  });

  test('markdown was actually found — the corpus is not silently empty (L3)', () => {
    assert.ok(DOCS.length >= 10, `only found ${DOCS.length} docs; the walker is broken`);
  });
});

describe('every command a doc tells you to run exists', () => {
  test('`node scripts/*.mjs` targets resolve', () => {
    const missing = [];
    for (const f of DOCS) {
      for (const m of read(f).matchAll(/node\s+(?:"?\$CLAUDE_PROJECT_DIR\/"?)?([\w./-]+\.mjs)/g)) {
        const target = m[1].replace(/^\$CLAUDE_PROJECT_DIR\//, '');
        if (!existsSync(join(REPO, target))) missing.push(`${rel(f)} → ${target}`);
      }
    }
    assert.deepEqual(missing, [], 'a doc names a script that does not exist');
  });

  test('`node .claude/*` targets resolve', () => {
    const missing = [];
    for (const f of DOCS) {
      for (const m of read(f).matchAll(/node\s+(?:"?\$CLAUDE_PROJECT_DIR\/"?)?(\.claude\/[\w./-]+)/g)) {
        if (!existsSync(join(REPO, m[1]))) missing.push(`${rel(f)} → ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], 'a doc names a hook script that does not exist');
  });

  test('`npm run X` targets are defined in package.json', () => {
    const missing = [];
    for (const f of DOCS) {
      for (const m of read(f).matchAll(/npm run ([\w:-]+)/g)) {
        if (!pkg.scripts?.[m[1]]) missing.push(`${rel(f)} → npm run ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], 'a doc names an npm script that does not exist');
  });

  test('no doc still references a script that was deleted', () => {
    // Named explicitly rather than inferred: these are the two that actually rotted,
    // and a regression here means the rename discipline slipped again.
    const gone = ['doc-debt-check.mjs', 'edit-guard.py', 'stats.py'];
    const hits = [];
    for (const f of DOCS) {
      const t = unfenced(read(f));
      for (const g of gone) {
        // PORTING legitimately discusses the master variant, which still has stats.py.
        if (t.includes(g) && !/master|variant/i.test(t.split(g)[0].slice(-200))) {
          hits.push(`${rel(f)} → ${g}`);
        }
      }
    }
    assert.deepEqual(hits, [], 'a deleted script is still referenced as if it exists');
  });
});

describe('every skill handoff points at a skill that exists', () => {
  test('skills reference only real skills', () => {
    const bad = [];
    for (const s of SKILLS) {
      const t = read(join(SKILL_DIR, s, 'SKILL.md'));
      for (const m of t.matchAll(/\/(triage|implement|verify|land|ship|checkpoint|research|run|groom)\b/g)) {
        const name = m[1];
        if (name === 'groom') continue; // a mode of /triage, not a skill
        if (EXTERNAL_SKILLS.has(name)) continue;
        if (!SKILLS.includes(name)) bad.push(`${s} → /${name}`);
      }
    }
    assert.deepEqual(bad, [], 'a skill hands off to a skill that does not exist');
  });

  test('the human-facing docs reference only real skills', () => {
    const bad = [];
    for (const doc of ['README.md', '.claude/GUIDE.md', 'CLAUDE.md', 'PORTING.md']) {
      const t = read(join(REPO, doc));
      for (const m of t.matchAll(/\/(triage|implement|verify|land|ship|checkpoint|research)\b/g)) {
        const name = m[1];
        if (SKILLS.includes(name)) continue;
        // /research is deliberately named as the thing the master variant has.
        if (name === 'research' && /master|variant|measurable/i.test(t)) continue;
        bad.push(`${doc} → /${name}`);
      }
    }
    assert.deepEqual(bad, [], 'a doc points the reader at a skill this variant does not have');
  });
});

describe('skill frontmatter', () => {
  for (const s of SKILLS) {
    test(`${s}: name matches its directory and has a description`, () => {
      const t = read(join(SKILL_DIR, s, 'SKILL.md'));
      const fm = t.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(fm, `${s}/SKILL.md has no frontmatter block`);
      const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
      // A name that disagrees with the directory makes the skill un-invokable by the
      // path everyone will guess.
      assert.equal(name, s, `frontmatter name must equal the directory name`);
      assert.ok(desc && desc.length > 40, `${s} needs a description that says when to use it`);
    });
  }
});

describe('links resolve', () => {
  test('every relative markdown link points at something real', () => {
    const broken = [];
    for (const f of DOCS) {
      for (const m of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (/^(https?:|mailto:|#)/.test(href)) continue;
        const target = href.split('#')[0];
        if (!target) continue;
        if (!existsSync(resolve(dirname(f), target))) broken.push(`${rel(f)} → ${href}`);
      }
    }
    assert.deepEqual(broken, [], 'a relative link does not resolve');
  });

  test('the canonical-docs table in CLAUDE.md is not aspirational', () => {
    const t = read(join(REPO, 'CLAUDE.md'));
    const table = t.slice(t.indexOf('## Canonical docs'), t.indexOf('## Doc discipline'));
    const rows = [...table.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    assert.ok(rows.length >= 5, `expected the full table, parsed ${rows.length} rows`);
    for (const [, , href] of rows) {
      assert.ok(existsSync(join(REPO, href)), `CLAUDE.md points at missing ${href}`);
    }
  });
});

describe('the single-writer map agrees with the skills', () => {
  const guide = read(join(REPO, '.claude', 'GUIDE.md'));
  const mapSection = guide.slice(guide.indexOf('## Who writes what'), guide.indexOf('## Why single-writer'));

  test('the map parses, and names files that exist', () => {
    const paths = [...mapSection.matchAll(/`([\w./-]+\.md)`/g)].map((m) => m[1]);
    assert.ok(paths.length >= 4, `parsed only ${paths.length} paths from the map`);
    const missing = paths.filter(
      (p) => !existsSync(join(REPO, p)) && !existsSync(join(REPO, 'docs', p)) && !p.includes('HANDOFF'),
    );
    assert.deepEqual(missing, [], 'the single-writer map names a file that does not exist');
  });

  test('each owned file is claimed by the skill the map assigns it to', () => {
    // The failure this catches: moving a pen in one place and not the other, which
    // leaves two documents disagreeing about who may write a file — and the whole
    // no-conflict property rests on there being exactly one answer.
    const owned = [
      ['docs/product/BACKLOG.md', 'ship'],
      ['docs/BUILD_ORDER.md', 'ship'],
      ['docs/ARCHITECTURE.md', 'ship'],
      ['.claude/HANDOFF.md', 'checkpoint'],
    ];
    for (const [file, skill] of owned) {
      const t = read(join(SKILL_DIR, skill, 'SKILL.md'));
      const base = file.split('/').pop();
      assert.ok(
        t.includes(file) || t.includes(base),
        `GUIDE assigns ${file} to /${skill}, but that skill never mentions it`,
      );
      assert.match(
        mapSection,
        new RegExp(`${base.replace('.', '\\.')}[\\s\\S]{0,80}${skill}`),
        `the map should list ${base} against /${skill}`,
      );
    }
  });

  test('no skill claims to be the sole writer of a file another skill also claims', () => {
    const claims = new Map();
    for (const s of SKILLS) {
      const t = read(join(SKILL_DIR, s, 'SKILL.md'));
      const m = t.match(/\*\*Single-writer contract:\*\*([\s\S]{0,400})/);
      if (!m) continue;
      for (const f of m[1].matchAll(/([\w./-]+\.md)/g)) {
        const file = f[1];
        if (claims.has(file) && claims.get(file) !== s) {
          assert.fail(`${file} is claimed as sole-writer by both /${claims.get(file)} and /${s}`);
        }
        claims.set(file, s);
      }
    }
    assert.ok(claims.size > 0, 'no single-writer contract parsed — the check found nothing to check');
  });
});
