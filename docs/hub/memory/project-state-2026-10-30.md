---
name: project-state-2026-10-30
description: "P0 state: sandbox on srv1, dirty tree PRs #871/#884/#885, backup failing, key inventory location"
metadata:
  node_type: memory
  type: project
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-10-30T17:41:08.539Z
---

State on 2026-10-30. Agent sandbox is installed on srv1; firewall fix (`jump agent`) is in #883 and needed loading by the
owner because the classifier blocked it. srv1's dirty tree is live, saved on `srv1-snapshot-2026-10-30`; deploy stays
blocked until #871, #884, #885 merge and the tree is reconciled. DR backup fails hourly since 2026-10-22 because
`roxira_twenty_db` is stopped. All keys and cluster jobs: docs/infra/KEY_INVENTORY.md.

**Why:** a fresh chat must not clean the srv1 tree or merge with --admin.
**How to apply:** read docs/STATE.md first, then re-check srv1 before acting. Related: [[project-owner-direction-2026-10-16]].
