---
name: project-review-desk-merge-method
description: "review-desk scheduled task cannot enqueue — plain `gh pr merge <n>` needs a method flag non-interactively, and the task forbids --squash"
metadata:
  node_type: memory
  type: project
  originSessionId: c9940b4a-c6bd-465c-8081-0f4072fd01c1
  modified: 2026-11-12T14:12:57.779Z
---

On 2026-11-12, the roxira-review-desk run found that `gh pr merge <n> --repo Mahan-film/roxira-platform` fails with "--merge, --rebase, or --squash required when not running interactively". The repo has no merge queue. The task file says "Never --admin, --squash", so ready PRs (#736, #741, #761, #773, #795 at that time) piled up without being enqueued.

**Why:** the task's enqueue step is a no-op until the owner changes the task file (e.g. allow `--auto --squash`, which matches [[project-automerge-enabled]] and [[feedback-research-and-automerge]]).

**How to apply:** in review-desk runs, report eligible PRs as `not-enqueued(gh needs merge method; task forbids --squash)` and point it out to the owner. Do not add --squash on your own.
