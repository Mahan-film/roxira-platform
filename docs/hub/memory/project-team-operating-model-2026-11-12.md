---
name: project-team-operating-model-2026-11-12
description: "Two products (Roxira + Smart Judge), owner + collaborator split, Claude scarce → Gemini/DeepSeek do volume; doc PR #798"
metadata:
  node_type: memory
  type: project
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-11-12T19:49:13.731Z
---

Two products in one repo: **Roxira** (roxira.ir accounting/ERP, Iran first; roxira.net global later) and **Smart Judge** (ghazihoushmand.ir legal AI, Python/FastAPI service). Always keep both in mind.

Owner (Person A, Mac, non-programmer) + collaborator (Person B, Windows laptop, programmer, own Claude account). Plan: `docs/strategy/TEAM_OPERATING_MODEL_2026-11-12.md` (PR #798): Gemini lanes build, review desk = DeepSeek only every 2 h (changed 2026-11-12, `roxira-resume-after-limit` disabled), handoff on GitHub (`[HANDOFF-STATE]` comment, `claude --from-pr`), never automate Antigravity, never take PRs from a lane.

**Why:** owner said 2026-11-12 the Claude quota is nearly exhausted; hub must spend minimal tokens and must not build or review itself.

**How to apply:** new hub chats only verify reports, post waves on #592, merge. Next setup steps (CI migration guard, Project v2 hub, atomic claim, templates, CODEOWNERS) go to Gemini lanes or Person B. Related: [[feedback-full-authority-2026-11-12]], [[feedback-review-routing]], [[project-domains-iran-vs-global]].
