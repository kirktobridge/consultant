---
name: orchestrate
description: Hand the next N ready backlog entries to parallel background subagents, one /implement each — pick them from the queue, dispatch them, relay each one's questions to the product owner, and collect their landing reports. Use for "handle the next 3", "build the next two in parallel", "orchestrate", or /orchestrate N.
---

# Orchestrate — the next N entries, built in parallel

One request builds several entries at once. You pick, dispatch, relay questions and
collect. The subagents do the building, and P15's machinery (the worktrees, the land
lock) does all the git work. **You type no git command**, and you write no code: every
change reaches main through a subagent's /implement and /land. Your one write to main
is /ship's acceptance flip, on the owner's word and under the land lock (step 4).

`N` = how many entries to build. If the user gave none, ask; don't default.

Run this from the **main checkout**, not a worktree: each subagent starts where you
are, and /implement claims on main from there before it cuts its own worktree.

## Steps

### 1. Pick

`node scripts/next.mjs --count <N>`. It walks
[QUEUE.md](../../../docs/backlog/QUEUE.md) in order, reading main, and picks up to N
entries that are dependency-ready. It skips a claimed entry, and any entry with an
unmet dependency, including one picked earlier in the same batch: that one is not
shipped yet. P23's graph decides this, not you.

- Tell the user what it **picked**, and each **skipped** entry with the reason it
  printed, before you dispatch anything. Fewer picked than asked is a normal result:
  say so, don't go looking outside the queue to make up the number.
- A `note:` line names a ready bug. A batch takes from the queue only; tell the user
  it is there, for /implement on its own.
- Exit 1: nothing is ready. Say so and stop. Exit 2: it never ran; fix what it names.
- Overlap is not a reason to drop a pick. Two entries touching one file cost a rebase
  and a resolution at landing (P15), not a broken main. Don't predict footprints: A-8
  showed they can't be predicted from the entry.

### 2. Dispatch

One **background** subagent per picked entry, all in the same turn: Agent with
`subagent_type: general-purpose`, `run_in_background: true`, and **no `isolation`**.
A subagent can't use EnterWorktree (A-12), so /implement has it work the worktree it
cuts by `cd <path> && …`; an `isolation: "worktree"` agent would also be refused git
aimed at the main checkout, where claims and landings happen. Keep each agent's ID
against its entry.

The prompt, with `<ID>` filled in:

> Invoke the Skill tool with skill `implement` and args `<ID>`, and follow it to the
> end, landing included. You are a subagent: work your worktree by `cd`, as the skill
> says. Other subagents share your main checkout, so hold the `claim:<ID>` lock until
> `node scripts/worktree.mjs start <ID>` has returned, then release it. At the review
> point, give /code-review your branch as its target: a forked review runs where this
> session started, not in your worktree. The product owner is not reachable from here. When a step needs their word (a
> rescope, a milestone choice, a stale premise, an open decision, `land.mjs` exit 4,
> anything the skill says to ask about), do not guess and do not skip it. Stop, and
> make your final answer start with `QUESTION <ID>:`, then the question, the options
> you see, and whether you hold the land lock (`node scripts/land.mjs lock status`).
> You will be resumed with the answer. When the build is done, your final answer is
> the landing report /land gave you, per-criterion verdicts included.

Invoke the skill, never paste its text: a subagent reading a SKILL.md as a user turn
is A-4, which is open.

Why the claim lock is held through `worktree.mjs start`: start refuses a dirty main
checkout, and with several subagents in one checkout, another's claim or landing may
be mid-write the moment yours releases. Everything that writes the main checkout runs
under the lock, so holding it through start is what keeps the start from seeing that.

### 3. Relay questions

A subagent's hand-back that starts `QUESTION <ID>:` is waiting on the owner.

- Ask the user, **naming the entry**: what it needs, the options, and your
  recommendation if you have one. Ask one entry's question at a time, unless they
  are independent and short.
- **The land lock goes first.** If the asker holds the land lock, ask that question
  before any other and say why: every other landing waits on it.
- Resume that subagent with the user's answer: SendMessage to its agent ID, the
  answer in the user's words. Its context survives the stop (probed for P17: a
  resumed subagent still had what it chose before stopping).
- The other subagents keep working meanwhile. Don't pause them, and don't hold their
  reports back while a question is open.
- Answer nothing on the owner's behalf. A question you think you can settle is still
  theirs to settle. You may add your view, as a recommendation.

### 4. Collect

Each subagent's final report is its entry's landing report. As each arrives:

- Relay it: the entry, what landed, and every `Accept:` criterion with its verdict
  exactly as /land gave it. Don't round a *not observed* up, and don't merge reports.
- Then one **"ship it?"** for that entry. On the user's word, run /ship for that
  entry (`shipped` for a feature, `fixed` for a bug); a pass /ship makes on main
  takes the land lock first, as a claim does (`node scripts/land.mjs lock take
  ship:<ID> --wait 600`, then `node scripts/land.mjs lock release ship:<ID>`), because the subagents may be landing in the same checkout. No word,
  no flip: the entry waits `in-progress` for acceptance, as after any /land.
- A subagent that stops with neither a question nor a landing report (an error, a red
  suite after a conflict, a lock it couldn't get) is reported as such, with what it
  said. Don't retry it on your own; ask the user.

When every subagent has reported, close with one line per entry: landed and accepted,
landed and awaiting acceptance, or stopped (and why).

## Not this skill
- Building one entry → **/implement**.
- Choosing what goes in the queue → the generator, which **/ship** runs; this skill
  only reads it.
- Accepting on the owner's behalf → never. `shipped` is their word (see /ship).
