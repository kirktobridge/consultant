// claims — /implement's CLAIM GATE: which entries are `in-progress` on the trunk (P12).
//
// The gate used to be a pipeline, `git grep … main -- … | grep ":status: in-progress$"`.
// It assumed `main`, and worse, it failed the wrong way: on a clone with no `main`,
// `git grep` errors, the second grep sees nothing, and "nothing" reads exactly like
// "no claims". A gate that passes because it never ran is the one outcome it must not
// have. So the gate is a command, and a trunk it can't find is exit 2, never exit 0.
//
// Read from the trunk, never the checked-out copy: in a worktree the local files are as
// old as the branch and miss a claim made since. Headers are parsed with the schema
// check's reader, so a body line that quotes `status: in-progress` is not a claim
// (found by /verify P20).
//
// Exit: 0 the trunk was read — one line per claim, `<ID> in-progress <path> on <trunk>`,
// or `claims: none on <trunk>` | 2 could not run (not a repo, no trunk — the message
// says how to name one — or an entry on the trunk it could not read)
//
// Usage: node scripts/claims.mjs [--base <branch>] [--json]

import { execFileSync } from 'node:child_process';
import { BUILDABLE, parseEntry } from './entries.mjs';
import { trunkFromArgv } from './trunk.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

// Same git invocation as next.mjs, for the reasons given in session-audit.
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
let lastError = '';
const gitRaw = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
    });
  } catch (e) {
    lastError = String(e.stderr ?? e.message ?? '').trim();
    return null;
  }
};
const git = (...args) => gitRaw(...args)?.trim() ?? null;
git.raw = gitRaw;
const stop = (msg) => { console.error(`claims: ${msg}`); process.exit(2); };

if (git('rev-parse', '--git-dir') === null) stop(`not a git repository, or git refused it.${lastError ? ` git: ${lastError.split('\n')[0]}` : ''}`);
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const { trunk: TRUNK, error } = trunkFromArgv(argv, branches);
if (error) stop(`${error} The claim gate cannot pass without reading the trunk.`);

const claims = [];
for (const reg of BUILDABLE) {
  // A register directory absent on the trunk holds no claims. Asked by path, ls-tree
  // answers that with empty output and exit 0, so any failure below is a failure to
  // read — and a gate that could not read must not report "none".
  const present = git('ls-tree', '-d', '--name-only', TRUNK, '--', reg.dir);
  if (present === null) stop(`could not read ${TRUNK}'s tree. git: ${lastError.split('\n')[0]}`);
  if (!present) continue;
  const listing = git('ls-tree', '--name-only', `${TRUNK}:${reg.dir}`);
  if (listing === null) stop(`could not list ${reg.dir} on ${TRUNK}. git: ${lastError.split('\n')[0]}`);
  for (const f of listing.split('\n').filter((n) => /\.md$/.test(n) && reg.idPattern.test(n.replace(/\.md$/, '')))) {
    const path = `${reg.dir}/${f}`;
    // Untrimmed: trim() strips a leading blank line or BOM, quietly repairing a header
    // the schema check rejects, so the gate would read a file that isn't there.
    const text = git.raw('show', `${TRUNK}:${path}`);
    if (text === null) stop(`could not read ${path} on ${TRUNK}. git: ${lastError.split('\n')[0]}`);
    const { header } = parseEntry(text, reg.keys);
    // No status means the header never parsed (a BOM, CRLF, a stray first line). That
    // entry's claim is unknown, not absent, so the gate cannot pass over it.
    if (!header.status) stop(`${path} on ${TRUNK} has no readable \`status:\` header, so whether it is claimed is unknown. Run npm run check:docs for what is wrong with it.`);
    if (header.status === 'in-progress') claims.push({ id: header.id ?? f.replace(/\.md$/, ''), path });
  }
}

if (asJson) console.log(JSON.stringify({ trunk: TRUNK, claims }));
else if (!claims.length) console.log(`claims: none on ${TRUNK}`);
else for (const c of claims) console.log(`${c.id} in-progress ${c.path} on ${TRUNK}`);
