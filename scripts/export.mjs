// export — write a clean copy of the suite, ready to drop into another project (P28).
//
//   node scripts/export.mjs <dir>
//
// Writes every tracked file the manifest marks `suite`, verbatim, then lays
// `template/` over the root: each file under `template/x` becomes `x` in the copy.
// That is how the copy gets a starting state for the files this repo keeps as its own
// (the registers, the queue, the spec, CLAUDE.md): a seed entry where the schema check
// refuses an empty register, and the PORTING placeholders where a project writes its
// own. `{{today}}` in a template becomes today's date, so seeds start fresh rather
// than stale.
//
// Tracked files only, read from git: an untracked scratch file in this checkout must
// not ride along into someone else's project. And the target must be empty or absent,
// so an export never overwrites anything. Exit 1 on either refusal, naming why.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, statSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { classify, trackedFiles, problems } from './manifest.mjs';
import { today as localToday } from './entries.mjs';

const TEMPLATE = 'template/';

const die = (msg) => { console.error(`export: ${msg}`); process.exit(1); };

const target = process.argv[2];
if (!target) die('usage: node scripts/export.mjs <dir>');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const out = resolve(target);
if (existsSync(out) && readdirSync(out).length) die(`${out} is not empty; export writes only into an empty or new directory`);

const files = trackedFiles(root);
const bad = problems(files);
// An unmarked file is exactly the one whose side nobody knows, so exporting around it
// would be guessing. Refuse, and let the manifest check name it.
if (bad.length) die(`the manifest is incomplete, so the export can't tell suite from instance:\n  ${bad.join('\n  ')}`);

const today = localToday();

const write = (rel, from, fill) => {
  const dest = join(out, rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (fill) writeFileSync(dest, readFileSync(from, 'utf8').replaceAll('{{today}}', today));
  else copyFileSync(from, dest);
  // Hooks are executables; a copy that lost the bit is a hook git silently skips.
  chmodSync(dest, statSync(from).mode);
};

const suite = files.filter((f) => classify(f) === 'suite');
for (const f of suite) write(f, join(root, f));

const seeded = suite.filter((f) => f.startsWith(TEMPLATE));
// A template stands in for an instance file and nothing else. One landing on a suite
// path would silently replace the suite's own copy; one landing on an unmarked path
// would fail the copy's manifest check.
const misplaced = seeded.filter((f) => classify(f.slice(TEMPLATE.length)) !== 'instance');
if (misplaced.length) die(`a template must stand in for an instance file:\n  ${misplaced.map((f) => `${f} → ${f.slice(TEMPLATE.length)} is ${classify(f.slice(TEMPLATE.length)) ?? 'unmarked'}`).join('\n  ')}`);
for (const f of seeded) write(f.slice(TEMPLATE.length), join(root, f), true);

console.log(`export: ${out} (${suite.length} suite files, ${seeded.length} from ${TEMPLATE})`);
