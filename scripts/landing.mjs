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

/**
 * Whether `text` names entry `id` the way the loop's commits do: a parenthesised tag
 * holding the ID, alone or with others — `(P1)`, `(P5 R1)`, `(P37, B4)`. `(P11)` does
 * not name P1. commit-ids.mjs holds every branch commit to this (B7).
 */
export const namesId = (text, id) => new RegExp(`\\((?:[^)]*[\\s,])?${id}(?:[\\s,][^)]*)?\\)`, 'i').test(text);

/** The entry a branch builds, from worktree.mjs's `feat/<id>-<slug>`, or null. */
export const entryOfBranch = (branch) => {
  const id = (branch.match(/^feat\/([a-z]+\d+)-/i)?.[1] ?? '').toUpperCase();
  return [BACKLOG, BUGS].some((r) => r.idPattern.test(id)) ? id : null;
};

// A GitHub merge names the branch as `<owner>/<branch>`, a remote one as `<remote>/<branch>`.
export const mergedBranch = (subject) => (subject.match(/^Merge branch '([^']+)'/i)
  || subject.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/i)
  || subject.match(/^Merge remote-tracking branch '[^/']+\/([^']+)'/i)
  || subject.match(/^merge (\S+)/i) || [])[1] ?? '';

export function landings(git, base, { branches, blobs } = {}) {
  const read = blobs ?? ((specs) => specs.map((s) => git('show', s)));
  const fileOf = (id) => `${(BACKLOG.idPattern.test(id) ? BACKLOG : BUGS).dir}/${id}.md`;
  // An entry's branch is worktree.mjs's `feat/<id>-<slug>`; `adhoc/…` work has no entry.
  const names = (id) => new RegExp(`^feat/${id}-`, 'i');
  const branchesOf = (id) => branches.filter((b) => b !== base && names(id).test(b));
  // A build pushed from another clone shows here only as a remote-tracking branch
  // (`origin/feat/p1-…`). Read on first use.
  let remotes = null;
  const remoteBranchesOf = (id) => {
    remotes ??= lines(git('for-each-ref', '--format=%(refname:short)', 'refs/remotes'));
    return remotes.filter((r) => names(id).test(r.replace(/^[^/]+\//, '')));
  };
  const isAncestor = (a, b) => git('merge-base', '--is-ancestor', a, b) !== null;
  // A branch that is not this claim's build: all it shares with main came before the claim
  // commit (an earlier milestone's leftovers), or it shares nothing with main at all.
  const leftover = (b, claim) => {
    const fork = git('merge-base', b, base);
    return !fork || (!!claim && isAncestor(fork, `${claim.sha}~1`));
  };
  /**
   * The entry's branch for this claim: a local one, else one only a remote holds (a
   * build in another clone, `origin/feat/p1-…`); a leftover only when there is nothing else.
   */
  const branchOf = (id, claim = null) => {
    const all = [...branchesOf(id), ...remoteBranchesOf(id)];
    return all.find((b) => !leftover(b, claim)) ?? all[0] ?? null;
  };

  // When the current claim began: the oldest commit of the unbroken run, newest first, in
  // which the entry's status is `in-progress`. An earlier milestone's claim is a different
  // run. First-parent only: a merged branch's own commits carry its older copy of the entry.
  // Returns { sha, at, from } (the claim commit, its date, and where landings start
  // counting), or null.
  //
  // `from` is the claim commit, or — once the owner has rejected a landing — the commit
  // that recorded the latest rejection (/ship appends its date to `rejected:`, so the
  // value changes with each one, the same day's included). A landing before it was a
  // rejected one, so it no longer counts (B7).
  const claimedAt = (id) => {
    const file = fileOf(id);
    const log = lines(git('log', '--first-parent', '--format=%H %cI', base, '--', file)).map((l) => l.split(' '));
    const texts = read(log.map(([sha]) => `${sha}:${file}`));
    const headers = [];
    for (let n = 0; n < log.length; n++) {
      const h = parseEntry(texts[n] ?? '', { status: 'word', rejected: 'dates' }).header;
      if (h.status !== 'in-progress') break;
      headers.push(h);
    }
    if (!headers.length) return null;
    const last = headers.length - 1;
    const claim = { sha: log[last][0], at: log[last][1], from: log[last][0] };
    for (let n = 0; n < last; n++) {
      if (headers[n].rejected && headers[n].rejected !== headers[n + 1].rejected) { claim.from = log[n][0]; break; }
    }
    return claim;
  };

  // Landings are merges on main's first-parent line (or, after a squash or rebase, the
  // copied commits; see `squashed`); the branch may be deleted by then, so
  // the merge commit's subject (`Merge branch 'feat/p7-…'`) is what names it. A merge
  // belongs to the current claim when it comes after `from` on that line — order, not
  // committer dates, which tie within a second and skew between machines.
  // Read on first use: most runs of next.mjs have nothing claimed to ask about.
  let merges = null;
  let firstParent = null;
  let direct = null;

  // A squash or rebase merge leaves no merge commit: the work arrives as ordinary commits
  // on main's first-parent line. Every commit on an entry's branch names it (commit-ids.mjs
  // holds that: the commit-msg hook locally, `npm test` over main's history), and a GitHub
  // squash lists those commits in its body (`* feat: … (P1)`). So a commit after the claim
  // that names the ID there is a landing — unless it is /ship's bookkeeping, or a revert
  // (which also cancels the landing it names: `This reverts commit <sha>.`). A squash whose
  // title and body both omit the ID stays invisible.
  //
  // Main's reflog says which commits were made on it here (`commit: …`). Such a commit is
  // someone working on main, or a squash made by hand. A hand squash may say so — a `(#N)`
  // pull-request suffix, a `* …` list naming the ID, git's own `Squashed commit of the
  // following:` (its subject, then each commit's log entry, subject indented) — and then
  // it is a landing; if not, it is `weak` (below). A direct commit made in another clone
  // and pulled has no such record here, so it reads as a landing.
  const GIT_SQUASH = /^Squashed commit of the following:/;
  const listsId = (subject, body, id) => body.some((l) => (/^\s*\* /.test(l) || (GIT_SQUASH.test(subject) && /^ {4}\S/.test(l))) && namesId(l, id));
  const squashEvidence = (subject, body, id) => /\(#\d+\)\s*$/.test(subject) || GIT_SQUASH.test(subject) || listsId(subject, body, id);
  //
  // A commit made on main whose message shows no squash is `weak`: someone working on main,
  // or a squash by hand with an ordinary message. landedAt keeps a weak one only when it
  // holds an entry branch's own work — then it was that squash.
  const squashed = (id, claim) => {
    if (!claim) return [];
    direct ??= new Set(lines(git('log', '-g', '--format=%H%x09%gs', `refs/heads/${base}`))
      .map((l) => l.split('\t')).filter(([, gs]) => /^commit( \((amend|initial)\))?:/.test(gs ?? '')).map(([sha]) => sha));
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
      if (!(namesId(subject, id) || listsId(subject, body, id))) continue;
      const touched = lines(files);
      if (touched.length && touched.every((f) => BOOKKEEPING.some((p) => f === p || f.startsWith(p)))) continue;
      found.push({ sha, at, weak: direct.has(sha) && !squashEvidence(subject, body, id) });
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

  // A local branch on main's first-parent line has no work of its own to look at: it is a
  // fresh cut (a rebuild), or its own commits became main's by a fast-forward. Its reflog
  // tells them apart by the commits it made itself since `from`; a fresh cut's holds none,
  // and neither does a landed branch reused after a recorded rejection, since what it made
  // then came before the rejection. An expired or disabled reflog reads as a build.
  const MADE = /^(commit|cherry-pick|rebase \((pick|reword|edit|squash|fixup|continue|finish)\))/;
  const madeLanded = (ref, claim, landed) => [...new Set(lines(git('log', '-g', '-n', '50', '--format=%H%x09%gs', ref))
    .map((l) => l.split('\t')).filter(([, gs]) => MADE.test(gs ?? '')).map(([sha]) => sha))]
    .filter((r) => !claim || !isAncestor(r, claim.from))
    .some((r) => isAncestor(r, base) || heldBy(landed, r));

  /** When the current claim's branch landed, or null while it is still being built. */
  const landedAt = (id, claim = claimedAt(id)) => {
    merges ??= lines(git('log', '--first-parent', '--merges', '--format=%H%x09%cI%x09%s', base)).map((l) => l.split('\t'));
    // Newest first. Landings since the claim, split at `from`: before it, a rejected one.
    const since = claim ? lines(git('rev-list', '--first-parent', `${claim.sha}..${base}`)) : null;
    const after = claim ? lines(git('rev-list', '--first-parent', `${claim.from}..${base}`)) : null;
    const all = [
      ...merges.filter(([sha, , s]) => names(id).test(mergedBranch(s)) && (!since || since.includes(sha)))
        .map(([sha, at]) => ({ sha, at, weak: false })),
      ...squashed(id, claim),
    ];
    if (since) all.sort((a, b) => since.indexOf(a.sha) - since.indexOf(b.sha));
    // Every branch for the entry, local or remote, not just the first; a leftover is not
    // this build.
    const refs = [...branchesOf(id).map((b) => ({ ref: `refs/heads/${b}`, remote: false })),
      ...remoteBranchesOf(id).map((r) => ({ ref: `refs/remotes/${r}`, remote: true }))]
      .filter(({ ref }) => !leftover(ref, claim))
      .map((r) => ({ ...r, own: !isAncestor(r.ref, base) }));
    const kept = all.filter((L) => !L.weak || refs.some((r) => r.own && noop(L.sha, r.ref)));
    const landed = kept.filter((L) => !after || after.includes(L.sha));
    const rejected = kept.filter((L) => !landed.includes(L));
    if (!landed.length) return null;
    // One whose work has landed is done, and one whose work landed before a rejection is
    // that rejected build, left behind. Any other — kept going after its landing, or cut
    // fresh from main to rebuild a rejected one — is a build in flight.
    for (const { ref, remote, own } of refs) {
      if (own) {
        if (heldBy(landed, ref) || heldBy(rejected, ref)) continue;
        return null;
      }
      // On main: a remote-tracking branch's reflog records fetches, not commits, so it
      // can't say whether it is a fresh cut; only its own work could make it a build.
      if (remote) continue;
      // On main but off its first-parent line: it arrived through a merge, so it landed.
      firstParent ??= new Set(lines(git('rev-list', '--first-parent', base)));
      if (!firstParent.has(git('rev-parse', ref)) || madeLanded(ref, claim, landed)) continue;
      return null;
    }
    return landed[0].at;
  };

  return { branchOf, claimedAt, landedAt };
}
