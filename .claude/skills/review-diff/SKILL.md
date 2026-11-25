---
name: review-diff
description: Review only the current diff and test output (not the whole repo) against a fixed checklist before a PR merges. Use right before opening or merging a PR, or when asked to review an agent's changes. The reviewer must be a different model from the one that wrote the diff (docs/STRATEGY.md §3a).
---

Follow `docs/agents/REVIEW_CHECKLIST.md` exactly. It is the single source for
this checklist, shared with other agents and with the review hook.

In short: the reviewer is not from the author's model family; read only the
diff and the CI output; check **Secrets**, **Auth/payments**, **Input
validation**, **Migrations** and **Tests and gates**; report pass or fail per
item and block the merge on any fail.
