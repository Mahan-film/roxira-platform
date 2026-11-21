---
name: project-strategy-map-2026-11-03
description: Where strategy/handoff truth lives and current direction (Iran-first accounting suite) as of 2026-11-03
metadata:
  node_type: memory
  type: project
  originSessionId: 57956b53-2027-4640-9c32-5946ce2ceda4
  modified: 2026-11-03T11:45:44.753Z
---

Read order that is current on 2026-11-03: docs/AI_HANDOFF.md (#965, the latest handoff, lanes) → docs/strategy/REQUIREMENTS_STATUS.md (7 done / 36 partial / 19 missing, audited 2026-11-01) → MASTER_PLAN_2026-10-31.md + IRAN_FIRST_ROADMAP_2026-10-31.md → docs/STATE.md (last update 2026-10-30; the 10-31/11-01 wave is not in it). "Auto handoff" = the /handoff skill (.claude/skills/handoff): updates STATE.md + progress.md and opens a docs PR; progress.md was last appended 2026-10-15.

Direction: 2026-10-16 plan said factory first + global via Malaysian company; 2026-10-30/31 owner decisions made the Roxira accounting/ERP suite (roxira.ir Iran first, roxira.net later, country packs) the first factory product. Smart Judge (ghazihoushmand.ir) is live, the only revenue product, in maintenance+growth.

Autodeploy refused every merge 2026-11-01..03 because an untracked `.env.before-app-role.*` made the srv1 tree dirty; fixed 2026-11-03 (moved to /root/env-backups), prod now at da5bca39. Trap: merging while autodeploy runs gives "SHA mismatch" (deploy_local re-reads origin/main); the next 5-min run recovers. See [[project-key-leak-audit-2026-11-03]].
