# Findings

Curated, durable conclusions from the experiment track — the "so what". Raw runs live
in [log/](log/) (append-only); open questions live in [backlog/](backlog/); the process
lives in [FRAMEWORK.md](FRAMEWORK.md).

Two numbered series:
- **F#** — findings about the *system*: what we measured and now believe.
- **M#** — method lessons: how we fooled ourselves, and the rule that prevents a
  repeat.

**Written only by /research.**

Every finding carries: **claim → evidence (run link + n) → confidence label**
(`replicated` / `significant` / `directional`) → **scope tag** (see FRAMEWORK
`## Scope`). Retracted claims stay, struck through — the retraction is itself a
finding.

---

## Findings

### F1 — Example finding (delete once you have real ones)
Claim, stated as the thing you now believe, in one sentence.

- **Evidence:** [log/experiments.md Run A](log/experiments.md) — n = 640, share 54.1%,
  95% CI [50.2, 58.0], p = 0.02.
- **Confidence:** `significant` **(default)**
- **So what:** the decision this changed. A finding with no consequence is a log
  entry, not a finding.

---

## Method lessons

These are the expensive ones. Each is written as *the failure first, the rule second* —
keep that shape. A rule with its scar attached gets followed; a decontextualized maxim
gets skipped when it's inconvenient.

### M1 — A single run is not a result
A promising number from one seed evaporated on replication. Small-n and single-seed
tables mislead in *both* directions, and the direction you notice is the one that
confirms what you hoped.

**Rule:** average over seeds and report mean ± std; treat n < ~200 as `directional` at
best. `stats.py` flags this automatically.

### M2 — A bar chosen after seeing results is not a bar
Deciding what counts as success once the numbers are visible is how anything becomes a
win. The bar has to be pre-registered in the backlog entry, and the run has to be
powered to reach it — a bar the planned n cannot clear is a mis-registered bar, which
looks identical to a failed experiment.

**Rule:** START GATE in /research — no bar, no run. `stats.py --power` before flipping
to `active`.

### M3 — An empty tool result is not evidence
Two proxied greps once "proved" no entry was in a given state; nine were. A search that
is misconfigured, proxied, or pointed at the wrong path returns empty *exactly* like a
true negative, and nothing downstream can tell the difference.

**Rule:** before promoting any "none found" to a durable claim, run a **positive
control** — the same tool against a pattern you know matches. Empty control means your
tooling lied, not the repo. This rule is repeated in /ship, /research, and /checkpoint's
write gates because all three write durable claims.

### M4 — Self-relative measurement drifts
A track can improve against its own past for dozens of runs and still be wrong in
absolute terms. Only an outside readout catches that, and the longer you wait to build
one, the more published numbers it invalidates at once.

**Rule:** a new track names its external readout *before* self-relative runs
accumulate. If none exists, building it **is** the first entry of the track.

### M5 — A measurement is bound to the context it was taken in
A constant tuned under one configuration was read as universal and applied to another,
where it was simply wrong. Nothing in the finding said which context it came from,
because at the time there was only one.

**Rule:** every open entry names its `Scope:`, and every finding carries a scope tag.
Enforced by the schema check — see FRAMEWORK `## Scope`.

### M6 — A won result with no owner is inventory
A validated improvement sat undeployed behind an unchanged default, because the
experiment closed cleanly and nothing named who would ship it. Meanwhile the product
entry that would have carried it shipped without it — every gate passed, because
nothing read the pointer aimed at it.

**Rule:** a `won` close names `Deploys as:`, /implement's INBOUND-POINTER GATE reads
those pointers before building, and the schema check fails a `won` entry pointing at an
already-terminal product entry that never recorded shipping it.
