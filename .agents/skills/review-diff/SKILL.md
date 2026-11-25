---
name: review-diff
description: Review only the current diff and test output against the repo's fixed checklist before a PR merges. Use right before opening or merging a PR, or when asked to review another agent's changes. The reviewer must be from another model family than the author.
---

Follow `docs/agents/REVIEW_CHECKLIST.md` exactly. It is the single source for
the review checklist in this repo.

1. If your model family wrote the diff, stop and say so.
2. Read only the diff against the base branch and the CI output.
3. Check each item in the checklist and report pass or fail per item.
4. Block the merge on any fail. Say what you did not check.
