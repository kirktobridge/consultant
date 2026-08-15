# Git hooks

`npm install` points git at this directory (`core.hooksPath`), so the committed hook
**is** the hook that runs — no copy, no reinstall after an edit.

## Your own hooks still work

`core.hooksPath` redirects git's **entire** hook lookup. It does not merge with
`.git/hooks/` and does not fall back to it, so installing this suite would otherwise
silently kill every personal hook you had — no error, no output, nothing to grep for.

Every hook here ends by calling [`_chain`](_chain), which runs your copy if it exists:

```sh
# your hook, under its usual name plus .local
vim .git/hooks/pre-push.local
chmod +x .git/hooks/pre-push.local
```

The suite's own logic runs first, then yours, and **your exit status is the one git
sees** — a personal hook that rejects still rejects.

## What's covered

Stubs exist for the client-side hooks a working clone actually fires:

`applypatch-msg` · `pre-applypatch` · `post-applypatch` · `pre-commit` ·
`pre-merge-commit` · `prepare-commit-msg` · `commit-msg` · `post-commit` ·
`pre-rebase` · `post-checkout` · `post-merge` · `pre-push` · `post-rewrite` ·
`pre-auto-gc` · `sendemail-validate`

Only `pre-commit` carries suite logic (it runs `npm test`). The rest are pure
pass-throughs.

## What is deliberately *not* covered, and why

Adding the missing name to this directory is a two-line copy of any stub — but read
the reason first, because two of these are actively harmful.

| Not stubbed | Why |
|---|---|
| `push-to-checkout`, `proc-receive` | **Behavior changes when the file merely exists.** Git's manual: *"This hook is to be used to override the default behaviour."* A do-nothing stub tells git the checkout was handled while doing nothing — so a stub here breaks pushes rather than passing them through. |
| `reference-transaction`, `post-index-change` | Fire many times per operation — `reference-transaction` runs on *every* ref update, in three phases. A shell spawn each time is a real tax on a large fetch, paid by everyone to benefit almost nobody. |
| `pre-receive`, `update`, `post-receive`, `post-update` | Server-side. A development clone never invokes them. |
| `fsmonitor-watchman` | Not a normal hook — it is driven by the `core.fsmonitor` config, and a stub could break a watchman setup. |
| `p4-*` | Perforce bridge. |

The distinction that matters: these are a *documented* boundary rather than the silent
one `core.hooksPath` creates by default. If you add `reference-transaction` anyway,
know that you are choosing to pay the spawn.

## Gotchas worth knowing

- **`_chain` must never read stdin.** `pre-push`, `post-rewrite` and others receive
  their payload there; a single `read` would consume the line your hook needs. `exec`
  passes the descriptor over untouched.
- **`exit 0` at the end of `_chain` is load-bearing.** Written the obvious way —
  `[ -x "$LOCAL" ] && exec "$LOCAL"` as the last line — a *failed* test becomes the
  script's exit status, so a clone with no personal hook would have every commit
  rejected.
- **`git commit --no-verify` skips all of this.** The copy that actually holds is
  `npm test` in [CI](../../.github/workflows/test.yml).
