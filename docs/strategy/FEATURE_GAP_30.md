# Feature-Gap Audit: 30 Features Users Miss When Switching

> **Context**: WAVE 15 Task T143 (`Feature-gap audit (30 features)`).  
> **Source list**: `docs/strategy/research/R5_R6_R7_GTM_LEGAL_PORTFOLIO.md` (§ "The 30 features users miss when switching").  
> **Verification standard**: Every cited file path and specification is verified against `origin/main` via `git cat-file -e origin/main:<path>` (Rule: Lesson 21).

---

## 1. Executive Summary

When prospective business customers evaluate switching from established legacy or cloud accounting systems (e.g. Sepidar, Holoo, QuickBooks, Xero) to Roxira, 30 specific workflow and control capabilities determine whether the transition succeeds without operational friction.

This audit evaluates the live state of all 30 features within the Roxira codebase.

| Category | Count | Features |
|---|:---:|---|
| **Exists** | 16 | Bank rules, Partial/over-payments, Keyboard-only entry, Immutable audit trail, Credit notes linked to invoices, Multi-level approvals, Landed cost, Unit-of-measure conversion, Configurable negative stock, Customer/vendor statements, Depreciation schedules, Granular RBAC, Validated imports, Line-level cost-centre tags, Company switcher, Consolidation |
| **Partial** | 11 | Split transactions, Bulk actions, Period lock, Realised/unrealised FX, Duplicate detection, Recurring invoices and journals, Report drill-down, Invoice templates, Attachments on every transaction, Tax-inclusive/exclusive and withholding, Void instead of delete |
| **Missing** | 3 | Payment reminders, Saved report filters, Shift close / Z-report |

All 14 gap items (11 partial, 3 missing) are mapped to concise, WAVE-ready engineering tasks with effort sizing (S/M/L) for scheduling in WAVE 16+.

---

## 2. Summary Audit Matrix

