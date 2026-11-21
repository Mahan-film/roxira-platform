---
name: project-r18-digest-2026-11-20
description: "R18 Smart Judge v2 digested 2026-11-20 into rows T234-T258 (#973-#997), WAVE 21; Option 2 phased on shared server"
metadata:
  node_type: memory
  type: project
  originSessionId: cf07ce5b-aa34-4385-9e89-7531103e2c5b
  modified: 2026-11-20T10:55:33.214Z
---

R18 (Smart Judge v2, Gemini Deep Research, stage 1 + stage 2) arrived 2026-11-20. Hub decision: report's Option 2 — phased v2 on the current shared server; moving Smart Judge to its own server is triggered by the ERP guard alert (T254) and stays the owner's spend decision. Not adopted now: Deepgram/Azure accounts, Langfuse, L2 semantic cache on by default, multi-draft speculative RAG, full 150K corpus (grow to ~500 laws first).

- Rows T234-T258 = issues #973-#997 (L4 mostly; L1 T252-T254; L3 T239; L7 T248-T251). T240 = live check of every UNVERIFIABLE vendor claim before use.
- WAVE 21 on #592 (comment 7037736414): blockers first, then R18 order per lane.
- Raw report extracted from the chat transcript to `.box/R18_SMART_JUDGE_RAW.md`; a Sonnet agent opens the docs PR (raw + digest + docs/TEAM_START.md for the colleague).
- Box hub merged #970 (gemini_lanes.sh fallback) and #971 (phone kit #959) on 2026-11-19.

Related: [[project-ci-box-and-phone-stack]], [[feedback-never-name-the-country]].
