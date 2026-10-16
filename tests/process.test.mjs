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
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative, resolve } from 'node:path';
import { REPO, tempDir, gitInit } from './helpers/fixture.mjs';

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

/** The loop. /eval is maintenance for this repo's own prose and is deliberately not one. */
const LOOP_SKILLS = ['triage', 'implement', 'verify', 'land', 'ship', 'checkpoint'];

describe('the corpus is what we think it is', () => {
  test('six loop skills, and the docs that describe them agree', () => {
    assert.deepEqual(SKILLS.filter((s) => s !== 'eval').sort(), [...LOOP_SKILLS].sort());
    for (const doc of ['README.md', '.claude/GUIDE.md', 'CLAUDE.md']) {
      const t = read(join(REPO, doc));
      assert.match(t, /\b[Ss]ix (loop )?skills\b/, `${doc} must state the real skill count`);
    }
  });

  test('/eval is outside the loop, and the loop docs do not route work through it', () => {
    // The distinction is the point: the six carry a feature from idea to shipped, and a
    // reader who meets /eval as a seventh step will look for where it fits and find
    // nothing. It measures this repo's prose; it never touches a backlog entry.
    assert.ok(SKILLS.includes('eval'), 'the eval skill should exist');
    const evalSkill = read(join(SKILL_DIR, 'eval', 'SKILL.md'));
    assert.match(evalSkill, /not a step in the build loop/i, 'the skill must say it is off-loop');
    for (const s of LOOP_SKILLS) {
      assert.doesNotMatch(
        unfenced(read(join(SKILL_DIR, s, 'SKILL.md'))),
        /\/eval\b/,
        `/${s} hands off to /eval — the loop must not depend on a measurement`,
      );
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
        // PORTING legitimately discusses the retired measurement-track variant, which has stats.py.
        if (t.includes(g) && !/master|variant/i.test(t.split(g)[0].slice(-200))) {
          hits.push(`${rel(f)} → ${g}`);
        }
      }
    }
    assert.deepEqual(hits, [], 'a deleted script is still referenced as if it exists');
  });
});

