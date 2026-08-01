# Experiment log — append-only

Raw run records. **Never rewritten.** A wrong or retracted run stays, annotated — the
retraction is the lesson. New runs go at the **bottom**.

Synthesis does not belong here: conclusions go to [FINDINGS.md](../FINDINGS.md). This
file is the lab notebook, not the paper.

**Read discipline:** this file grows forever. Orient with `tail -40` for the last run
id and `grep` to cite a prior run — never read it whole. /research enforces this.

**Written only by /research** (appends only).

---

### Run A — Example run (delete once you have real ones)
Does <the AE1 question>? — backlog AE1.
**Measured under:** <commit sha or system-state shorthand — so a later step-change can
find what it stales>

| config | trials | metric | 95% CI | p |
|---|---|---|---|---|
| baseline | 320 | 45.9% | [40.5, 51.4] | — |
| candidate | 320 | 54.1% | [48.6, 59.5] | 0.02 |

**Read:** what the numbers say, noise-aware. Name what could still be the harness
rather than the world.
**Decision:** adopt / no-win / abandoned / needs-more-trials + why.
