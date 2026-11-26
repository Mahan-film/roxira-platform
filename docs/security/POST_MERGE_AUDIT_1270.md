# Post-Merge Audit Report (#1270)

Audit of PRs merged while a newer `Verdict: blocker` comment existed (issue `#1270` plus WAVE 30 additions `#849`, `#886`, and merge-gate item `#1282`), verified against `origin/main` on 2026-11-25.

| Merged PR | Original Blocker(s) | Status on `origin/main` | Evidence / Action |
|---|---|---|---|
| `#1074` | `InvoiceEntity` money/fx columns without transformers | **Fixed** | Fixed & merged in PR `#1311` (`9a141d7c`, `invoice-numeric-transformer.spec.ts`). |
| `#1175` | `as never` type escapes on CRM lead creation | **Fixed** | Fixed & merged in PR `#1311` (`9a141d7c`, `imported-invoice-customer-id.spec.ts`). |
| `#1197` | Global `revokeAllForUser` in `revokeFirmUser`; advisor routes | **Fixed / Disabled** | Advisor routes disabled in PR `#1259` (`3b525fa9`); `accountant-firm.service.ts` scopes `revokeAllForUser` to `affectedTenantIds` and returns early on empty `targets` (verified by `accountant-firm-access.spec.ts` and `accountant-firm-access.pg.spec.ts`). |
| `#1199` | Non-unique `(tenant_id, file_hash)` index on `data_import_batches` | **Replaced** | Superseded and fixed in PR `#1227` (`14d2e3cf`, unique partial index + atomic commit). |
| `#886` | `docker/postgres-walg/Dockerfile` pinned `golang:1.25.11-alpine` | **False positive / Prepared only** | `docker/postgres-walg/Dockerfile` pins explicit digest `@sha256:523c3ef...` (dated 2026-11-17); reviewer hit knowledge-cutoff false positive. |
| `#849` | `DailyAttendanceService` (`importCsv` badge vs DB id priority; `lastOut - firstIn` span counting lunch breaks as worked/overtime); hardcoded branches in `frontend/src/app/app/hr/attendance/page.tsx` | **Backend fixed in this PR**; UI branch list open | Fixed `importCsv` (`employeeNumber` checked before strict numeric `id`) and net paired `IN -> OUT` calculation in `getDailySummary` and `rollupMonthly` (`daily-attendance.service.ts` + regression specs in `daily-attendance.tehran.spec.ts`). Remaining UI gap (`attendance/page.tsx:476-480` hardcoded 3 branches) tracked as a separate frontend follow-up. |
| `#1282` | Merge guard must reject any newer `Verdict: blocker` comment | **Open PR** | Tracked in PR `#1484` (`[needs owner]`, `scripts/ops/ci_box/merge_gate/merge_gate.py`). |