describe('the entry lookup returns the whole contract', () => {
  // /implement used to read entries with `grep -A12`, which ended mid-Scope on most of
  // them — so the field the loop closes on, Accept, was never in front of the builder.
  // A fixed line count is wrong the moment one entry runs long, and nothing signals it.
  // So the commands are run, verbatim from the skills, against the real backlog.
  const BACKLOG = join(REPO, 'docs', 'product', 'BACKLOG.md');
  const lines = read(BACKLOG).split('\n');
  const TERMINAL = new Set(['shipped', 'deferred', 'abandoned']);

  // An independent parse of each entry's extent: heading to the line before the next heading.
  const entries = [];
  lines.forEach((l, i) => {
    if (/^##/.test(l) && entries.length && entries.at(-1).end === undefined) entries.at(-1).end = i;
    const m = l.match(/^### (P\d+)\b/);
    if (m) entries.push({ id: m[1], start: i });
  });
  if (entries.length && entries.at(-1).end === undefined) entries.at(-1).end = lines.length;
  for (const e of entries) {
    const body = lines.slice(e.start, e.end).join('\n');
    e.text = body;
    e.open = !TERMINAL.has(body.match(/^- \*\*Status:\*\* (\S+)/m)?.[1]);
  }

  const lookup = (skill) => {
    const m = read(join(SKILL_DIR, skill, 'SKILL.md')).match(/`(awk [^`]*<ID>[^`]*)`/);
    assert.ok(m, `/${skill} no longer names an awk entry lookup — update this test with it`);
    return m[1];
  };

  test('the backlog has entries to look up — the corpus is not silently empty (L3)', () => {
    assert.ok(entries.filter((e) => e.open).length >= 1, 'no open entries parsed; the parser is broken');
  });

  for (const skill of ['implement', 'verify']) {
    test(`/${skill}'s lookup returns every entry whole, Accept included`, () => {
      const cmd = lookup(skill);
      const bad = [];
      for (const e of entries) {
        const r = spawnSync('sh', ['-c', cmd.replaceAll('<ID>', e.id)], { cwd: REPO, encoding: 'utf8' });
        assert.equal(r.status, 0, `lookup failed for ${e.id}: ${r.stderr}`);
        if (r.stdout.trimEnd() !== e.text.trimEnd()) bad.push(`${e.id}: not the whole entry`);
        if (e.open && !/^- \*\*Accept:\*\*/m.test(r.stdout)) bad.push(`${e.id}: Accept missing`);
      }
      assert.deepEqual(bad, [], `/${skill}'s entry lookup truncates or misses entries`);
    });
  }

  test('an ID with no entry returns nothing — the "untriaged" signal /implement relies on', () => {
    const r = spawnSync('sh', ['-c', lookup('implement').replaceAll('<ID>', 'P999')], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.stdout, '');
  });

  test('the old fixed-window grep would fail this — the check bites', () => {
    const truncated = entries.filter((e) => {
      const r = spawnSync('sh', ['-c', `grep -A12 "^### ${e.id}\\b" docs/product/BACKLOG.md`], { cwd: REPO, encoding: 'utf8' });
      return r.stdout.trimEnd() !== e.text.trimEnd();
    });
    assert.ok(truncated.length > 0, 'every entry fits in 13 lines; this control no longer proves anything');
  });
});

describe('the suite is immune to the hook environment that runs it', () => {
  // The pre-commit hook runs this suite under whatever git exported to it, and
  // `git commit -a` exports GIT_INDEX_FILE. Fixture repos inherited it and failed on
  // correct code — a gate that is red for the wrong reason teaches --no-verify. The
  // index points into a temp dir, so a regression cannot write into this repo's .git.
  test('a test file that commits in fixture repos passes with GIT_INDEX_FILE set', () => {
    const r = spawnSync(process.execPath, ['--test', join(REPO, 'tests', 'session-audit.test.mjs')], {
      cwd: REPO,
      encoding: 'utf8',
      // NODE_TEST_CONTEXT, inherited from this runner, puts the child in nested mode:
      // it prints nothing and exits 0 whatever happens — a pass that proves nothing.
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, GIT_INDEX_FILE: join(tempDir(), 'missing', 'index') },
    });
    const passed = Number(r.stdout.match(/^ℹ pass (\d+)/m)?.[1] ?? 0);
    assert.ok(passed > 0, `the child ran no tests, so this proves nothing (L3):\n${r.stdout}${r.stderr}`);
    assert.equal(r.status, 0, `fixture git inherited GIT_INDEX_FILE:\n${r.stdout.split('\n').filter((l) => /✖/.test(l)).join('\n')}`);
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
      for (const m of t.matchAll(/\/(triage|implement|verify|land|ship|checkpoint|eval|research)\b/g)) {
        const name = m[1];
        if (SKILLS.includes(name)) continue;
        // /research is deliberately named as the thing the retired measurement-track variant has.
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

describe("the README's promised output is what the commands actually print", () => {
  // This has now drifted twice: "OK (4 entries across 2 backlog(s))" survived the
  // research-track removal, and "5 entries" survived adding OD-3. A number in a fenced
  // "here's what you'll see" block reads as verified and nothing held it — the exact
  // failure the suite exists to prevent, in its own front door.
  const readme = read(join(REPO, 'README.md'));

  const promises = [
    { claim: /backlog-schema: OK \([^)]+\)/, script: 'backlog-schema-check.mjs' },
    { claim: /verify-guards: armed \([^)]+\)/, script: 'verify-guards.mjs' },
  ];

  for (const { claim, script } of promises) {
    test(`${script} prints exactly what README claims`, () => {
      const promised = readme.match(claim);
      assert.ok(promised, `README no longer shows a ${script} sample — was it removed?`);
      const r = spawnSync(process.execPath, [join(REPO, 'scripts', script), '--all'], {
        cwd: REPO,
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(
        r.stdout.includes(promised[0]),
        `README promises:\n  ${promised[0]}\nbut the command prints:\n  ${r.stdout.trim()}`,
      );
    });
  }
});

describe('the evals stay evals', () => {
  test('`npm test` never runs the eval', () => {
    // The whole reason evals live outside the test suite: a probabilistic measurement
    // wired into a commit gate fails for reasons unrelated to the change, and gets
    // switched off — taking the real tests with it.
    assert.doesNotMatch(pkg.scripts.test, /eval/, 'npm test must not invoke the eval');
    assert.ok(pkg.scripts.eval, 'the eval should still be runnable on its own');
  });

  test('the repo has no dependencies at all — everything runs on a fresh clone', () => {
    // The eval answers come from subagents in the session, not from an API client, so
    // there is nothing left to install. If a dependency ever reappears here, `npm test`
    // and both hooks stop working on a clone until someone runs `npm install` — and
    // the failure looks like a broken check rather than a missing step.
    assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
    assert.equal(pkg.devDependencies, undefined, 'no dev dependencies either');
  });

  test('every eval case still renders and its grader still discriminates', () => {
    // Runs the dry run, which spawns nothing. This is what makes a renamed skill break
    // CI rather than surfacing the first time someone spends a session on the eval.
    const r = spawnSync(process.execPath, [join(REPO, 'evals', 'run.mjs'), '--dry-run'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /every grader accepts the right answer and rejects the wrong one/);
  });

  describe('the emit → reply → grade round trip', () => {
    // The transport is now two commands with a session's work in between, which means
    // the handoff itself — prompt files out, reply files in — is a thing that can break
    // silently. These run the real script on a real directory; no model is involved.
    const eval_ = (...args) =>
      spawnSync(process.execPath, [join(REPO, 'evals', 'run.mjs'), ...args], { cwd: REPO, encoding: 'utf8' });

    const emitted = () => {
      const dir = tempDir();
      const r = eval_('--case', 'depends-gate', '--reps', '1', '--out', dir);
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      return dir;
    };
    const reply = (dir, key, body) => writeFileSync(join(dir, 'replies', `${key}.txt`), body);
    const json = (o) => `Some reasoning.\n\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\`\n`;
    const REFUSE = 'depends-gate-refuses-blocked-entry.0';
    const PROCEED = 'depends-gate-allows-unblocked-entry.0';

    test('emits one prompt per case-rep, and the prompt carries the real SKILL.md', () => {
      const dir = emitted();
      assert.deepEqual(readdirSync(join(dir, 'prompts')).sort(), [`${PROCEED}.md`, `${REFUSE}.md`]);
      const prompt = readFileSync(join(dir, 'prompts', `${REFUSE}.md`), 'utf8');
      const skill = readFileSync(join(REPO, '.claude', 'skills', 'implement', 'SKILL.md'), 'utf8');
      assert.ok(prompt.includes(skill), 'the prompt must contain SKILL.md verbatim, not a paraphrase');
      assert.match(prompt, /Use no tools/, 'a subagent that reads the real repo answers a different question');
    });

    test('grades right answers up and wrong answers down', () => {
      const dir = emitted();
      reply(dir, REFUSE, json({ action: 'refuse', classification: 'not-applicable', cites: ['OD-1'], reason: 'x' }));
      reply(dir, PROCEED, json({ action: 'proceed', classification: 'not-applicable', cites: ['P1'], reason: 'x' }));
      assert.equal(eval_('--grade', dir).status, 0);

      // The same run with the answers swapped must not pass, or the grader is decoration.
      reply(dir, REFUSE, json({ action: 'proceed', classification: 'not-applicable', cites: [], reason: 'x' }));
      const bad = eval_('--grade', dir);
      assert.equal(bad.status, 1);
      assert.match(bad.stdout, /below the bar/);
    });

    test('an unparseable reply fails; it is never skipped', () => {
      const dir = emitted();
      reply(dir, REFUSE, 'I refuse, because OD-1 is open.'); // right call, no JSON block
      reply(dir, PROCEED, json({ action: 'proceed', classification: 'not-applicable', cites: ['P1'], reason: 'x' }));
      const r = eval_('--grade', dir);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /no parseable JSON block/);
      assert.match(r.stdout, /0\/1/, 'an unparseable rep must count against the rate, not vanish from it');
    });

    test('a missing or stray reply refuses to report a rate at all', () => {
      // Both directions of the same failure: a denominator that silently disagrees with
      // the run. Dropping unanswered reps would raise the pass rate — LESSONS L3.
      const dir = emitted();
      reply(dir, REFUSE, json({ action: 'refuse', classification: 'not-applicable', cites: ['OD-1'], reason: 'x' }));
      const missing = eval_('--grade', dir);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /replies are missing/);

      reply(dir, PROCEED, json({ action: 'proceed', classification: 'not-applicable', cites: ['P1'], reason: 'x' }));
      writeFileSync(join(dir, 'replies', 'not-a-case.txt'), 'hello');
      const stray = eval_('--grade', dir);
      assert.equal(stray.status, 2);
      assert.match(stray.stderr, /match no prompt in the manifest/);
    });
  });
});

describe('the enforcement layer survives a fresh clone', () => {
  // Committing a hook is not shipping a hook. Git reads `.git/hooks/`, which no clone
  // populates and no commit can reach, so the failure mode this guards is a checkout
  // where the enforcement layer is present as text and absent as behavior — worse than
  // having no hook at all, because the file is right there and reads as if it ran.
  //
  // None of this needs a model or a network: it is all decidable from the repo.

  test('`npm install` arms the hooks by itself', () => {
    // `prepare` is the only lifecycle script that runs on the plain `npm install` a
    // clone already does. Losing it turns arming back into a manual step nobody knows
    // to take, and the loss looks like an innocuous package.json tidy in a diff.
    assert.ok(pkg.scripts?.prepare, 'package.json must have a `prepare` script');
    assert.match(pkg.scripts.prepare, /install-hooks/, '`prepare` must run the hook installer');
    assert.ok(existsSync(join(REPO, 'scripts', 'install-hooks.mjs')), 'the installer must exist');
  });

  test('the installer never fails an install', () => {
    // A hook installer that can exit non-zero breaks `npm install` in tarballs, in
    // sandboxes without git, and on CI runners — trading a missing convenience for a
    // broken package. Run it for real; it is idempotent and this repo is a work tree.
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'install-hooks.mjs')], {
      cwd: REPO,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `installer exited ${r.status}: ${r.stdout}\n${r.stderr}`);
  });

  test('every committed hook is executable', () => {
    // core.hooksPath runs these files directly. A hook committed 644 is silently
    // skipped by git — no error, no output, just an enforcement layer that is not there.
    const dir = join(REPO, '.claude', 'hooks');
    const notExec = readdirSync(dir)
      .filter((n) => !n.endsWith('.md')) // the directory's own README is documentation
      .filter((n) => (statSync(join(dir, n)).mode & 0o111) === 0);
    assert.deepEqual(notExec, [], 'a hook without the executable bit is skipped in silence');
  });

  describe('personal hooks survive core.hooksPath', () => {
    // core.hooksPath redirects git's ENTIRE hook lookup — not just the names this repo
    // claims. Verified by hand: a personal .git/hooks/pre-commit AND an unrelated
    // post-commit both ran before the setting and neither ran after, with no error and
    // no output either time. Every hook here chains `<name>.local` to give that back.
    //
    // `npm` is stubbed on PATH throughout: running the real pre-commit would recurse
    // into `npm test`, i.e. into this file. The chaining is what is under test, not the
    // suite it gates on.
    const HOOK_DIR = join(REPO, '.claude', 'hooks');
    const hookFiles = () => readdirSync(HOOK_DIR).filter((n) => !n.endsWith('.md') && n !== '_chain');

    /** Run a committed hook in a throwaway repo, optionally with a personal hook present. */
    function runHook(name, { local, localMode = 0o755, args = [], stdin = '' } = {}) {
      const dir = tempDir();
      gitInit(dir);
      const bin = join(dir, 'stub-bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      if (local !== undefined) {
        const hooks = join(dir, '.git', 'hooks');
        mkdirSync(hooks, { recursive: true });
        writeFileSync(join(hooks, `${name}.local`), local, { mode: localMode });
      }
      const r = spawnSync('/bin/sh', [join(HOOK_DIR, name), ...args], {
        cwd: dir,
        input: stdin,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    }

    test('every hook exits 0 when there is no personal hook to chain', () => {
      // THE TRAP, and the reason this is a test rather than a code review note:
      // `[ -x "$LOCAL" ] && exec "$LOCAL"` as a final line makes the FAILED test the
      // exit status. Every clone without a personal hook would then have every commit
      // rejected — by the hooks installed to help it.
      const bad = hookFiles().filter((n) => runHook(n).code !== 0);
      assert.deepEqual(bad, [], 'a hook rejects when nothing is chained');
    });

    test('every hook runs its personal counterpart', () => {
      const silent = hookFiles().filter(
        (n) => !/RAN/.test(runHook(n, { local: '#!/bin/sh\necho RAN\n' }).stdout),
      );
      assert.deepEqual(silent, [], 'a hook does not chain to its .local counterpart');
    });

    test("every hook lets the personal hook's rejection through", () => {
      // The point of `exec`. Called rather than exec'd, the chained hook's exit code is
      // swallowed and a hook that means to block silently appears to pass.
      const swallowed = hookFiles().filter((n) => runHook(n, { local: '#!/bin/sh\nexit 3\n' }).code !== 3);
      assert.deepEqual(swallowed, [], "a hook swallows the personal hook's verdict");
    });

    test('a non-executable personal hook is ignored, not fatal', () => {
      // A chmod slip must not wedge every commit in the repo.
      assert.equal(runHook('pre-commit', { local: '#!/bin/sh\nexit 1\n', localMode: 0o644 }).code, 0);
    });

    test('stdin reaches the personal hook untouched', () => {
      // pre-push and post-rewrite carry their real payload on stdin. A single `read` in
      // the dispatcher would eat the line the personal hook needs and leave it hanging.
      const r = runHook('pre-push', {
        local: '#!/bin/sh\nread line\necho "GOT:$line"\n',
        stdin: 'refs/heads/main abc123\n',
      });
      assert.match(r.stdout, /GOT:refs\/heads\/main abc123/, 'the dispatcher consumed stdin');
    });

    test('hook arguments reach the personal hook', () => {
      // commit-msg gets the message path; post-checkout gets three refs. Dropping "$@"
      // leaves the chained hook operating on nothing, which mostly looks like success.
      const r = runHook('commit-msg', { local: '#!/bin/sh\necho "ARGS:$*"\n', args: ['.git/COMMIT_EDITMSG'] });
      assert.match(r.stdout, /ARGS:\.git\/COMMIT_EDITMSG/, 'arguments were dropped');
    });

    test('every stub delegates under its own name', () => {
      // A copy-pasted stub naming the hook it was copied from would chain the WRONG
      // personal hook — the one failure here that produces plausible-looking output.
      const wrong = [];
      for (const n of hookFiles()) {
        if (n === 'pre-commit') continue; // carries suite logic; asserted separately below
        const src = read(join(HOOK_DIR, n));
        if (!src.includes(`/_chain" ${n} "$@"`)) wrong.push(n);
      }
      assert.deepEqual(wrong, [], 'a stub delegates under a name that is not its own');
    });

    test('pre-commit still gates on the suite before chaining', () => {
      const src = read(join(HOOK_DIR, 'pre-commit'));
      assert.match(src, /npm test/, 'pre-commit must still run the suite');
      assert.ok(
        src.indexOf('npm test') < src.indexOf('_chain'),
        'the suite gate must run before the handoff, so the cheap failure comes first',
      );
    });

    test('hooks that change git behavior by merely existing are NOT stubbed', () => {
      // push-to-checkout: "This hook is to be used to override the default behaviour"
      // (git's manual). A do-nothing stub tells git the checkout was handled while doing
      // nothing — so stubbing it would BREAK pushes rather than pass them through. This
      // is the one entry in this directory that must stay absent.
      for (const n of ['push-to-checkout', 'proc-receive']) {
        assert.ok(!existsSync(join(HOOK_DIR, n)), `${n} must not be stubbed — existence changes git's behavior`);
      }
    });

    test('the README documents the boundary, and _chain is what enforces it', () => {
      // The excluded set is only discoverable here: the symptom of a missing stub is a
      // hook that quietly stops running, which produces nothing to search for.
      const readme = read(join(HOOK_DIR, 'README.md'));
      for (const n of ['push-to-checkout', 'reference-transaction', 'fsmonitor-watchman']) {
        assert.match(readme, new RegExp(n), `README must say why ${n} is not stubbed`);
      }
      const chain = read(join(HOOK_DIR, '_chain'));
      assert.match(chain, /git rev-parse --git-common-dir/, 'worktree-correct path resolution');
      assert.match(chain, /\.local/, '_chain must name the convention it looks for');
    });
  });

  test('the CI workflow that the docs promise exists, and runs the suite', () => {
    // Several files tell the reader "CI still runs all of this" — an invitation to
    // --no-verify. That sentence must not be able to outlive the workflow it describes.
    const wf = join(REPO, '.github', 'workflows', 'test.yml');
    assert.ok(existsSync(wf), 'the docs promise CI; the workflow must exist');
    const yml = read(wf);
    assert.match(yml, /^\s*-\s*run:\s*npm test\s*$/m, 'CI must run the full suite');
    assert.doesNotMatch(yml, /npm run eval/, 'CI must never gate on the eval');
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
