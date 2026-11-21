---
name: project-state-2026-11-16
description: State end of 2026-11-16: 8 lane PRs merged, 4 in queue, WAVE 16c/16d fix lists, lane prompt v5 (WIP 3), #857 needs owner's explicit OK
metadata:
  type: project
  modified: 2026-11-16T21:11:31.910Z
---

State at 2026-11-16 21:15 UTC:
- **Merged today:** #830 #838 #839 #840 #845 #775 #788 #792, plus docs PRs #855 #856 #858 #863.
- **In the merge queue:** #803 #848 #841 #791. Lane prompt v5 PRs #865 and #866 (WIP fix) are queued.
- **Ejected (conflicts), lanes to rebase:** #833 #836 #763 #805.
- **Production after deploy:** containers healthy; roxira.ir, roxira.net and ghazihoushmand.ir return 200.
- **#857 (PgBouncer 1.26.1 CVE fix):** the auto-mode classifier refuses the merge twice, even with the owner's general "full authority". It needs the owner's explicit "merge 857" or a click on GitHub.

Lanes:
- WAVE 16c (fix list per lane, from the agent triage) and WAVE 16d (state + rebase list) are on #592. No fix from 16c had been pushed yet.
- New lane PRs, waiting for review: #859 T149, #860 T153, #862 T161, #864 T156. #861 T138 is red.
- Lane prompt v5: WIP limit 3 per lane, counted by the T ids the lane took (all lanes share the mahan-films account).

**Why:** merging, not lane capacity, is the bottleneck.
**How to apply:** next session, check the queue result, merge green PRs without blockers in dependency order (#842 → #850/#851/#852; #848 → #849/#847), and re-ask the owner about #857. See [[project-product-first-2026-11-16]].

Update 2026-11-17 ~01:00 local: the owner authorized Claude subagents (Haiku/Sonnet 5.5) for speed. Three Sonnet implementer agents (worktree isolation) are fixing hub-owned PRs #850 #851 #843 / #853 #847 #849 / #844 #779 #796. WAVE 16e on #592 splits PR ownership (lanes: hands off the hub PRs). Four per-lane prompts (v5 + this round's tasks) are in docs/antigravity/prompts/ (LANE_PROMPTS.html with copy buttons, L1-L4.txt, ALL_LANES.txt), generated from LANE_PROMPT_FA.md; regenerate them each round.
