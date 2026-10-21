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

import { REGISTERS, BACKLOG, BUGS, parseEntry } from './entries.mjs';

const lines = (s) => (s || '').split('\n').filter(Boolean);

// The files /ship writes on main. A commit touching nothing else is bookkeeping, never a
// build landing, whatever its subject says.
const BOOKKEEPING = [...REGISTERS.map((r) => `${r.dir}/`), 'docs/BUILD_ORDER.md', 'docs/ARCHITECTURE.md'];

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

  // Landings are merges on main's first-parent line (or, after a squash or rebase, the
  // copied commits; see `squashed`); the branch may be deleted by then, so
  // the merge commit's subject (`Merge branch 'feat/p7-…'`) is what names it. A merge
  // belongs to the current claim when it comes after the claim commit on that line —
  // order, not committer dates, which tie within a second and skew between machines.
  // Read on first use: most runs of next.mjs have nothing claimed to ask about.
  let merges = null;
  let firstParent = null;
  // A GitHub merge names the branch as `<owner>/<branch>`, a remote one as `<remote>/<branch>`.
  const mergedBranch = (subject) => (subject.match(/^Merge branch '([^']+)'/i)
    || subject.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/i)
    || subject.match(/^Merge remote-tracking branch '[^/']+\/([^']+)'/i)
    || subject.match(/^merge (\S+)/i) || [])[1] ?? '';

  // A squash or rebase merge leaves no merge commit: the work arrives as ordinary commits
  // on main's first-parent line. By the loop's convention (/implement puts the ID in every
  // commit subject; asserted, no hook enforces it) a commit names its entry —
  // `feat: … (P1)`, `(P5 R1)`, `(P37, B4)` — and a GitHub squash lists the branch's
  // commits in its body (`* feat: … (P1)`). So a commit after the claim that names the ID
  // there is a landing, unless it is /ship's bookkeeping or a revert; a revert also
  // cancels the landing it names (`This reverts commit <sha>.`). A squash whose title and
  // body both omit the ID stays invisible.
  const squashed = (id, claim) => {
    if (!claim) return [];
    const tag = new RegExp(`\\((?:[^)]*[\\s,])?${id}(?:[\\s,][^)]*)?\\)`, 'i');
    const found = [];
    const reverted = new Set();
    const log = git('log', '--first-parent', '--no-merges', '--name-only', '--format=%x1e%H%x09%cI%x09%B%x1f', `${claim.sha}..${base}`) || '';
    for (const rec of log.split('\x1e').filter((r) => r.trim())) {
      const [head, files = ''] = rec.split('\x1f');
      const [sha, at, ...msg] = head.trim().split('\t');
      const [subject, ...body] = msg.join('\t').split('\n');
      if (/^revert\b/i.test(subject)) {
        for (const m of body.join('\n').matchAll(/This reverts commit ([0-9a-f]{7,40})/g)) reverted.add(m[1]);
        continue;
      }
      if (!(tag.test(subject) || body.some((l) => /^\s*\* /.test(l) && tag.test(l)))) continue;
      const touched = lines(files);
      if (touched.length && touched.every((f) => BOOKKEEPING.some((p) => f === p || f.startsWith(p)))) continue;
      found.push({ sha, at });
    }
    return found.filter((L) => ![...reverted].some((r) => L.sha.startsWith(r)));
  };

  // Whether landing commit `L` already holds the work at commit `x`: merging `x` into `L`
  // changes nothing. That covers a merge, a squash and a rebase alike, and a squash whose
  // files other work also changed. Checked against the landing, not main's tip, so later
  // edits on main can't turn landed work back into a build. A conflict reads as "not
  // held", and so does everything on git before 2.38 (no `merge-tree --write-tree`).
  // merge-tree writes the merged tree into the object store; git gc collects it.
  const noop = (L, x) => {
    const t = git('merge-tree', '--write-tree', L, x);
    return t !== null && t.split('\n')[0] === git('rev-parse', `${L}^{tree}`);
  };
  const heldBy = (landed, x) => landed.some((L) => noop(L.sha, x));

  // A branch on main's first-parent line has no work of its own to look at: it is a fresh
  // cut (a rebuild), or its own commits became main's by a fast-forward. Its reflog tells
  // them apart by the commits it made itself since the claim; a fresh cut's holds none.
  // A landed branch reused for a rebuild reads as landed until its first new commit: with
  // nothing new on it, the two can't be told apart. An expired or disabled reflog reads
  // as a build.
  const MADE = /^(commit|cherry-pick|rebase \((pick|reword|edit|squash|fixup|continue|finish)\))/;
  const madeLanded = (b, claim, landed) => [...new Set(lines(git('log', '-g', '-n', '50', '--format=%H%x09%gs', `refs/heads/${b}`))
    .map((l) => l.split('\t')).filter(([, gs]) => MADE.test(gs ?? '')).map(([sha]) => sha))]
    .filter((r) => !claim || !isAncestor(r, claim.sha))
    .some((r) => isAncestor(r, base) || heldBy(landed, r));

  /** When the current claim's branch landed, or null while it is still being built. */
  const landedAt = (id, claim = claimedAt(id)) => {
    merges ??= lines(git('log', '--first-parent', '--merges', '--format=%H%x09%cI%x09%s', base)).map((l) => l.split('\t'));
    // Newest first, so a landing after the claim is listed before the claim commit.
    const after = claim ? lines(git('rev-list', '--first-parent', `${claim.sha}..${base}`)) : null;
    const landed = [
      ...merges.filter(([sha, , s]) => names(id).test(mergedBranch(s)) && (!after || after.includes(sha)))
        .map(([sha, at]) => ({ sha, at })),
      ...squashed(id, claim),
    ];
    if (!landed.length) return null;
    if (after) landed.sort((a, b) => after.indexOf(a.sha) - after.indexOf(b.sha));
    // Every local branch for the entry, not just the first: a leftover is not this build;
    // one whose work has landed is done; any other — kept going after its landing, or cut
    // fresh from main to rebuild a rejected one — is a build in flight.
    for (const b of branchesOf(id)) {
      if (leftover(b, claim)) continue;
      if (!isAncestor(b, base)) {
        if (heldBy(landed, b)) continue; // its own work, squashed or rebased in
        return null;
      }
      // On main but off its first-parent line: it arrived through a merge, so it landed.
      firstParent ??= new Set(lines(git('rev-list', '--first-parent', base)));
      if (!firstParent.has(git('rev-parse', b)) || madeLanded(b, claim, landed)) continue;
      return null;
    }
    return landed[0].at;
  };

  return { branchOf, claimedAt, landedAt };
}