| # | Feature | Status | Evidence File Path | Evidence Spec Path | WAVE-Ready Task Line (Effort) |
|---|---|:---:|---|---|---|
| 1 | **Bank rules** | `exists` | `output_apps/enterprise_hub/modules/banking/recon/classify/classifier.ts` | `output_apps/enterprise_hub/modules/banking/recon/classify/classifier.spec.ts` | — |
| 2 | **Partial and over-payments** | `exists` | `output_apps/enterprise_hub/modules/treasury/allocation/allocation-engine.ts` | `output_apps/enterprise_hub/modules/treasury/allocation/allocation-engine.spec.ts` | — |
| 3 | **Split transactions** | `partial` | `output_apps/enterprise_hub/modules/banking/recon/matching/matcher.ts` | `output_apps/enterprise_hub/modules/banking/recon/matching/matcher.spec.ts` | Manual split of a single transaction or bank line across multiple GL accounts with validation (M) |
| 4 | **Keyboard-only entry** | `exists` | `output_apps/enterprise_hub/frontend/src/lib/voucher-keyboard.ts` | `output_apps/enterprise_hub/frontend/src/lib/voucher-keyboard.test.ts` | — |
| 5 | **Bulk actions** | `partial` | `output_apps/enterprise_hub/modules/data_import/bulk/bulk-post.service.ts` | `output_apps/enterprise_hub/modules/data_import/bulk/bulk-post.service.spec.ts` | Generic multi-select bulk actions bar (bulk approve, export, void) on invoice and journal tables (M) |
| 6 | **Period lock** | `partial` | `output_apps/enterprise_hub/modules/accounting/entities/period-lock.entity.ts` | `output_apps/enterprise_hub/modules/accounting/accounting.ledger.pg.spec.ts` | Role-based override for period lock posting with dedicated audit logging (T146) (M) |
| 7 | **Immutable audit trail** | `exists` | `output_apps/enterprise_hub/modules/access/entities/audit-log.entity.ts` | `output_apps/enterprise_hub/modules/access/services/ledger-audit.service.spec.ts` | — |
| 8 | **Realised/unrealised FX** | `partial` | `output_apps/enterprise_hub/modules/currency/services/fx-revaluation.service.ts` | `output_apps/enterprise_hub/modules/currency/fx-revaluation.spec.ts` | Dual-amount ledger and payment reconciliation realised FX booking with auto-reversing period revaluation (T138/T139) (L) |
| 9 | **Credit notes linked to invoices** | `exists` | `output_apps/enterprise_hub/modules/sales/returns/services/sales-return.service.ts` | `output_apps/enterprise_hub/modules/sales/returns/sales-return.pg.spec.ts` | — |
| 10 | **Multi-level approvals** | `exists` | `output_apps/enterprise_hub/modules/approvals/services/approvals.service.ts` | `output_apps/enterprise_hub/modules/approvals/approvals.pg.spec.ts` | — |
| 11 | **Duplicate detection** | `partial` | `output_apps/enterprise_hub/modules/invoicing/services/invoicing.service.ts` | `output_apps/enterprise_hub/modules/invoicing/services/invoicing.service.import.spec.ts` | Fuzzy duplicate detection warning for vendor bills and vouchers by counterparty, amount and date (S) |
| 12 | **Recurring invoices and journals** | `partial` | `output_apps/enterprise_hub/modules/accounting/entities/recurring-voucher.entity.ts` | `output_apps/enterprise_hub/modules/accounting/recurring-vouchers.pg.spec.ts` | Recurring sales invoices engine with automatic generation and schedule management (M) |
| 13 | **Report drill-down** | `partial` | `output_apps/enterprise_hub/frontend/src/components/accounting/account-review.tsx` | `output_apps/enterprise_hub/modules/accounting/reports/statements.spec.ts` | Universal drill-down links from financial statement summary figures to underlying journals (M) |
| 14 | **Invoice templates** | `partial` | `output_apps/enterprise_hub/frontend/src/lib/print/sales-invoice.ts` | `output_apps/enterprise_hub/frontend/src/lib/print/sales-invoice.test.ts` | Customisable invoice templates with logo, header/footer text and field visibility options (M) |
| 15 | **Landed cost** | `exists` | `output_apps/enterprise_hub/modules/inventory/purchasing/landed-cost.domain.ts` | `output_apps/enterprise_hub/modules/inventory/purchasing/landed-cost.domain.spec.ts` | — |
| 16 | **Unit-of-measure conversion** | `exists` | `output_apps/enterprise_hub/modules/inventory/entities/item-attributes.domain.ts` | `output_apps/enterprise_hub/modules/inventory/dual-units-serials-attributes.spec.ts` | — |
| 17 | **Configurable negative stock** | `exists` | `output_apps/enterprise_hub/modules/tenants/policy/policy.registry.ts` | `output_apps/enterprise_hub/modules/sales/controls.pg.spec.ts` | — |
| 18 | **Payment reminders** | `missing` | *None* | *None* | Scheduled payment reminder engine for overdue invoices and maturing cheques via SMS/email (M) |
| 19 | **Attachments on every transaction** | `partial` | `output_apps/enterprise_hub/modules/accounting/entities/journal-entry-attachment.entity.ts` | `output_apps/enterprise_hub/modules/accounting/voucher-attachments.pg.spec.ts` | Polymorphic transaction attachments for invoices, bills, and payment receipts (M) |
| 20 | **Saved report filters** | `missing` | *None* | *None* | Saved report filter configurations and custom view presets per tenant user (S) |
| 21 | **Tax-inclusive/exclusive and withholding** | `partial` | `output_apps/enterprise_hub/modules/tax_compliance/services/doctor-withholding.service.ts` | `output_apps/enterprise_hub/modules/tax_compliance/doctor-withholding.spec.ts` | Tax-inclusive pricing mode on invoices and general supplier withholding tax deduction (M) |
| 22 | **Customer/vendor statements** | `exists` | `output_apps/enterprise_hub/modules/accounting/services/financial-reports.service.ts` | `output_apps/enterprise_hub/modules/accounting/reports/party-statement.spec.ts` | — |
| 23 | **Shift close / Z-report** | `missing` | *None* | *None* | POS cashier shift close (Z-report) with cash drawer count and variance reconciliation (M) |
| 24 | **Depreciation schedules** | `exists` | `output_apps/enterprise_hub/modules/accounting/assets/depreciation.ts` | `output_apps/enterprise_hub/modules/accounting/assets/depreciation.spec.ts` | — |
| 25 | **Granular RBAC** | `exists` | `output_apps/enterprise_hub/modules/access/entities/custom-role.entity.ts` | `output_apps/enterprise_hub/modules/access/custom-roles.pg.spec.ts` | — |
| 26 | **Void instead of delete** | `partial` | `output_apps/enterprise_hub/migrations/1789320000000-LedgerPeriodLocksAndGuards.ts` | `output_apps/enterprise_hub/modules/accounting/accounting.ledger.pg.spec.ts` | Universal void-not-delete document lifecycle with auto-reversing entries and audit trail (T146) (M) |
| 27 | **Validated imports** | `exists` | `output_apps/enterprise_hub/modules/data_import/services/import-dry-run.service.ts` | `output_apps/enterprise_hub/modules/data_import/import-dry-run.pg.spec.ts` | — |
| 28 | **Line-level cost-centre tags** | `exists` | `output_apps/enterprise_hub/modules/accounting/entities/dimension.entity.ts` | `output_apps/enterprise_hub/modules/accounting/cost-centres.pg.spec.ts` | — |
| 29 | **Company switcher** | `exists` | `output_apps/enterprise_hub/frontend/src/components/app/org-switcher.tsx` | `output_apps/enterprise_hub/modules/access/rls/pre-tenant-rls.pg.spec.ts` | — |
| 30 | **Consolidation** | `exists` | `output_apps/enterprise_hub/modules/accounting/services/consolidated-report.service.ts` | `output_apps/enterprise_hub/modules/accounting/consolidated-report.pg.spec.ts` | — |

