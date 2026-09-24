---
name: start-workstream
description: Start work on a Roxira workstream (W<n>). Use at the beginning of any workstream chat, or when the user says "start W6", "pick up W7", etc.
---

1. Sync: `git fetch` then work from `origin/main` in a worktree (a daemon pushes to `main`; a local clone is often far behind).
2. Read `docs/STRATEGY.md` sections 1, 4, 5 (the row for this workstream and the priority order) and any doc the row links to. Do not read the rest unless needed.
3. Confirm the scope in one or two sentences to the owner, in Persian. Stay inside that row; anything else you notice goes back to the hub chat as a note, not into this branch.
4. Hard rules: never run `pytest` over `src/` or the repo root (see `src/ci_quarantine.py`); secrets come from the environment only; anything that changes the production server needs the owner's yes first.
5. When done: open a PR, update only this workstream's status row in `docs/STRATEGY.md`, and summarize for the owner in Persian (what changed, what is verified, what still needs their decision).
