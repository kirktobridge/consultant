# Porting this suite to your project

Everything here is generic except a handful of clearly-marked spots. This guide is the
list of those spots, in the order worth doing them, plus the judgement calls where
copying blindly will hurt.

Search the tree for `PORTING` to find every marked block:

```bash
grep -rn "PORTING" --include=*.md --include=*.mjs --include=*.py .
```

---

## Step 1 — decide whether you need both tracks

The system's spine is one question, asked by /triage of every incoming idea:

> **Can this state a pre-registered success criterion — a metric plus a bar?**

Yes → the **measurable track** (/research, FRAMEWORK, log, FINDINGS). No → the
**build track** (/implement, /verify). Both end at /land → /ship → /checkpoint.

**Keep both** if your project makes claims that could be wrong in a way a test won't
catch — performance work, model/prompt quality, ranking, pricing, anything tuned. The
measurable track is what stops "it feels faster" from becoming a committed default.

**Drop the measurable track** if you genuinely ship only features. Then: delete
`docs/research/`, `.claude/skills/research/`, `scripts/doc-debt-check.mjs`, the
PostToolUse hook, and the research half of `backlog-schema-check.mjs`. Simplify
/triage to intake-and-draft. **Don't half-keep it** — a research backlog nobody runs is
worse than none, because the next session reads it as live.

## Step 2 — the human-owned files (do this first, it's the cheapest win)

Edit [.claude/edit-blocklist](.claude/edit-blocklist): list the docs whose authority is
yours — spec, requirements, raw idea dumps. The hook makes "human-owned" real rather
than aspirational; a skill told not to edit a file mostly complies, a hook always does.

Note the blocklist matches on **basename as well as path**, so a bare `edit-blocklist`
pattern blocks any file of that name anywhere on disk — including in other checkouts.
Prefer path-qualified patterns. (This bit me while extracting this very template.)

Verify the guard is live:

```bash
echo '{"tool_input":{"file_path":"docs/SPEC.md"}}' | python3 .claude/edit-guard.py; echo "exit=$? (expect 2)"
```

## Step 3 — name your things

| Placeholder | Means | Where |
|---|---|---|
| `P#` | product backlog IDs | BACKLOG.md, all skills, schema check |
| `AE#` / `AD#` | research IDs, one namespace per domain | research backlog, schema check |
| `OD-n` | open decisions (unverified assumptions) | OPEN_DECISIONS.md, schema check |
| `F#` / `M#` | findings / method lessons | FINDINGS.md |
| `docs/SPEC.md` | your human-owned source of truth | blocklist, /ship, /implement |
| `main` | integration branch | /land, /implement, /checkpoint |

Keep namespaces **globally unique across backlogs** — the schema check enforces it,
and the cross-track pointers (`Deploys as: P42`) are unparseable without it.

## Step 3b — seed the open-decisions register

[docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md) is the cheapest high-value thing to
fill in, and it works on day one — unlike the backlogs, you already know its contents.

Spend twenty minutes listing what your project currently *assumes* and nobody has
checked: a third-party API's real rate limit or error semantics, a constant someone
took from a blog post, a scaling limit never actually hit, "users won't do X". Each
becomes an `OD-n` with a `How to verify:` line.

Two things make it more than a wiki page:
- an `open` OD **blocks** any entry whose `Depends on:` names it — enforced by the
  schema check and by /implement's DEPENDS GATE;
- `/triage groom` sweeps resolutions, so verifying one OD surfaces everything it
  unblocked. Nothing else in the loop notices.

Keep `refuted` entries as `refuted`. Rewriting one into a `verified` entry describing
the new truth destroys the most useful signal in the file — that we believed something
false, and for how long, which is what calibrates trust in everything still `open`.

If your project genuinely has no unverified assumptions, you haven't looked yet.

## Step 4 — the harness (measurable track only)

In [docs/research/FRAMEWORK.md](docs/research/FRAMEWORK.md), fill the **Harnesses**
table: one row per measurable domain, each with a runnable command. The table earns its
keep when a reader goes from "I want to measure X" to a command without asking anyone.

Then in [.claude/skills/research/SKILL.md](.claude/skills/research/SKILL.md), replace
the harness line in the folder map and the Phase-1 run command.

`stats.py` is **portable as-is** — Wilson intervals, one-sided z, and power analysis
don't care what you're measuring. Its "WINS/GAMES" framing is just a two-arm
comparison; for a plain rate, pass count and total and set `--null` to your baseline.

