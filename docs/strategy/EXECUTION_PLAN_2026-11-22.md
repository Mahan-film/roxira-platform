# Execution plan to the first paying customer (hub synthesis, 2026-11-22)

Sources: hub planning agents on STATE, STRATEGY_NOW, WAVE 27-29, the open-issue list, the open PR list and a CI audit. GitHub data beats this file. UNVERIFIED = not confirmed.

## Critical path (gating issues)
1. Unblock the review loop: #1000 (Mac push timeouts), box-lanes key delivery and tunnel smoke (owner step). #1092 is closed; test each gateway group once, spaced, before `orch --apply`.
2. Land or split the blocked lane PRs (table below); WIP 3 per lane until this is clear.
3. Money-safe core: #908/#1077 (period states), #940 (#1192 control accounts), #910 (tax engine), #587/#555 (gapless numbers).
4. Tenant isolation: #831 (RLS cutover), #475 (tables without RLS), restricted DB role (T200), leak tests #1066.
5. Migration path: #1216 (tie-out + idempotent re-import), #1217 (cutover wizard redo, #1226/#1229), #1148-#1152.
6. Own invoicing for the SaaS: #1218 (#1242), #1144.
7. Billing: #1140, #1142, #1145, #1146, #1143.
8. Backup and DR evidence: #1110, WAL-G (owner window), disk guard at 80 percent.
9. Licence and security gate: #991/#999, #1071, #1122 (Redis, #1158 held), #1031 (OSV findings), #1059 (Twenty CRM), #1235 (PyMuPDF AGPL).
10. Private flip: #1044, #1046 (JIT runner pool), #1020, #1024, merge gate (#951/#1029/#1232), one full day with CI_RUNNER_MODE=auto. Hosted minutes estimate: about 6,000 per month for main alone versus about 2,000 on the Free plan, so the runner pool is a real precondition (estimate).
11. Smart Judge quality: #973/#974, #980/#985, #926, #986.
12. Trust pack: #1112, #1109, #1114, #1108 (EU data path; decided: EU-resident / no-training providers only for EU tenants).
13. Pilot onboarding: #1154, #1155, then the first customer on a live tenant.
14. First invoice issued and paid (needs #1140 or a manual invoice for the default pack; UNVERIFIED).

## Lanes, top rows
- L1: weeks 1-2 #1158 fix, #1161 fixes, #1230, M1 shard + timing-test fix; weeks 3-6 #931/#928, #1110 restore drill, #1031 triage.
- L2: weeks 1-2 #1227, #1226/#1229 fixes, #1216 tie-out engine, #1218; weeks 3-6 #1148-#1152.
- L3: weeks 1-2 #1192, #1197, #1201 parts 2-3, #475 + T200 role; weeks 3-6 #1066, #1057 (deadline 12 Jan), #1112.
- L4: weeks 1-2 #1235, #973/#974, #980; weeks 3-6 #985, #986/#926, #994.
- L5 (box): #908/#1077, #910, #1140 then #1142, #1145, #1146, #1154. NOTE: after the private flip core business logic (ledger, tax, billing) is done only by the human-driven hubs (AGENTS.md 4a): finish as much of it as safely possible through reviewed lane PRs before the flip.
- L6: #917, #915, #1058 then #916, #1101-#1103, #1132. L7: #1115, #989, #987 then #1121, #1116, #1119 (off the critical path).

## Stale blocked PRs: triage (class and next step)
| PR | Class | Next step |
|---|---|---|
| 964 T178 hash chain | HOLD-OWNER then FIX | CREATE TRIGGER never attached; add @RequireAction to 3 endpoints; rebase; renumber migration 12800 (also #963) |
| 963 T194 budget | HOLD-OWNER then FIX | fail closed when no budget exists; pg_advisory_xact_lock; renumber 12800 |
| 943 T180 tax engine | re-review | earlier blocker was a false alarm (19 = plain percent): re-run the reviewer at the head |
| 728 T71 Moadian | FIX | jalaali-js instead of ca-persian ICU; missing vatRate must error not default to 0; renumber 12600 (also #868) |
| 854 T148 export + purge | HOLD-OWNER | confirm FK-safe purge order, dry-run flag, stream ZIP: deletes tenant data |
| 868 T145 entitlements | HOLD-OWNER | re-review at head; renumber 12600 |
| 831 T105 RLS | HOLD-OWNER | add tenant-scope-ok annotations; CI/staging only |
| 771 T85 WooCommerce | SPLIT then FIX | minorToNumber turns money into a float; split into migration+entity, sync service on bigint, webhook+controller |
| 763 T81 print forms | SPLIT | backend templates+migration, frontend print, barcode sheets; renumber 12500 (collides with main) |
| 850 T141 country packs | FIX | corporate-tax.service.ts may call readStatutory without a country |
| 805 T104 quotation | REBASE-ONLY then re-review | migration 11100 is below main's newest: check ordering |
| 663 nginx cache | HOLD-OWNER | cache could leak authenticated pages; owner sentence, then rebase |
| 1072 / 1159 / 1172 | FIX / REBASE / FIX | fix red backend job; rerun CI; fix pytest failure and make forbidden_repealed_ids required |
Order: ledger (#964, #963), tax (#728, #850, #943), security/data deletion (#831, #854: owner sentence), then #868, #771, #763, then the rest. Every migration must take the next free number above main and every open PR.
Autodeploy ships main to production in about 5 minutes: never merge #854, #831, #964, #963, #868, #663 or a migration below main's newest without the owners' sentence (AGENTS.md 4a).

## CI facts (last 40 main runs, 2026-11-19..21)
Pass rate 34/40 (3 cancelled, 3 failed: all the test_orch import-time guard, fixed in #1195). Median run 12.4 min, p90 17.8; the M1 Playwright job (about 12.5 min) sets the wall clock. Cheap wins: shard M1 into 3 (about 12 to 5 min), cache Playwright browsers, make the financial-reports timing assertion relative (2951 ms vs a 2000 ms limit seen once). Do NOT quarantine test_orch.

## Obsolete, duplicate or missing rows
- Likely obsolete (check and close): STATE refresh rows #1181 #1183 #1185 #1187, #1189, #1212, #1214, research-register rows #1240 #1243 #1244 #1245 #1249 #1251 once their PRs merge.
- Duplicates to merge: #555/#587; #584/#585; #364/#366/#374/#495; #361/#363; #365/#423/#425; #992/#1122/#1123/#1124; #1125/#302; check #1066 vs #1057.
- Stale backlog: HR rows #370-#373 conflict with the payroll-after-product rule.
- Missing: first-customer pilot runbook (acceptance checklist, support path, status page); customer terms and privacy page aligned with R8; billing for the default pack (local payment or manual invoice); a production smoke/e2e gate for money paths (#680 is only backlog); account login/2FA/password-reset readiness (UNVERIFIED); a pricing and plan-entitlement table.

## Owner-only decisions by week
Week 1: who customer 1 is and which pack; key delivery and sudo lines. Week 2: #1108/#1122; whether tax-advisor tenants have data improvement off (R29); production steps (WAL-G, T200 role). Week 3: pricing, trial, refund policy (R31); free migration for the first 5 pilots (R32). Week 4: insurance before paid external tenants, pentest budget, product rename and trademark (R26). "Go private" only after the preconditions in item 10 are green. Company/legal structure stays after the product, unless a merchant-of-record choice forces it (flag, do not decide).
