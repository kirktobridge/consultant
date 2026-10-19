# Bugs

What's **broken**: something that worked, or was meant to, and doesn't. One file per
bug (`B#.md`) in this directory. Its siblings are [../backlog/](../backlog/README.md)
(what we intend to build), [../assumptions/](../assumptions/README.md) (what we're
assuming) and [../decisions/](../decisions/README.md) (what the product owner chooses).

A bug is kept apart from the backlog because its shape is different: it is *reported*,
not pitched. What it needs is the reporter's repro steps and how bad it is, not a
`Value` line someone has to invent for "this is broken". An empty register is the
healthy state.

Status vocab: `open` / `in-progress` (being fixed this session/branch) / `fixed` /
`wontfix`.

Severity vocab: `critical` / `major` / `minor`.

**Written only by /ship**, on main only, from a /triage draft. See `.claude/GUIDE.md`.

---

## Entry shape

A **header** the tools read, then a **body** only people read. The schema check
(`npm run check:docs`) holds both.

```markdown
---
id: B3
title: The queue check passes on an empty queue
status: open
severity: major
reported: YYYY-MM-DD
depends_on: —
---

## Repro

1. the reporter's steps, as they gave them.
2. what happened.

## Expected

what should have happened.

## Notes

anything else.
```

| key | holds |
|---|---|
| `id` | `B#` — must match the file name |
| `title` | one line |
| `status` | a word from the status vocab above |
| `severity` | a word from the severity vocab above; required while open |
| `reported` | `YYYY-MM-DD` — when it was reported, or last re-confirmed; required while open |
| `depends_on` | comma-separated `P#` / `B#` / `A-n` / `D-n`, or `—` |

The header is strict, as in the backlog: an unknown key, a line that isn't
`key: value`, or a value of the wrong type fails the check with the file and line.

**The body** is `## ` sections. Required: `Repro` while open — the reporter's steps,
kept as they gave them. `Value` is **refused**: a bug's value can only be invented, so
the check fails a bug that carries one. `Expected` and `Notes` are free.

**Severity:** `critical` — the loop or the product can't be used, or it quietly
produces wrong results; `major` — a real flow is broken but there's a way around it;
`minor` — cosmetic, or an edge nobody is hitting.

A bug resting on an open `A-n` or `D-n` may sit `open`, but may not go `in-progress`;
the schema check enforces the line, as it does for the backlog.