---

## 3. Detailed Feature Breakdown

### 1. Bank rules (`exists`)
- **Capability**: Automated classification of incoming and outgoing bank statement lines into ledger categories and account codes based on keywords, counterparty IBANs, and fee patterns.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/banking/recon/classify/classifier.ts` (`TenantRule`, `ClassificationSource`, `classify()`)
  - Test Suite: `output_apps/enterprise_hub/modules/banking/recon/classify/classifier.spec.ts`

### 2. Partial and over-payments (`exists`)
- **Capability**: Settling receipts and payments against multiple invoices with support for partial settlement, outstanding balances, over-payment advances, and configurable write-off tolerances.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/treasury/allocation/allocation-engine.ts` (`allocateDocument()`, `AllocationRequest`)
  - Test Suite: `output_apps/enterprise_hub/modules/treasury/allocation/allocation-engine.spec.ts`, `output_apps/enterprise_hub/modules/treasury/treasury.pg.spec.ts`

### 3. Split transactions (`partial`)
- **Capability**: The automated reconciliation matcher supports 1:N splitting (`one_to_many`), but manual interactive split of a bank statement line or payment transaction across multiple accounts or cost centres is not exposed in the UI/service.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/banking/recon/matching/matcher.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/banking/recon/matching/matcher.spec.ts`
- **Gap / Task**: `Manual split of a single transaction or bank line across multiple GL accounts with validation (M)`

### 4. Keyboard-only entry (`exists`)
- **Capability**: High-speed double-entry voucher entry through keyboard navigation, auto-balancing calculations, Enter/Tab shortcuts, and inline cell manipulation.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/frontend/src/lib/voucher-keyboard.ts` (`computeBalancingAmount()`, `navigateCell()`)
  - Test Suite: `output_apps/enterprise_hub/frontend/src/lib/voucher-keyboard.test.ts`

