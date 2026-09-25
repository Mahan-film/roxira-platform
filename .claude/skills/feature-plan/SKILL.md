---
name: feature-plan
description: Before a change that will touch more than 3 files, write a file list and short plan into docs/plan.md first. Use at the start of any non-trivial feature or refactor, before opening the editor — not for a one- or two-file fix.
---

1. List every file you expect to touch (add > 3 confirms this skill applies).
   If you can't name them yet, do a quick search first — do not start editing
   to find out.
2. Add a checklist entry to `docs/plan.md` under "Open items":
   - One-line goal.
   - The file list from step 1.
   - The plan: what changes in each file, in what order, and any file that
     is deliberately out of scope (send it to the hub chat instead).
3. Keep the entry short — a checklist item, not a design doc. Link to an ADR
   (`docs/decisions/`) instead of re-explaining an existing decision.
4. Do the work, checking items off (`- [x]`) as they land in this same PR.
5. When the PR is done, move the finished item's one-line summary into
   `docs/progress.md` (append a new entry; never edit a past one).

Skip this skill for: a 1-3 file fix, a mechanical rename, or anything where
the plan would just restate the diff.
