# Roxira Business Suite (CRM, HR, accounting, inventory) with AI import — 2026-10-22

Owner goal: a next-generation CRM / HR / ERP / accounting suite on roxira.ir, built to current standards,
where a customer drops ONE file (export of their old software, an Excel sheet, a PDF or a photo of a
ledger) and the system understands it, files it, fills customers/employees/items/accounts and is
ready to use. Drag and drop, no consultant.

## 1. What already exists (audited 2026-10-22)

The NestJS backend (`output_apps/enterprise_hub/modules/`, ~17k lines, live in
`roxira_enterprise_backend`) already serves tenant-scoped APIs:

| Module | Live endpoints (examples) |
| --- | --- |
| tenants | `/tenants/me`, members |
| crm | leads CRUD, contacts, notes, stage, pipeline, stats |
| hr | employees, contracts, payslips, `payroll/calculate`, stats |
| accounting | chart of accounts, journal entries, account ledger, trial balance |
| inventory | items, warehouses, stock, batches, inbound/outbound movements, valuation |
| invoicing | invoices |
| tax_compliance | signing keys, signed packets (Moodian e-invoice groundwork) |
| data_import | CSV/XLSX parse, synonym + LLM column mapping, preview/commit — **CRM leads only** |

The roxira.ir pages `/crm`, `/hr`, `/accounting`, `/inventory`, `/invoicing` are marketing pages; there
is no logged-in application UI yet. Twenty CRM was stopped on 2026-10-22 (data kept): our own suite
replaces it.

## 2. Decision: build on our own modules, not ERPNext/Odoo

| Option | Verdict |
| --- | --- |
| ERPNext (GPL) | Strong feature set, but no Jalali calendar or Moodian support, needs ~4 GB RAM extra (srv1 has none to spare), second stack (Frappe/MariaDB) beside NestJS/Postgres. |
| Odoo Community | Heavier, best features are in the paid edition, Jalali only via third-party modules. |
| **Own NestJS modules** | Already live and multi-tenant, fits the box, Persian/Jalali/Moodian are ours to do right, and the Smart Judge legal corpus (labour, tax, insurance law) is a unique advantage for HR and tax rules. **Chosen.** |

Interoperability instead of lock-in: every entity exports to CSV/XLSX and the import accepts exports
of common Iranian packages (Sepidar, Hamkaran, Mahak, Rahkaran) and of ERPNext/Odoo/Excel.

## 3. The core: one AI import pipeline for every entity

```
upload (xlsx/csv/pdf/image, ≤ 5 MB, ≤ 5000 rows)
  -> parse      xlsx/csv: existing parsers; text PDF: pdf text + table extraction;
                scanned PDF / photo: vision model extracts a table (JSON rows)
  -> detect     which entity is this? (leads/customers, employees, items, opening balances,
                journal lines, invoices) — synonyms first, LLM only if unsure
  -> map        header synonyms -> LLM mapping (headers + 5 sample rows only, 40 chars/cell,
                `data_collection: deny`, model role from config/models.yaml)
  -> normalise  Persian/Arabic digits, ي/ك, Jalali -> ISO dates, IRR/Toman, national id / phone checks
  -> preview    editable mapping + per-row errors, nothing written yet
  -> commit     tenant-scoped insert through each module's repository; duplicate detection;
                an import batch id so a whole import can be undone
```

Business data is more sensitive than chat questions: the import keeps the existing rule (no free /
may-log model, only the paid `cheap` role with data collection denied). The cost is tiny because only
headers and 5 trimmed sample rows are sent.

Disk/RAM (LEAN_ARCHITECTURE_2026-10-22.md): parsed uploads live in memory 30 min (existing TTL),
original files are not stored; per-tenant daily import quota.

## 4. Phases

| Phase | Scope | Done when |
| --- | --- | --- |
| **1 (now)** | Import for all entities (registry), PDF/image extraction, auto-detect, undo; app shell at `roxira.ir/app` (login, tenant, dashboard, CRM leads + pipeline, HR employees, inventory items, accounting accounts + trial balance) with a drag-and-drop import wizard; Jalali dates in the UI | A test tenant imports a 200-row customer Excel, an employee list and a chart of accounts in < 2 minutes each, with undo |
| 2 | Invoicing UI + VAT, payroll per Iranian labour law (legal corpus), insurance list export, bank statement import + reconciliation, AI assistant over the tenant's own data | A small company runs a month of invoices and payroll |
| 3 | Moodian e-invoice submission (tax_compliance), multi-currency, roles/permissions, mobile layout polish, public API | Live with first paying pilot |

## 5. Rules

- Every new table has the tenant column and access checks in the repository layer (AGENTS.md §4).
- Migrations only through reviewed PRs; no direct production migration.
- DTO validation on every endpoint; contract-first (OpenAPI) before frontend hooks.
- No service key in frontend code.
