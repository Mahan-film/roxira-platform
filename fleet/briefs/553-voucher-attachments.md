# Task #553: voucher attachments
Reuse the attachment pattern in modules/banking/recon/recon.controller.ts, recon.service.ts and recon.repository.ts: same storage, same size and type limits. Do not import from banking; if a helper is private, write a small local one.

## Data
Migration 1789900000200: erp_journal_entry_attachments (id, tenant_id, journal_entry_id, file_name, content_type, size_bytes, storage key or content as the reference does, uploaded_by, created_at, deleted_at null), FK to the journal entry, index on (tenant_id, journal_entry_id).

## Behaviour
New controller voucher-attachment.controller.ts: POST and GET journal-entries/:id/attachments, GET .../:attachmentId/download, DELETE .../:attachmentId. Upload needs AccessAction.CREATE; delete is a soft delete. Allowed on any status including POSTED, because evidence often arrives late, but delete is refused in a locked period. Download sets Content-Disposition attachment with a sanitised file name, so an uploaded HTML file never renders inline. Another tenant gets 404 on every route, including when guessing an attachment id with a valid voucher id of its own. The attachment must belong to the voucher in the URL.

## UI
A section «پیوست‌ها» in frontend/src/components/accounting/journal-entry-form.tsx, or the voucher detail view if one exists: list, upload, download, delete. Persian errors for too-large and wrong type.

## Tests
pg spec voucher-attachments.pg.spec.ts: upload then list then download returns the same bytes; too large and disallowed type refused; other tenant 404 on all routes; attachment id with another voucher id 404; soft-deleted item not listed; delete in locked period refused.
Requirements row: N-04 (attachments). Help: docs/help/fa/19-voucher-attachments.md.

## Rules for all work here
App root: output_apps/enterprise_hub. Do NOT commit or push. Do NOT edit package.json, lockfiles, frontend app-shell.tsx, app.module.ts, .github/, modules/posting_rules, modules/treasury. Add no dependency.
Code, comments and tests in English; every user-visible string in Persian. Dates shown Jalali. Money is bigint through modules/accounting/money.ts: never parseFloat or Number on money. No hardcoded account codes.
Every query is tenant-scoped; read modules/accounting/repositories/dimension.repository.ts and copy how it enters TenantScope. New tables: tenant_id, ENABLE and FORCE RLS with the same policy as the newest migration in modules/parties (erp_parties). App DB role is not superuser, so a repo without TenantScope sees nothing.
Controllers use DTO classes with class-validator and the same guards and @RequireAction style as controllers/accounting.controller.ts. Business logic in services, SQL in repositories.
Tests must assert computed values, not just that a call succeeded. Do not weaken a test to pass. Do not claim a test passes unless you ran it.
Update the docs/strategy/REQUIREMENTS_STATUS.md row named below with file evidence, and write the named Persian help page in docs/help/fa/.

