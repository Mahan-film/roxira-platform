---
name: feedback-terminal-commands-not-ui
description: "Owner wants copy-paste terminal commands for every step, not \"go to this website and click\" instructions"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8397ea00-8e5d-4ca7-bb7e-b2a46f06fd77
  modified: 2026-10-03T16:43:13.502Z
---

Give the owner ready-to-paste terminal commands (one fenced bash block per step, real PR numbers, no `N` placeholders) instead of sending them to a website or the browser UI.

**Why:** the owner said sending them to sites made their work harder; terminal is easier. They also pasted whole command lists and ran them successfully (merged #462-#465 with `gh pr merge --squash --admin --delete-branch`).

**How to apply:** use `gh` for PRs/billing-adjacent checks (`gh pr diff`, `gh pr view`, `gh pr merge`), never `--web`. Only point to a site when no CLI exists (e.g. GitHub billing budget, provider key pages) and then say exactly what to click. See [[feedback-owner-minimal-work]].
