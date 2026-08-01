# Experiment configs

One JSON file per experiment run: `<backlog-id>.json`.

An experiment's setup lives **here, not in the harness source**. The harness's built-in
tables are standing baselines; editing them for one run silently changes what every
future run is compared against, and makes the logged result irreproducible.

Commit the config alongside its log record. Together they're what makes a number in
FINDINGS checkable a year later.

```json
{
  "title": "AE1 — does X beat the baseline",
  "arms": [
    { "name": "baseline",  "strategy": "current", "options": {} },
    { "name": "candidate", "strategy": "current", "options": { "x": true } }
  ]
}
```

Raw sweep outputs (`*.result`) belong in a tracked in-repo directory too — never `/tmp`
or a dotted scratch dir. They're the evidence for every number the sweep produces, and
they're cheap. See FRAMEWORK's "Commit the shards."