## Step 5 — the launch recipe (/verify)

[.claude/skills/verify/SKILL.md](.claude/skills/verify/SKILL.md) has a section marked
**REPLACE THIS ENTIRE SECTION**. It is the most project-specific file in the suite and
the one where vagueness costs most: a verify step that says "start the app and look at
it" produces verification theatre.

Be specific about:
- the exact start command **with a pinned port** — a stale server on the expected port
  serves old code and passes, which is the most common way a verify run lies;
- a readiness probe, not a sleep;
- where logs go, and that you read them at the end;
- flags that remove animation/think-time so a script can drive the app;
- two or three canonical flows with real selectors.

## Step 6 — wire the checks into CI

```jsonc
// package.json
"scripts": {
  "check:docs": "node scripts/backlog-schema-check.mjs && node scripts/doc-debt-check.mjs --all",
  "test": "<your tests> && npm run check:docs"
}
```

The PostToolUse hook already runs the doc-debt check in-session, the moment an edit
touches a backlog doc — feeding violations back while the context to fix them is still
live. CI is the durability half, for edits made outside a session.

## Step 7 — adapt the scope axis

FRAMEWORK's `## Scope` section encodes "a measurement is bound to the context it was
taken in." Replace the vocabulary with **your** axis of variation — platforms, tenants,
datasets, model versions, plan tiers. If you truly have one context today, keep
`default` / `mechanism`; the rule pays for itself the day a second appears, which is
precisely when nobody remembers which numbers were measured where.

Set `SCOPE_TAGGED_FROM` in the schema check to the first finding the rule binds from.
Grandfathering earlier ones is correct and honest — the rule usually exists *because*
they didn't say.

---

## What NOT to change

These look arbitrary and are not. Each was paid for.

**The `Deploys as:` leading marker.** The schema check exempts a `won` entry only when
its `Deploys as:` line *begins* with `shipped`/`landed`/`deployed`. Written the obvious
way first — keyword anywhere in the block — the original check exempted the very entry
it was built to catch, because that block called some *other* constant "already the
shipped value". A keyword in a paragraph cannot express "this result landed"; a marker
in a fixed position can.

**Collected, not fail-fast.** Checks that can produce several independent loose ends
gather them all. Failing on the first hit hides the rest — and in the original, the case
a check existed for was masked by an unrelated earlier hit.

**Doc flips on main only.** Tempting to let a branch flip its own status. Don't: two
branches touching `## Next up` conflict every time, and a claim made on a branch is
invisible to other sessions until it merges — exactly when it was supposed to prevent
duplicate work.

**The append-only log.** A wrong run stays, annotated. The retraction is the finding;
deleting it destroys the evidence that the method needed fixing.

**Positive controls on negative claims.** Repeated in /ship, /research, and /checkpoint
because all three write durable claims. "grep found none" and "the tool is
misconfigured" are indistinguishable from the output alone. In the original project, two
proxied greps "proved" no entry was in a given state; nine were.

**Dating open entries.** Cheap, and it's what makes /implement's premise gate
*affordable*: re-verify the entries older than their dependencies rather than all of
them.

**The blocked-on-an-open-OD rule.** It will feel too strict the first time it stops
you. That's the rule working: an assumption nobody checked is exactly the thing you
most want to discover *before* building on it, not after. Verify the OD (usually one
API call or one small experiment) or rescope the entry. Deleting the check because it
blocked something is how the register becomes decoration.

## Evolving the schema

The format lives in three places — the doc that documents it, the checker that enforces
it, and every skill's grep that relies on it. **Change all three in the same commit.**

The failure mode to refuse: loosening the check so a malformed entry passes. That
inverts the tool — the thing that catches drift becomes the thing that ratifies it. A
red check is either a bad entry (fix the entry) or a real convention change (change all
three). It is never "the check is being annoying."

---

## Adapting to a different topology

**Solo, no parallel sessions?** Keep single-writer (it prevents doc drift regardless);
you can relax flips-on-main and skip HANDOFF's per-branch sectioning.

**Trunk-based, no feature branches?** /land collapses into "run the suite, then /ship".
Keep the claim flip — it still prevents two sessions racing the same entry.

**Team of humans + agents?** The backlogs are already the coordination surface. Consider
making `Drafted:` staleness a hard CI failure rather than a flag.

**No app to drive?** /verify still applies — "drive the real thing" means running the
CLI, hitting the endpoint, importing the built package. What it forbids is substituting
"the suite is green" for observation, and that's domain-independent.
