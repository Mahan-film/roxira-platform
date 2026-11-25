---
name: feature-plan
description: Before a change that will touch more than 3 files, write a file list and a short plan into docs/plan.md. Use at the start of any non-trivial feature or refactor, not for a one- or two-file fix.
---

1. List every file you expect to touch. If you cannot name them yet, search first. Do not start editing to find out.
2. Add a checklist entry to `docs/plan.md` under "Open items": a one-line goal, the file list, and what changes in each file, in order. Name any file that is out of scope.
3. Keep it short. Link to an ADR in `docs/decisions/` instead of repeating an existing decision.
4. Do the work and tick items off (`- [x]`) in the same PR.
5. When the PR is done, append a one-line summary to `docs/progress.md`. Never edit a past entry.

Skip this for a 1-3 file fix, a mechanical rename, or a plan that would only restate the diff.
