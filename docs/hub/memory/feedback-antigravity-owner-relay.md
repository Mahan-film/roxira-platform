---
name: feedback-antigravity-owner-relay
description: "Owner runs Antigravity by hand and relays reports; use it for every low-level task to save tokens, and always review its work"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-10-30T10:39:13.685Z
---

Owner rules 2026-10-30: Antigravity runs only in the app on the owner's laptop. Claude gives prompts, the owner runs them
and pastes the report back. Claude has no access and does not run or automate `agy`. Send it as much low-level work as
possible to save tokens, but the owner does not fully trust it: every result must be reviewed.

**Why:** token economy, with Claude as the quality gate.
**How to apply:** give one paste-ready line per task from docs/antigravity/TASKS.md, read the actual `agy/<id>` diff in
~/Developer/rx-wt/ (do not rely on its report), rerun tsc and eslint, then reject or accept. A5 passed its checks yet
shrank the empty state and added an irrelevant link, so passing checks is not enough. Related: [[feedback-hub-delegation]].
