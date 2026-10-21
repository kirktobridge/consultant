// commit-ids — every commit on an entry's branch names the entry (B7).
//
// The loop has always tagged a build's commits with its ID (`fix: … (B7)`): `npm run
// history` finds an entry's commits that way, and landing.mjs finds a squash or rebase
// landing that way, since neither leaves a merge commit naming the branch. Until this,
// the tag was a convention the /implement prose asked for and nothing held. Now two
// placements hold it:
//
//   --msg <file>   the commit-msg hook (.claude/hooks/commit-msg). On a branch named
//                  `feat/<id>-…`, the subject must name <id>. Merges, `fixup!`/`squash!`/
//                  `amend!` and reverts pass: git writes those subjects. A detached HEAD
//                  (mid-rebase, replaying commits already checked) passes too.
//   --history      `npm test`. Every non-merge commit on the branch side of each
//                  `feat/<id>-…` merge on the trunk names <id>. The hook is per-clone
//                  and `--no-verify` skips it; this runs in CI, over what actually landed.
//                  With no local trunk (a CI checkout), it reads the remote's.
//
// Only a branch whose `<id>` is an entry ID (P#, B#) counts: `feat/http2-…` is not one.
//
// Tag shape: landing.mjs's namesId — `(B7)`, `(P5 R1)`, `(P37, B4)`.
//
// Exit: 0 every commit names its entry (or there is nothing to check, said on stdout)
//     | 1 one doesn't (each is named) | 2 could not run (bad arguments, no trunk)
//
// Usage: node scripts/commit-ids.mjs --msg <file>
//        node scripts/commit-ids.mjs --history [--base <branch>]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { namesId, entryOfBranch, mergedBranch } from './landing.mjs';
import { trunkFromArgv, TRUNK_CANDIDATES } from './trunk.mjs';

const argv = process.argv.slice(2);
const WIN = process.platform === 'win32' ? ['-c', 'core.filemode=false'] : [];
const git = (...args) => {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...WIN, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20,
    }).trim();
  } catch { return null; }
};
const lines = (s) => (s || '').split('\n').filter(Boolean);
const stop = (msg) => { console.error(`commit-ids: ${msg}`); process.exit(2); };
// Subjects git writes itself; their tag, if any, is the original commit's.
const GENERATED = /^(Merge |fixup! |squash! |amend! |Revert )/;

if (argv[0] === '--msg') {
  if (!argv[1]) stop('--msg needs the commit message file git passes the hook.');
  let text;
  try { text = readFileSync(argv[1], 'utf8'); } catch (e) { stop(`cannot read ${argv[1]}: ${e.message}`); }
  const subject = text.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? '';
  const branch = git('symbolic-ref', '--short', '-q', 'HEAD');
  const id = branch ? entryOfBranch(branch) : null;
  if (!id || !subject || GENERATED.test(subject) || namesId(subject, id)) process.exit(0);
  console.error(`commit-ids: on ${branch}, a commit names ${id} in its subject — e.g. "fix: ${subject.replace(/^\w+(\(.*?\))?:\s*/, '')} (${id})".`);
  console.error('  npm run history and the landing check find an entry\'s commits by that tag.');
  console.error('  To commit anyway: git commit --no-verify  (npm test still checks what lands).');
  process.exit(1);
}

if (argv[0] === '--history') {
  if (git('rev-parse', '--git-dir') === null) { console.log('commit-ids: not a git repository — nothing to check.'); process.exit(0); }
  const branches = lines(git('for-each-ref', '--format=%(refname:short)', 'refs/heads'));
  let { trunk, error } = trunkFromArgv(argv, branches);
  // A CI checkout holds no local trunk (a feature push makes only that branch; a pull
  // request, none), but a full fetch holds the remote's. Unasked only: a --base that
  // names nothing still stops, as everywhere else (B1).
  if (error && !argv.includes('--base')) {
    const remote = lines(git('for-each-ref', '--format=%(refname:short)', 'refs/remotes'))
      .find((r) => TRUNK_CANDIDATES.includes(r.replace(/^[^/]+\//, '')));
    if (remote) { trunk = remote; error = null; }
  }
  if (error) stop(error);
  const bad = [];
  let checked = 0;
  let unreadable = 0;
  for (const l of lines(git('log', '--first-parent', '--merges', '--format=%H%x09%s', trunk))) {
    const [sha, subject] = l.split('\t');
    const id = entryOfBranch(mergedBranch(subject));
    if (!id) continue;
    // The branch's own line only: commits it merged in from another unlanded branch carry
    // that branch's ID, and are checked when that one lands.
    const side = git('log', '--first-parent', '--no-merges', '--format=%h%x09%s', `${sha}^1..${sha}^2`);
    if (side === null) { unreadable++; continue; } // a shallow clone holds no second parent
    for (const c of lines(side)) {
      checked++;
      const [h, s] = c.split('\t');
      if (!GENERATED.test(s) && !namesId(s, id)) bad.push(`${h} "${s}" — landed as ${id} (merge ${sha.slice(0, 7)}) but doesn't name it`);
    }
  }
  const shallow = unreadable ? `; ${unreadable} merge(s) unreadable — a shallow clone? fetch the full history` : '';
  if (bad.length) {
    console.error(`commit-ids: ${bad.length} landed commit(s) don't name their entry:`);
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
  console.log(`commit-ids: OK (${checked} landed branch commit(s) on ${trunk} name their entry${shallow})`);
  process.exit(0);
}

stop('usage: commit-ids.mjs --msg <file> | --history [--base <branch>]');