### 5. Bulk actions (`partial`)
- **Capability**: Backend data import supports page-by-page bulk posting (`BulkPostService`), but generic grid multi-selection actions (bulk approve, export, void, print) across standard invoice and journal tables are not implemented.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/data_import/bulk/bulk-post.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/data_import/bulk/bulk-post.service.spec.ts`
- **Gap / Task**: `Generic multi-select bulk actions bar (bulk approve, export, void) on invoice and journal tables (M)`

### 6. Period lock (`partial`)
- **Capability**: An append-only period lock table exists, enforced by the `fin_guard_locked_period` PostgreSQL trigger rejecting postings into locked date ranges. However, role-based override with a dedicated audit row is missing (prerequisite for T146).
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/accounting/entities/period-lock.entity.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/accounting.ledger.pg.spec.ts`
- **Gap / Task**: `Role-based override for period lock posting with dedicated audit logging (T146) (M)`

### 7. Immutable audit trail (`exists`)
- **Capability**: Append-only `audit_log` table protected by a database trigger preventing `UPDATE`, `DELETE`, and `TRUNCATE`, recording actor user ID, action, resource, metadata, and IP address.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/access/entities/audit-log.entity.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/access/services/ledger-audit.service.spec.ts`

### 8. Realised/unrealised FX (`partial`)
- **Capability**: Unrealised FX revaluation service calculates month-end balances and posts revaluation journal vouchers. However, dual-amount ledger tracking and settlement realised FX gains/losses are scheduled for WAVE 15 T138/T139.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/currency/services/fx-revaluation.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/currency/fx-revaluation.spec.ts`
- **Gap / Task**: `Dual-amount ledger and payment reconciliation realised FX booking with auto-reversing period revaluation (T138/T139) (L)`

### 9. Credit notes linked to invoices (`exists`)
- **Capability**: Sales return vouchers and credit notes are linked to issued invoices, enforcing quantity bounds, reversing COGS, and generating return invoices.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/sales/returns/services/sales-return.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/sales/returns/sales-return.pg.spec.ts`

### 10. Multi-level approvals (`exists`)
- **Capability**: Configurable approval rules, multi-step review workflows, group-based escalation, delegation, and policy approval limits.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/approvals/services/approvals.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/approvals/approvals.pg.spec.ts`

### 11. Duplicate detection (`partial`)
- **Capability**: Hard duplicate constraints exist on tax invoice numbers, import natural keys, duplicate bank files, and SMS hashes. However, heuristic/fuzzy warning on manual vendor bill and voucher creation (same counterparty, date, and amount) is missing.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/invoicing/services/invoicing.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/invoicing/services/invoicing.service.import.spec.ts`
- **Gap / Task**: `Fuzzy duplicate detection warning for vendor bills and vouchers by counterparty, amount and date (S)`

### 12. Recurring invoices and journals (`partial`)
- **Capability**: Recurring voucher templates exist for journal entries (`erp_recurring_vouchers`), but recurring billing and scheduled sales invoices are not yet available.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/accounting/entities/recurring-voucher.entity.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/recurring-vouchers.pg.spec.ts`
- **Gap / Task**: `Recurring sales invoices engine with automatic generation and schedule management (M)`

### 13. Report drill-down (`partial`)
- **Capability**: Account review enables hierarchical drill-down from Trial Balance / Kol to Moein, Tafsili, and individual voucher lines. Universal drill-down from summary P&L and Balance Sheet figures directly to ledger lines is scheduled for WAVE 16.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/frontend/src/components/accounting/account-review.tsx`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/reports/statements.spec.ts`
- **Gap / Task**: `Universal drill-down links from financial statement summary figures to underlying journals (M)`

