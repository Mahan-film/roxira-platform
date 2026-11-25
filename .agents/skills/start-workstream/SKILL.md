---
name: start-workstream
description: Start work on a Roxira workstream (W<n>). Use at the start of any workstream session, or when the owner says "start W6", "pick up W7" and so on.
---

1. Run `git fetch` and work from `origin/main` in your own worktree. Claim the task first: `bash scripts/dev/whoswhat.sh`, then `bash scripts/dev/claim.sh <n>`.
2. Read `docs/agents/LESSONS.md`, then `docs/STATE.md`, then `docs/STRATEGY.md` sections 1, 4 and 5 (the row for this workstream) and any doc the row links to.
3. Confirm the scope to the owner in one or two sentences. Stay inside that row. Anything else you notice goes to the hub as a note.
4. Hard rules: never run `pytest` over `src/` or the repo root; secrets come from the environment only; never use `--no-verify`; any change to the production server needs the owner's yes first.
5. When done: open a PR, update only this workstream's row in `docs/STRATEGY.md`, and tell the owner what changed, what is verified, and what still needs their decision.
