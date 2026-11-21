---
name: project-trusted-codev
description: "Since 2026-11-03 Roxira has two developers who trust each other fully; colleague is a co-developer, not an outside reviewer"
metadata:
  node_type: memory
  type: project
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-11-03T15:04:54.150Z
---

From 2026-11-03 the owner develops Roxira together with a colleague. Both are developers and trust each other 100%. Each has their own Claude Code, Antigravity, DeepSeek, OpenCode, Zed accounts and API keys, and each runs several agents in parallel.

**Why:** The owner corrected an earlier plan that treated the colleague as a limited outside party (read-only srv1, write-only GitHub).

**How to apply:** Give the colleague equal standing: GitHub admin/maintain is fine, srv1 access with their own SSH key and named user is fine. Separation is still recommended for practical reasons (attribution, rate limits, no shared git config/stash), not trust. Conflicts are avoided with lanes, `claim.sh`, and `docs/AI_HANDOFF.md` / team workflow doc. Related: [[project-two-github-accounts]], [[project-public-ci-and-team-tools-2026-11-03]].