### 14. Invoice templates (`partial`)
- **Capability**: Dedicated A4 and A5 print layouts with Jalali formatting, tax breakdowns, and Persian words exist. Fully customizable templates (tenant logo upload, configurable footer text, custom CSS/columns) are not yet configurable.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/frontend/src/lib/print/sales-invoice.ts`
  - Test Suite: `output_apps/enterprise_hub/frontend/src/lib/print/sales-invoice.test.ts`
- **Gap / Task**: `Customisable invoice templates with logo, header/footer text and field visibility options (M)`

### 15. Landed cost (`exists`)
- **Capability**: Exact integer arithmetic distribution of customs, freight, and insurance costs across inventory receipts by value, quantity, or weight basis.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/inventory/purchasing/landed-cost.domain.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/inventory/purchasing/landed-cost.domain.spec.ts`

### 16. Unit-of-measure conversion (`exists`)
- **Capability**: Stock items support primary and secondary units with fixed conversion factors (e.g. carton to pieces) and integer-scaled bounds.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/inventory/entities/item-attributes.domain.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/inventory/dual-units-serials-attributes.spec.ts`

### 17. Configurable negative stock (`exists`)
- **Capability**: Tenant policy `inventory.negative_stock.mode` allows `refuse` (blocks outbound transactions), `warn` (allows transaction with negative stock layer and warning), or `allow`.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/tenants/policy/policy.registry.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/sales/controls.pg.spec.ts`

### 18. Payment reminders (`missing`)
- **Capability**: Automated reminders for overdue customer invoices and upcoming Sayad cheque maturities via SMS or email are currently not implemented.
- **Evidence**: *None*
- **Gap / Task**: `Scheduled payment reminder engine for overdue invoices and maturing cheques via SMS/email (M)`

### 19. Attachments on every transaction (`partial`)
- **Capability**: Attachments are fully supported on journal vouchers (`erp_journal_entry_attachments`) with SHA256 checksums and mime validation, but polymorphic attachments across sales invoices, purchase bills, and cash receipts are missing.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/accounting/entities/journal-entry-attachment.entity.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/voucher-attachments.pg.spec.ts`
- **Gap / Task**: `Polymorphic transaction attachments for invoices, bills, and payment receipts (M)`

### 20. Saved report filters (`missing`)
- **Capability**: Reports take query parameters, but users cannot save, name, and recall custom filter configurations or presets.
- **Evidence**: *None*
- **Gap / Task**: `Saved report filter configurations and custom view presets per tenant user (S)`

### 21. Tax-inclusive/exclusive and withholding (`partial`)
- **Capability**: Withholding deductions exist for contractor progress statements and doctor fee advances. However, invoices lack a tax-inclusive pricing toggle (VAT computed backwards from line gross) and general supplier withholding deductions.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/tax_compliance/services/doctor-withholding.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/tax_compliance/doctor-withholding.spec.ts`
- **Gap / Task**: `Tax-inclusive pricing mode on invoices and general supplier withholding tax deduction (M)`

### 22. Customer/vendor statements (`exists`)
- **Capability**: Party statement service provides running balance ledgers and ageing breakdowns for customers and suppliers, exportable to A4 PDF and XLSX formats.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/accounting/services/financial-reports.service.ts` (`partyStatement`)
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/reports/party-statement.spec.ts`, `output_apps/enterprise_hub/modules/accounting/financial-reports.pg.spec.ts`

### 23. Shift close / Z-report (`missing`)
- **Capability**: Quick counter sales are supported in POS, but cashier shift sessions, cash drawer opening/closing counts, variance tracking, and Z-report printing are missing.
- **Evidence**: *None*
- **Gap / Task**: `POS cashier shift close (Z-report) with cash drawer count and variance reconciliation (M)`

