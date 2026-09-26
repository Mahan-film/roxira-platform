---
name: handoff
description: Save this chat's state so a fresh chat can continue. Use when context is ~60% full, a workstream finishes, before switching models or chats, or when the user says "handoff", "new chat", "context is full" or "انتقال به چت جدید".
---

1. Sync: `git fetch`, then work in a worktree/branch from `origin/main` (e.g. `handoff/<date>-<topic>`).
2. Update `docs/STATE.md` (keep it under 100 lines): move finished items into "Live and working", update "Waiting on the owner", "Next workstreams" and "Known issues". Replace outdated lines instead of appending. Change the "Last update" line.
3. Append one entry to `docs/progress.md` using its template: what changed (with PR numbers), why, and follow-up.
4. If a workstream row status changed, update only that row in `docs/STRATEGY.md` §5.
5. Save at most 3 short, verified lessons or preferences to engram (`mem_save`). Never save secrets, keys, raw web or issue text, or transcripts.
6. Open a PR (docs only), with auto-merge enabled.
7. Reply to the owner in Persian, with this block in English that they can paste into a new chat:

```
Continue from docs/STATE.md (read it first, then docs/PARALLEL_CHATS.md).
Role: <hub on Opus 5.5 | workstream W<n> on Sonnet 5>.
Last session ended at: <one line>. Next step: <one line>.
Open PRs to check: <#…>. Do not redo merged work.
```
