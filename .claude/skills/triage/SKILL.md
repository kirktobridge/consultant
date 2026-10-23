---
name: triage
description: Classify a raw idea (dev notes, conversation, any source) as a product feature, a bug, an assumption, a decision or an experiment. Draft the entry, but write no file. /ship writes the draft. Also groom the backlog (`/triage groom`). Grooming re-checks blockers, sweeps resolved assumptions, flags assumptions that will soon block the queue, and acts on staleness flags. Use for "add this idea", "this is broken", "triage the dev notes", "where does this idea belong", "groom the backlog", "what's unblocked now", or /triage.
---

# Triage — idea intake and classification

This skill turns raw ideas into drafts with the correct class and the correct shape.
This skill **writes no file**. The backlog ([docs/backlog/](../../../docs/backlog/README.md))
has exactly one writer, /ship. The research records have exactly one writer, /research.
Triage writes nothing, so those rules stay true.

The output of this skill has three parts:
1. The classification.
2. The draft.
3. The skill that must write the draft.

In this skill, "the user" is the product owner.

## Sources
- [docs/dev_notes/OPEN_IDEAS.md](../../../docs/dev_notes/OPEN_IDEAS.md) — the user's
  raw list of ideas.
  - This file is **read-only**. The edit-guard enforces this.
  - This file is not a source of truth. An idea in it may already be shipped, deferred,
    or dead.
  - Before you draft, always read the index of every register and search them (steps 1
    and 3). Do not propose again an entry that exists.
- Ideas from a conversation, a code review, or the results of a build.

## The classification test

Ask these questions in this order. Stop at the first "yes".

1. **Is it a yes/no fact about the outside world that an observation can settle?**
   Examples: the behavior of a third party, a constant from a documentation page, a
   limit that nobody hit yet, "users will not do Y".
   - Class: **assumption** (`A-n`, [docs/assumptions/](../../../docs/assumptions/README.md)).
   - The sign: the real content of the idea is *"we currently act as if X is true"*.
     X is mostly outside our control.
   - Nothing ships. The work is to establish a fact.
   - The draft must have a concrete `## How to verify` section that uses an observation.
   - **Name the entries that it blocks.** An assumption with no dependents is trivia.
     An assumption with dependents is a gate.
2. **Is it a choice between real options that the product owner makes?**
   - Class: **decision** (`D-n`, [docs/decisions/](../../../docs/decisions/README.md)).
   - The sign: no observation can settle it, because either answer could be true of
     the world. The missing part is a person who chooses.
   - A preference is a decision, not an assumption.
   - The draft must have at least two named `## Options`. It must also have
     `waiting_on:`, which names the IDs it waits on, or `user`, or both.
   - If the user can answer immediately, ask the user. Then draft the decision as
     decided.
   - Never spike an open decision. If it waits on the user, ask the user. If it waits
     on a fact, that fact is an assumption, and the assumption follows its own route.