### 24. Depreciation schedules (`exists`)
- **Capability**: Asset depreciation schedules implement straight-line and declining-balance calculations with salvage floor constraints and automated monthly posting rules.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/accounting/assets/depreciation.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/assets/depreciation.spec.ts`

### 25. Granular RBAC (`exists`)
- **Capability**: Custom roles allow tenant administrators to configure fine-grained permissions (`module:action`), organizational scopes (branches/warehouses), financial amount limits, and sensitive field visibility flags (cost, margin, salary).
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/access/entities/custom-role.entity.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/access/custom-roles.pg.spec.ts`

### 26. Void instead of delete (`partial`)
- **Capability**: Database triggers (`fin_guard_posted_entry`) prevent deletion or update of posted ledger entries, and `reverseJournalEntry` posts reversing entries with swapped debits/credits. However, universal document-level void semantics across all sales, purchase, and treasury documents remain partial (addressed in T146).
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/migrations/1789320000000-LedgerPeriodLocksAndGuards.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/accounting.ledger.pg.spec.ts`
- **Gap / Task**: `Universal void-not-delete document lifecycle with auto-reversing entries and audit trail (T146) (M)`

### 27. Validated imports (`exists`)
- **Capability**: Comprehensive import dry-run engine validates records across multiple tables (accounts, parties, stock, cheques), detecting collisions and formatting errors with guaranteed transaction rollback.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/data_import/services/import-dry-run.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/data_import/import-dry-run.pg.spec.ts`

### 28. Line-level cost-centre tags (`exists`)
- **Capability**: Double-entry journal voucher lines support hierarchical cost-centre tags, verified with PostgreSQL integration tests for multi-level trial balances by cost centre.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/accounting/entities/dimension.entity.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/cost-centres.pg.spec.ts`

### 29. Company switcher (`exists`)
- **Capability**: Organization switcher component allows multi-company users to switch active tenant context cleanly, backed by pre-tenant RLS checks on memberships.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/frontend/src/components/app/org-switcher.tsx`
  - Test Suite: `output_apps/enterprise_hub/modules/access/rls/pre-tenant-rls.pg.spec.ts`

### 30. Consolidation (`exists`)
- **Capability**: Multi-company financial consolidation aggregates trial balances across accessible subsidiaries under strict RLS isolation.
- **Evidence**:
  - Implementation: `output_apps/enterprise_hub/modules/accounting/services/consolidated-report.service.ts`
  - Test Suite: `output_apps/enterprise_hub/modules/accounting/consolidated-report.pg.spec.ts`

---

## 4. WAVE 16 Backlog Candidate Summary

The 14 partial and missing features yield the following prioritized task list:

1. `Saved report filter configurations and custom view presets per tenant user (S)`
2. `Fuzzy duplicate detection warning for vendor bills and vouchers by counterparty, amount and date (S)`
3. `Manual split of a single transaction or bank line across multiple GL accounts with validation (M)`
4. `Generic multi-select bulk actions bar (bulk approve, export, void) on invoice and journal tables (M)`
5. `Role-based override for period lock posting with dedicated audit logging (T146) (M)`
6. `Recurring sales invoices engine with automatic generation and schedule management (M)`
7. `Universal drill-down links from financial statement summary figures to underlying journals (M)`
8. `Customisable invoice templates with logo, header/footer text and field visibility options (M)`
9. `Scheduled payment reminder engine for overdue invoices and maturing cheques via SMS/email (M)`
10. `Polymorphic transaction attachments for invoices, bills, and payment receipts (M)`
11. `Tax-inclusive pricing mode on invoices and general supplier withholding tax deduction (M)`
12. `POS cashier shift close (Z-report) with cash drawer count and variance reconciliation (M)`
13. `Universal void-not-delete document lifecycle with auto-reversing entries and audit trail (T146) (M)`
14. `Dual-amount ledger and payment reconciliation realised FX booking with auto-reversing period revaluation (T138/T139) (L)`
