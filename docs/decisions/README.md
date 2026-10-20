# Decisions

The register of **choices the product owner makes**: open ones, with the options and
what they are waiting on, and decided ones, with why and what would reopen them. One
file per entry (`D-n.md`) in this directory.

Not features (those are [../backlog/](../backlog/README.md)), and not facts we are
assuming about the outside world (those are [../assumptions/](../assumptions/README.md)).
Evidence informs a decision; it does not make it. An assumption is settled by
observation, by whoever runs into it; a decision is settled by the product owner,
and by no one else.

**When to file one:** a genuine choice between two or more real options that is the
product owner's to make, or a choice that was hard-won and is likely to be
relitigated by a later session. Ordinary design choices stay in the code and the
commit messages.

**Written by:** /triage drafts, /ship holds the pen (the product owner decides; /ship
records). The *shape* is enforced by the schema check.

---

## The rule

Blocking is graded exactly as for assumptions
([../assumptions/](../assumptions/README.md#the-rule-that-makes-it-worth-maintaining)):
an entry whose `depends_on:` names an `open` decision may sit `proposed` in the pool,
but may not be in the queue or claimed. To unblock it, decide. There is deliberately
no "blocks" field: it would be an inventory nobody maintains; `/triage groom` derives
it from the `depends_on:` headers.

**What only you can unblock:** every open decision whose `waiting_on:` includes `user`.
The session-start audit lists them; to see them yourself,
`grep -l "^waiting_on:.*user" docs/decisions/D-*.md`.

---

## Status vocab

Status vocab: `open` / `decided` / `superseded`.

| status | meaning |
|--------|---------|
| `open` | not chosen yet; blocks what depends on it |
| `decided` | chosen; `decided:` says when, `## Decided` what, `leads_to:` what carries it forward |
| `superseded` | replaced by a later decision, named in `superseded_by:` |

---

## Entry template

```markdown
---
id: D-1
title: <the choice, as a question>
status: open
raised: YYYY-MM-DD
waiting_on: user
---

## Options

(a) … (b) … — at least two real ones.

## Context

what forced the question, and what rests on it.
```

A decision that waits on an experiment (an `X#` in `waiting_on:`, from
[../research/](../research/README.md)) also carries, before that experiment runs:

```markdown
## Decision rule

the metric, the threshold, and what each side of it means.
```

The experiment names the decision back in its `feeds:`. The schema check holds both
while they are open: the rule exists, and the two sides name each other. A rule written
after the numbers fits the numbers.

On decide, flip `status: decided`, add `decided: YYYY-MM-DD` and `leads_to:` to the
header, and add the sections:

```markdown
## Decided

the choice, in one line.

## Why

the reason.

## Reopen if

what would make this worth revisiting.
```

The header is strict, as in the backlog. The keys are `id` (must match the file
name), `title`, `status`, `raised`, `waiting_on` (required while open: IDs it waits on,
an experiment's `X#` among them, and/or `user`), `decided` (the date it was taken), `leads_to` (the `P#` that carries it
forward, or `—` for no change) and `superseded_by` (the `D-n` that replaced it).
Required sections: `Options` always; `Decision rule` while open and waiting on an
`X#`; `Decided`, `Why` and `Reopen if` once decided.

`leads_to:` is how a decision's consequence gets an owner (LESSONS
[L2](../LESSONS.md)). Because it is a header field, the schema check reads the status
of what it names. A shipped `P#` is the consequence landing. An `abandoned` or
`deferred` one means the decision's consequence was dropped, and the check fails
until the decision is superseded or `leads_to:` is repointed.
