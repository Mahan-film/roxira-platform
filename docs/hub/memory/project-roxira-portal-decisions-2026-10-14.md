---
name: project-roxira-portal-decisions-2026-10-14
description: "Owner decisions on the Roxira portal (roxira.ir/.net) after the readiness audit — prices removed, founder name stays, e-namad untouched, plan 1-4 approved"
metadata:
  node_type: memory
  type: project
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-14T12:16:43.551Z
---

Audit: docs/research/ROXIRA_PORTAL_AUDIT_2026-10-14.md (PR #618).

Owner decisions (2026-10-14):
1. Remove the Roxira OS price tiers (Starter/Business/Foundry) and replace them with «پیش‌ثبت‌نام / درخواست همکاری».
2. The founder name «ماهان محمدی» on /about is the owner himself; keep it.
3. e-namad badge (code ۷۴۹۱۴۳۹): do not touch.
4. Approved, all of it:
   - integrity fixes (the fake "accepted by Moadian" message, false claims)
   - /contact persistence + notification
   - client auth + tenant onboarding + tenant isolation for invoicing/accounting/inventory/HR/damages/tax
   - Search Console for roxira.ir and roxira.net after the copy is fixed

**Why:** these are the owner's business and legal calls; the audit found legal and brand risks.

**How to apply:** do not re-ask these decisions. Tenant isolation needs a DB migration, which goes through a reviewed PR plus owner-run `deploy_local.sh migrate`. Related: [[feedback-business-decisions-are-owners]].
