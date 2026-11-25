---
name: handoff
description: Save this session's state so a fresh session (any agent, any model) can continue. Use when the context is about 60% full, a workstream finishes, before switching agents, or when the owner says "handoff" or "new chat".
---

1. Run `git fetch` and work in your own worktree on a branch from `origin/main`.
2. Run `bash scripts/dev/auto_handoff.sh` to see the branch, your open PRs and the top of `docs/STATE.md`.
3. Update `docs/STATE.md` (keep it under 100 lines). Replace outdated lines; do not append. Change the "Last update" line.
4. Append one entry to `docs/progress.md` with its template: what changed (with PR numbers), why, and the follow-up.
5. If a workstream status changed, update only that row in `docs/STRATEGY.md` §5.
6. If you stop on an open PR, post the Handoff block from `.github/pull_request_template.md` as a PR comment.
7. Open a docs-only PR. Never save secrets, keys or transcripts anywhere.
8. Give the owner this block for the next session:

```
Continue from docs/STATE.md (read it first, then docs/PARALLEL_CHATS.md).
Role: <hub | workstream W<n>>.
Last session ended at: <one line>. Next step: <one line>.
Open PRs to check: <#...>. Do not redo merged work.
```
