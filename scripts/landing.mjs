// landing — whether an `in-progress` entry is still being built, or has landed and waits
// on the owner (P7, B4).
//
// /land never flips `shipped`: that is the owner's verdict. So `in-progress` on main
// means one of two things, and only git can say which. An entry whose branch merged
// into main since the claim began is awaiting acceptance; anything else is a build in
// flight. status.mjs reports the difference to the owner, and next.mjs gives it as the
// reason it skipped the entry. One reading here, so the two never disagree.
//
// `git` is the caller's runner: (...args) => trimmed stdout, or null when git failed.
// `branches` is the caller's list of local branches. `blobs` reads many `<rev>:<path>`
// specs at once (status.mjs batches them through one cat-file); without it, each is a
// `git show`.

import { BACKLOG, BUGS, parseEntry } from './entries.mjs';

const lines = (s) => (s || '').split('\n').filter(Boolean);

export function landings(git, base, { branches, blobs } = {}) {
  const read = blobs ?? ((specs) => specs.map((s) => git('show', s)));
  const fileOf = (id) => `${(BACKLOG.idPattern.test(id) ? BACKLOG : BUGS).dir}/${id}.md`;
  // An entry's branch is worktree.mjs's `feat/<id>-<slug>`; `adhoc/…` work has no entry.
  const names = (id) => new RegExp(`^feat/${id}-`, 'i');
  const branchesOf = (id) => branches.filter((b) => b !== base && names(id).test(b));
  const isAncestor = (a, b) => git('merge-base', '--is-ancestor', a, b) !== null;
  // A branch that is not this claim's build: all it shares with main came before the claim
  // commit (an earlier milestone's leftovers), or it shares nothing with main at all.
  const leftover = (b, claim) => {
    const fork = git('merge-base', b, base);
    return !fork || (!!claim && isAncestor(fork, `${claim.sha}~1`));
  };
  /** The entry's branch for this claim; a leftover only when there is nothing else. */
  const branchOf = (id, claim = null) => {
    const all = branchesOf(id);
    return all.find((b) => !leftover(b, claim)) ?? all[0] ?? null;
  };

  // When the current claim began: the oldest commit of the unbroken run, newest first, in
  // which the entry's status is `in-progress`. An earlier milestone's claim is a different
  // run. First-parent only: a merged branch's own commits carry its older copy of the entry.
  // Returns { sha, at } (the claim commit and its date), or null.
  const claimedAt = (id) => {
    const file = fileOf(id);
    const log = lines(git('log', '--first-parent', '--format=%H %cI', base, '--', file)).map((l) => l.split(' '));
    const texts = read(log.map(([sha]) => `${sha}:${file}`));
    let claim = null;
    for (let n = 0; n < log.length; n++) {
      if (parseEntry(texts[n] ?? '', { status: 'word' }).header.status !== 'in-progress') break;
      claim = { sha: log[n][0], at: log[n][1] };
    }
    return claim;
  };

  // Landings are merges on main's first-parent line; the branch may be deleted by then, so
  // the merge commit's subject (`Merge branch 'feat/p7-…'`) is what names it. A merge
  // belongs to the current claim when it comes after the claim commit on that line —
  // order, not committer dates, which tie within a second and skew between machines.
  // Read on first use: most runs of next.mjs have nothing claimed to ask about.
  let merges = null;
  // A GitHub merge names the branch as `<owner>/<branch>`, a remote one as `<remote>/<branch>`.
  // A squash or rebase merge leaves no merge commit, so it is not seen as a landing.
  const mergedBranch = (subject) => (subject.match(/^Merge branch '([^']+)'/i)
    || subject.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/i)
    || subject.match(/^Merge remote-tracking branch '[^/']+\/([^']+)'/i)
    || subject.match(/^merge (\S+)/i) || [])[1] ?? '';

  /** When the current claim's branch landed, or null while it is still being built. */
  const landedAt = (id, claim = claimedAt(id)) => {
    merges ??= lines(git('log', '--first-parent', '--merges', '--format=%H%x09%cI%x09%s', base)).map((l) => l.split('\t'));
    // Newest first, so a merge after the claim is listed before the claim commit.
    const after = claim ? lines(git('rev-list', '--first-parent', `${claim.sha}..${base}`)) : null;
    const landed = merges.filter(([sha, , s]) => names(id).test(mergedBranch(s)) && (!after || after.includes(sha)));
    if (!landed.length) return null;
    // Every local branch for the entry, not just the first: a leftover is not this build;
    // one a landing contains is work that landed; any other — kept going after its merge,
    // or cut fresh from main after it to rebuild a rejected landing — is a build in flight.
    for (const b of branchesOf(id)) {
      if (leftover(b, claim)) continue;
      if (!landed.some(([sha]) => isAncestor(b, `${sha}^2`))) return null;
    }
    return landed[0][1];
  };

  return { branchOf, claimedAt, landedAt };
}
