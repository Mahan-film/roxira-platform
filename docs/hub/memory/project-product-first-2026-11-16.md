---
name: project-product-first-2026-11-16
description: "Owner 2026-11-16: product first (CRM/ERP/accounting/tax, global: DE/EU, Gulf); no company/market decisions until done; factory WIP limit; Mac disk guard"
metadata:
  node_type: memory
  type: project
  originSessionId: cf07ce5b-aa34-4385-9e89-7531103e2c5b
  modified: 2026-11-16T20:42:19.179Z
---

Owner direction (late 2026-11-16): finish the product first: CRM, ERP, accounting and tax, usable worldwide (Germany and the EU, the Gulf, others; Iran is live). **No company, market, pricing or pilot decisions, and no company questions, until the product is complete.** The Malaysian dogfood track is paused; queued MY rows stay because they test the country-pack framework.

Decisions (docs/strategy/ARCHITECTURE_DECISIONS_2026-11-16.md, PR #863):
- No Rust/Go/Effect/Bun rewrite.
- Foreign pack order: DE → SA/AE → MY.
- New rows: T166 `decide` role (Gemini Decisions API), T167 A2UI spike, T168 faster M1 gate.
- Factory WIP limit of 3 unmerged PRs per lane.

Research prompts R13–R16 are in docs/strategy/DEEP_RESEARCH_ROUND3.md (owner runs them).

2026-11-17 merge pass: 16 PRs queued (#838 #840 #845 #833 #836 #839 #830 #763 #775 #788 #792 #803 #848 #805 #841 #791). The per-lane fix list is WAVE 16c on #592. PgBouncer PR #857 waits for owner approval.

Hub Mac disk was full (2.5 GB free). Freed to 54 GB by deleting node_modules in idle worktrees, 137 anonymous Docker volumes and caches, and `git worktree remove` of 134 clean merged worktrees. Daily launchd job `ir.roxira.diskguard` (scripts/dev/mac_disk_guard.sh) now does this automatically below 25 GB.

**Why:** the owner wants a complete global product before any business moves.
**How to apply:** do not ask company questions. Plan only product and infra work. Related: [[project-owner-decisions-2026-11-16]], [[feedback-reask-owner-items]].