3. **Is it a question that data answers — a quantity, a rate, "how often does X
   happen"?**
   - Class: **experiment** (`X#`, [docs/research/experiments/](../../../docs/research/experiments/README.md)).
   - This is a measurement. It is **not** an assumption, because no single observation
     settles a rate. It is not a decision, because nobody chooses it.
   - **First, check that `docs/research/` exists.** If it does not, the project did not
     adopt the research track. Tell the user this, and draft no experiment. Do not file
     the question as an assumption or a decision. If a decision waits on the number,
     draft the decision, and name the measurement in its `## Context` section.
   - Give it a **kind**. The framework's
     [three kinds](../../../docs/research/README.md#the-three-kinds) say what each kind
     owes:
     - `measure`: it estimates a quantity. "How often does X happen" is a measure.
     - `test`: it compares arms to gate a change. "Is B better than A?" is a test.
     - `probe`: it explores. "Can this signal be seen at all?" is a probe.
   - **Name what you would count.** A `measure` names the quantity and how it is
     observed. A `test` also names the two arms and the metric that decides between
     them. If you cannot name these, it is not an experiment. It is a wish (see below).
   - Use the template in the experiments README.
   - A `test`, or a measure that a decision waits on, needs a decision. That decision
     must have its `## Decision rule` before the run. If the decision does not exist,
     draft it too (question 2), with `waiting_on:` naming the `X#`. Put the decision in
     the experiment's `feeds:`.
   - Destination: **/research** (Phase P) writes the experiment. /ship writes the
     decision.
4. **Is it broken — something that works, or was meant to work, and someone saw it
   fail?**
   - Class: **bug** (`B#`, [docs/bugs/](../../../docs/bugs/README.md)).
   - The sign: a person *saw* it fail. That person can say what they did and what
     happened.
   - Use the shape that the bugs README documents:
     - A header: title, `status: open`, `severity`, `reported`, depends_on.
     - A body: `## Repro`. `## Expected` and `## Notes` are optional.
   - Keep the repro steps of the reporter **exactly as the reporter gave them**. Do not
     change them into what you think happened.
   - If the reporter did not give a severity, ask for one: `critical`, `major` or
     `minor`.
   - **Do not write a `Value`.** "It should work" is all the value a bug has. A payoff
     line that you invent is the decoration that this class exists to stop.
   - A suspicion is not a bug if nobody saw the failure. A suspicion is a test or a
     /verify run (see below).
5. **If all answers are "no", it is something to build.**
   - Class: **product feature**.
   - Use the product shape that [docs/backlog/README.md](../../../docs/backlog/README.md)
     documents:
     - A header: title, `status: proposed`, epic, drafted, **plan**, depends_on.
     - A body: Value, Scope, **Accept**, and `## Notes` with the line
       `Plan: yes|no — reason`.
   - Decide **plan** now, not at build time. `yes` means /implement stops for the
     user's approval of a written plan before any code. Say `yes` when the build
     changes a schema or a register's format, touches a file several skills depend on,
     spans several skills, or has milestones. Otherwise `no`. A wrong `no` costs
     little: /implement still plans a build that turns out bigger.
   - Destination: a new `docs/backlog/P#.md` in the correct epic. **/ship** (Intake)
     writes it.

**"Does our own code work?" is never an entry.** That question is the `Accept` of a
feature, a test, or a /verify run. If you file it as an assumption, you park a question
that the test suite can answer today. When a person *saw* the code fail, it is not a
question. It is a bug (question 4).

**Split an idea that mixes classes.**
- A feature that rests on an unchecked assumption becomes two drafts: an `A-n`, and a
  product draft whose `depends_on:` names the `A-n`.
- This pair is the main pattern of the system. The pair stops a feature from shipping on
  a premise that nobody checked.
- A feature that cannot be built until someone makes a choice splits the same way: a
  `D-n`, and a feature whose `depends_on:` names the `D-n`.

## Drafting `Accept:` — what "right" means, before the build

Every open product entry has an **`Accept`** field: 2–4 bullets. Each bullet is one
thing that a person can watch pass or fail. The schema check counts the bullets. If a
draft has no bullets, you cannot file it.

These bullets are the **words of the product owner**. They do not repeat Scope.
- Scope says what the build makes.
- Accept says how you would know that the build is correct.
- These two are different more frequently than they appear to be.

Ask the user for the criteria in the user's own terms. Write down what the user tells
you. If the user did not give criteria, propose criteria and let the user correct them.
That correction is the purpose of the field.

A criterion is **observable** when it gives the same verdict to any person who reads it,
including a person who knows nothing about the diff. Use these two cheap tests:

- **Name the check, not the quality.** For "the field is required", ask: *what would you
  run?* A good answer: "the check rejects an entry that has no value in the field, and
  the message names the field."
- **Can it fail?** If no realistic build can fail the criterion, it is not a criterion.
  "It works", "the user is happy" and "the code is clean" can never be false. This is
  why the count check exists.

This field can degrade into **ceremony**: Value cut into a bullet list that is present,
counted, and worthless. If the honest answer is "the criteria only repeat Scope", tell
the user this. Ask the user what they would actually check. Do not fill the field only
to satisfy the checker.

**The boundary that people frequently get wrong:**
- "We should find out whether X" is usually an **assumption**, not a feature, if X is a
  yes/no fact about the world.
- "How often does X happen" is a measurement: an experiment of kind `measure`
  (question 3).
- "Should we do X" is a decision.
- If you cannot name what would settle it, it is a wish, not an assumption or an
  experiment. For an assumption, that is an observation (its `How to verify`). For an
  experiment, it is a quantity, or for a `test`, two arms and a metric. Tell the user
  this. Do not file it. Ask what they would actually count.

**Blocked, not rejected:**
- If an idea is a good feature but it rests on an open assumption or an open decision,
  draft it. Mark it `depends_on: A-n` or `depends_on: D-n`. Do not reject it.
- The entry can correctly stay in the pool. The schema check permits this on purpose.
- The schema check forbids two things while the dependency is open: the entry in the
  queue, and the entry at `in-progress`.
- Say this in your output, so that the user knows that the entry exists and where it can
  stay.

## Steps
1. **Read the index first, before you classify:** `node scripts/titles.mjs`. It prints
   every entry in every register: ID, status and title. Read all of it.
   - Compare the idea with each title **by meaning, not by keyword**. A reworded idea
     shares none of the first author's words, and a keyword search passes it as new.
   - Name the entries closest to the idea, or say that none is close.
   - If one of them is the same idea, the output is "already tracked as `<ID>` —
     update it via its owner". Stop. Do not classify it again, and do not write a
     duplicate draft.
   - Say the match's status with it. A `shipped` or `fixed` match is already done. An
     `abandoned`, `deferred`, `wontfix` or `superseded` one was dropped on purpose:
     tell the user, and let them say whether the idea deserves a fresh entry now.
   - **Exit 2 means that you learned nothing.** The script prints no list when it
     cannot read a register, because a shorter list would look complete. Fix what it
     names and run it again.
2. Write the idea again in one sentence. Do the classification test where the user can
   see it.
3. Search for an existing entry a second way, by keyword:
   ```
   node scripts/grep-checked.mjs -i --control '^status:' '<keyword>' \
     docs/backlog docs/bugs docs/assumptions docs/decisions docs/research/experiments
   ```
   - This finds an entry whose body mentions the idea when its title does not. If an
     entry exists, the output is the same: "already tracked as `<ID>`". Do not write a
     duplicate draft.
   - Use this checked search, not a bare grep. A false negative here makes a duplicate
     entry. A proxied search or a search of the wrong path gives an empty result that
     looks exactly like a true negative (LESSONS [L1](../../../docs/LESSONS.md)).
   - **Exit 2 means that you learned nothing.** Run the search again before you decide
     that the idea is new.
4. Draft the entry in the template of its destination. Include where it goes:
   - A feature: its epic, and its plan (`yes` or `no`, with the reason).
   - A bug: its severity.
   - An assumption or a decision: nothing. Those registers have no order.
   - An experiment: its kind.
5. Show the draft and its destination to the user. If the user approves, give the draft
   to **/ship** to write. An experiment draft goes to **/research**.
   - An assumption draft also goes to /ship as the writer. But the assumptions register
     has no single writer. It has only an enforced shape.
   - A decision has one writer: /ship.

## Groom mode (`/triage groom`, "groom the backlog")

The schema check *detects* rot, and then it waits for someone to act. This mode is that
someone. Groom mode reads and proposes. It writes nothing, which is the same contract as
the rest of this skill. Run it periodically. Always run it after an assumption resolves
or after the user takes a decision.

**Start from `node scripts/groom.mjs`.** It computes the five groups from the docs and
git, each item with its suggested action, and writes nothing. Exit 0 means there is
nothing to groom, and exit 1 means it found items. **Exit 2 means it never ran**: fix
what it names and run it again. Don't fill the gap by guessing. The script decides who
is in each group. The steps below are what it cannot decide.

1. **Unblocked.** An entry is unblocked when every dependency is met now, and at least
   one of them was met after the entry was drafted.
   - This is the most valuable output of the groom, because nothing else notices it.
   - Read each entry again against the code. Then say if it is still accurate, if it
     needs rescoping, or if it is void.
2. **Newly void.** These are the dependents of a `refuted` assumption. This is the
   urgent case.
   - The entries that rest on a refuted assumption are not only unblocked. They can be
     **void or wrong**.
   - Look again at any entry that already shipped on that assumption, too.
3. **About to block.** An `open` assumption or decision that holds back a queued entry
   will soon stop work.
   - The script reads only the queue. Also look at the entries just behind the queue,
     for example an entry the user says goes in next.
   - An assumption that blocks only entries deep in the pool costs nothing yet.
   - **This finding starts the spike decision below.** Nothing else in the loop looks
     for it. The schema check fires only after the entry is *already* in the queue or
     claimed.
4. **Stale.** An entry is stale when it was drafted before a dependency or an ad-hoc
   merge that names it landed, or when it still names a moved or superseded ID.
   - For each one, read the entry again and compare it against the code.
   - Report one of these results:
     - *Still accurate*: bump `drafted:`. Bump it only after a real re-read. Never bump
       it to silence the check.
     - *Needs rescoping*: say how.
     - *Void*: say why.
   - An entry that names a moved or superseded ID gets re-pointed via /ship.
5. **Abandoned.** This is an `in-progress` entry that no branch names.
   - To change it back to `proposed` is a /ship flip. Do it only when the user says so.
6. **Decisions that wait on the user** are the user's own queue. The session audit
   lists them (`npm run audit`, "Waiting on the user"). Report each one with the
   entries that it holds back.
7. **Propose. Never apply a change silently.**
   - Demotion and deletion are the user's decisions.
   - Ranking is not the user's decision. The ranking rule of the queue
     ([docs/backlog/README.md](../../../docs/backlog/README.md#the-queue)) decides it.
     If a groom finds the queue in the wrong order, say so, and give the correction to
     /ship.
   - For all other changes, say what you would change and why. Let the user decide.
   - Name each priority that events made out of date. That is usually why the user
     asked for a groom.

The output is a short report with five groups: unblocked, newly void, about to block,
stale, and abandoned. Give each item the one action that it needs. Write nothing until
the user chooses.

## The spike decision (when an assumption will soon block real work)

An assumption is a unit of **doubt**, not a unit of work. By design, it has no owner.
The person who meets it settles it, at the time when it actually costs something. So the
question is never "who must check this?". The question is **"does this assumption block
the queue now?"**

```
An open assumption blocks something
  ├─ cheap to settle (one API call, one probe, one grep)?
  │      → Settle it now. Write its Resolution. Then sweep what it unblocked.
  ├─ expensive, and its dependents are in the queue or entering the queue?
  │      → Promote it. Draft a spike P# (below). It blocks real work now.
  └─ expensive, and its dependents are only deep in the pool?
         → Leave it open. It is correctly parked. In practice it blocks nothing.
           A spike now spends real effort on a hypothetical.
```

The middle branch is the only route to a spike. This limit is intentional. It stops the
assumptions register from becoming a source of speculative work. An assumption is worth
the cost to settle exactly when it will soon stop you.

**Shape of a spike draft:** an ordinary product entry (a `plan:` line included), with
two specific parts.
- `## Value` names the entries that the spike unblocks.
  - This is an honest way to fill the required Value field. To unblock queued work *is*
    value to the user, one step removed.
  - Do not invent a user story for a probe.
- `resolves: A-n` in the header is the back-pointer to the assumption.
  - This is a structured field, not a sentence. Nothing can enforce an obligation that
    is hidden in prose (LESSONS [L2](../../../docs/LESSONS.md)).
  - The schema check pairs the spike and the assumption. The check fails if the spike
    ships and nobody wrote the answer back into the assumption.

Say clearly which branch you took and why. This example is a complete and correct groom
output: "A-3 is expensive, but only P7 depends on it. P7 is not near the queue, so A-3
stays parked."

## Not this skill
- To write the entry → **/ship** (Intake). To write an experiment → **/research**.
- To decide *when* to build it → /ship ranks the queue with the rule in
  [docs/backlog/README.md](../../../docs/backlog/README.md#the-queue).
- To settle an assumption → the person who meets the block. If the work needs a build,
  it is a spike P#. A spike goes through **/implement** like all other entries.
