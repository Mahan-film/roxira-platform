# Requirements status (audited 2026-11-01 against origin/main 9914fc10)

Scope: every coded requirement in `docs/research/2026-10-31/05-iran-compliance-1405-fa.md` (DTX, VAT, TPS, LDG, STD,
LAB, INS, PAY, QTR, RET, CHK) and `06-iran-software-market-fa.md` (E, I, N), plus every decision and roadmap item in
`docs/strategy/MASTER_PLAN_2026-10-31.md` and `IRAN_FIRST_ROADMAP_2026-10-31.md`.

How to read it. **done** = code and a test exist for the whole requirement. **partial** = part exists; the gap column
says what. **missing** = no code found. Evidence is a path under `output_apps/enterprise_hub/` unless it starts with
`docs/`, `scripts/` or `migrations/` (all relative to `output_apps/enterprise_hub/` for the last). Each row was checked by
reading or grepping the file on the audit date; "none" means a case-insensitive search of `modules/`, `migrations/` and
`frontend/src` found nothing. Statutory figures are not verified by this audit: see `docs/hr/STATUTORY_OPEN_ITEMS.md`.
Nothing here is marked done from memory of earlier sessions.

## Report 05: compliance (17 requirements)

| Code | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| DTX-01 | Corporate income tax, 10% effective-rate floor | missing | none | No tax computation, provision voucher or floor worksheet. Tax workbench is planned (PR below). |
| DTX-02 | Tax for business owners, civil partnerships | missing | none | Same. |
| DTX-03 | Rental income tax, Art. 57 exemption | missing | none | Same. |
| DTX-04 | 10% advance withholding on clinic doctors' fees | missing | none | `modules/hr/services/payroll-calculator.ts` is employee payroll only. |
| VAT-01 | VAT and levies on goods and services | partial | `modules/invoicing/constants/invoicing.constants.ts` (`DEFAULT_VAT_RATE = 0.1` in code), `modules/invoicing/invoicing.vat.spec.ts`, tenant default rate in `modules/invoicing/services/invoicing.service.ts` | Rate is hard-coded, not read from the statutory store (`vat_general_rate` exists, unverified: 10 vs 12 dispute). No levies, no special-goods rates. |
| VAT-02 | Input VAT credit and Karpoushe matching | partial | `modules/invoice_capture/` captures purchase documents with VAT fields | Seasonal report says purchases are not reported (`modules/tax_compliance/reports/seasonal-report.service.ts`). No Karpoushe matching. |
| TPS-01 | Moadian e-invoice types 1-3, seven patterns | partial | `modules/tax_compliance/services/moadian.service.ts`, `moadian-api.client.ts`, `processors/moadian.processor.ts`, `utils/moadian-packet.mapper.ts`, `jws.util.ts`, `moadian.spec.ts` | Submit and poll implemented; pattern coverage (seven patterns) and live-system proof not shown. Legal review still pending (master plan). |
| TPS-02 | Gold, contracting, export patterns | missing | none | No pattern-specific fields (grep for gold, export pattern). |
| LDG-01 | Electronic journal and ledger standard file | missing | none | No export of journal or ledger in a tax-system file layout. Planned (CSV). Official layout unverified. |
| STD-01 | Standard 43 revenue recognition | missing | none | No five-step model, contract or performance-obligation data. |
| STD-02 | Full statements, FX translation, deferred tax | partial | `modules/accounting/reports/statements.ts` and `statements.spec.ts` (balance sheet, income, cash flow, equity changes), `modules/accounting/accounting.fx.spec.ts` | No notes, no FX revaluation of balances, no deferred tax. |
| LAB-01 | Labour law pay, allowances, insurance deductions | partial | `modules/hr/services/payroll-calculator.ts`, `payroll-calculator.spec.ts`, `payroll-cumulative.spec.ts`, `payroll.pg.spec.ts` | Seniority is a monthly allowance; end-of-service benefit (sanavat) and leave settlement not built. Unverified rules in `docs/hr/STATUTORY_OPEN_ITEMS.md`. |
| INS-01 | Social Security list v6 (DSKKAR, DSKWOR) | partial | `modules/hr/services/insurance-list.ts`, `dbf-file.ts`, `payroll-exports.spec.ts`, `docs/hr/INSURANCE_LIST_EXPORT.md` | Both exports report `uploadReady: false`: column layout and code page need a real sample. |
| PAY-01 | WP and WH wage-tax files | partial | `modules/hr/services/wage-tax-files.ts`, `payroll-exports.spec.ts` | Same `uploadReady: false` caveat; official field spec not found. |
| QTR-01 | Seasonal transactions report (Art. 169), 5% threshold | partial | `modules/tax_compliance/reports/seasonal-report.service.ts`, `seasonal-report.repository.ts`, `controllers/seasonal-report.controller.ts`, `seasonal-report.spec.ts` | Sales only. No purchases, no threshold control, CSV is not the official layout (the report's own notes say so). |
| RET-01 | Annual and VAT returns | missing | none | `vat-seasonal` summary is a draft, not a return. VAT return data is planned. |
| CHK-01 | Sayad cheque lifecycle and reconciliation | partial | `modules/cheques/lifecycle/cheque-lifecycle.ts`, `cheques.lifecycle.spec.ts`, `cheques.service.spec.ts`, `dto/cheque.dto.ts` (`sayadNumber`, `sayadVerified`) | Lifecycle and postings done. No call to the central bank's Sayad system; `sayadVerified` is a manual flag. |

## Report 06: market feature matrix (16 requirements)

| Code | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| E-01 | Excel and DBF migration, fixed to floating mapping, UTF-8 fix | partial | `modules/data_import/readers/dbf.reader.ts`, `xls.reader.ts`, `readers/persian/text-decode.ts`, `universal-import.spec.ts`, `readers/persian.spec.ts` | Import only: no Excel export of accounts, parties, items, documents. No mapping to floating details (none exist). |
| E-02 | Account coding tree, floating detail levels, project and cost centres | partial | `modules/accounting/enums/accounting.enum.ts` (`AccountLevel`), `constants/iran-chart-template.ts`, `migrations/1789370000000-AddChartHierarchyAndFiscalYears.ts` | Four-level chart only. No floating details, cost centres, project centres or account attributes (tracking, FX, quantity). Planned. |
| E-03 | Moadian link, VAT, seasonal, insurance, wage-tax, monthly summary for books | partial | see TPS-01, QTR-01, INS-01, PAY-01 | Monthly book summary and VAT return missing. |
| E-04 | Auto voucher from invoice, manual and draft vouchers, cheques, auto reconciliation, POS and barcode | partial | `modules/invoicing/services/invoice-posting.service.ts`, `modules/accounting/controllers/accounting.controller.ts` (`POST journal-entries`), `modules/cheques/`, `modules/banking/recon/`, `frontend/src/components/accounting/journal-entry-form.tsx` | Manual entry posts straight to POSTED (`accounting.service.ts` `postEntry`); `JournalEntryStatus.DRAFT` is defined but never created. No temporary state. No POS or barcode. Stock-available/reserved view missing. Planned. |
| E-05 | Basic reports, 2/4/6/8 column trial balance, ledgers, statements, exports | done | `modules/accounting/controllers/reports.controller.ts`, `dto/report.dto.ts` (columns 2,4,6,8,10), `services/report-export.service.ts`, `reports/xlsx-writer.ts`, `reports/pdf-writer.ts`, `financial-reports.pg.spec.ts` | Export is XLSX and PDF; Word, Text, XML not offered. Stock card not in accounting reports. |
| E-06 | Speed, backups, resilience, read-only old period | partial | `modules/accounting/controllers/accounting.controller.ts` (`period-locks`), `migrations/1789320000000-LedgerPeriodLocksAndGuards.ts`, `scripts/ops/backup/` (offsite scripts), `accounting.large-ledger.spec.ts` | Period lock done. Continuous WAL archive not shown; backup restore drill not proven here. |
| I-01 | BOM, multi-stage production, overhead allocation | missing | none | Master plan defers light BOM to day 90+. |
| I-02 | Tree item coding, dual unit, serial, reorder point, quarantine | partial | `modules/inventory/` (items, warehouses, FIFO batches, valuation) | No tree coding, dual unit, serial or warranty, reorder point, quarantine. Weighted average not offered (FIFO only). Owned by another session. |
| I-03 | Visitor app, field sales, GPS, commission | missing | none | Not started; growth stage. |
| I-04 | Contracting, payroll, fixed assets and depreciation | partial | payroll: `modules/hr/`; chart has fixed-asset and accumulated-depreciation lines (`iran-chart-template.ts`) | No asset register, no depreciation schedule or voucher, no contractor statements. Fixed assets planned. |
| I-05 | Interactive account browsing, advanced search, ageing, cash flow, report builder | partial | ledger drill-down `frontend/src/components/accounting/account-ledger-panel.tsx`; cash flow `reports/statements.ts` | Ageing service built (#79), endpoint and UI pending. No amount or cheque search, no report builder. |
| N-01 | Multi-branch, holding, web access | partial | branches and departments `modules/access/entities/branch.entity.ts`, `department.entity.ts`; multi-tenant web app | No consolidation of statements across companies, no per-branch ledger dimension. |
| N-02 | Multi-currency, bilingual reports, import files | partial | `modules/accounting/accounting.fx.spec.ts`, `modules/currency/`, `migrations/1789220000000-AddFxMultiCurrencyCore.ts` | No bilingual reports, no import-file management, no revaluation. |
| N-03 | API, shop connectors, CRM, payment gateways | partial | OpenAPI controllers throughout; `modules/crm/` | No WooCommerce or WordPress plugin, no gateway integration, no webhooks. |
| N-04 | Attachments, edit log, concurrent edit lock, budgeting | partial | hash-chained organisation audit `modules/access/services/audit.service.ts` (`GET audit/verify`), ledger immutability and reversal `accounting.service.ts` `reverseJournalEntry` | No attachments on vouchers (only on reconciliation items, `modules/banking/recon/recon.controller.ts`), no edit lock, no budgets. |
| N-05 | Kalaberg link, weighing, kiosk, SMS bank transaction extraction | missing | none | `modules/banking/recon/parse/statement-parser.ts` parses statements, not SMS. |

## Master plan (2026-10-31): decisions

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Modular suite: ledger, invoicing, tax, treasury, stock, payroll, copilot | partial | `modules/` directories for each | Firm hub, manufacturing, fixed assets missing. |
| Keep NestJS monolith with BullMQ and FastAPI workers | done | `app.module.ts`, `processors/` in tax_compliance, data_import | Decision, not a deliverable. |
| One deterministic assistant graph, certified numbers, abstain without evidence | partial | `modules/assistant/` (tools service, LLM service, specs) | 25 certified metrics and numeric validator not verified present. |
| Postgres-native memory with forced RLS | partial | forced RLS in 4+ migrations (`FORCE ROW LEVEL SECURITY`); episodic and bitemporal memory: none | Memory tables missing; RLS rollout owned by another session. |
| Autonomy L0 to L3, document text untrusted | partial | `modules/invoice_capture/` (review queue, vendor rules) | Level model not codified in code. |
| Import: sandboxed parsing, Parquet, DuckDB, dry run, signed report | partial | `modules/data_import/` (readers, hostile fixtures, reconciliation, dry-run preview, undo) | No R2 multipart direct upload, no Parquet or DuckDB, no signed report. Owned by another session. |
| Single vector store | not assessed | n/a | Not an accounting item. |
| Privacy: masking proxy, provider allowlist | partial | `modules/data_import/masking.ts`, `modules/banking/recon/classify/mask.ts` | Provider allowlist by data class not found in `modules/`. |

## Master plan: roadmap

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Stabilise: merge queue, disk, move uploads and backups, WAL to R2 | partial | `scripts/ops/backup/neon_offsite.sh` | WAL archive to R2 not shown. |
| Isolation: tenant context, forced RLS, non-owner role, composite indexes, isolation tests | partial | `scripts/ops/db_app_role.sh`, `modules/*/*.tenant.spec.ts` | Remaining tables owned by RLS session; Persian normalisation exists in import (`readers/persian/`). |
| Four-level chart | done | `modules/accounting/constants/iran-chart-template.ts`, `services/chart-template.service.ts` | |
| Jalali fiscal years and year close | done | `modules/accounting/services/fiscal-year.service.ts`, `fiscal-close.pg.spec.ts` | |
| 2 to 10 column trial balances | done | `dto/report.dto.ts` | |
| Balance sheet, profit and loss, cash flow | done | `reports/statements.ts`, `statements.spec.ts` | |
| Ageing | partial | `modules/accounting/reports/ageing.ts`, `ageing.spec.ts`, `accounting.ageing.spec.ts`, `FinancialReportsService.ageing` | Receivable and payable ageing per account and party, FIFO, by document date (#79). No HTTP endpoint or UI yet; no due dates, so not days overdue. |
| Cost centres | missing | none | Planned. |
| Hash-chained audit log | partial | `modules/access/services/audit.service.ts` | Covers organisation actions; ledger changes not chained. |
| Effective-dated statutory parameters | done | `modules/hr/statutory/`, `migrations/1789410000000-CreateStatutoryParameters.ts`, `statutory.pg.spec.ts` | Values unverified; catalogue is payroll plus one VAT key. |
| Tamin list disk v6 | partial | see INS-01 | |
| Property tests for ledger invariants | missing | `modules/accounting/accounting.ledger-integrity.spec.ts` is example-based; no `fast-check` in `package.json` | |
| Import stage (R2 multipart, sandbox, encodings, Sepidar playbook, mapping memory, reconciliation) | partial | `modules/data_import/`, `migrations/1789400000000-CreateImportMappingMemory.ts` | Sepidar playbook: none; others per above. |
| Assistant stage (metrics, memory, validator, investigator, close copilot, voice) | partial | `modules/assistant/`, `modules/invoice_capture/` | Others not found. |
| Growth stage (firm hub, open banking, POS bridge, public API, shop connectors) | missing | none | |
| Later: light manufacturing, fixed assets, contractor accounting, international tax | missing | none | Fixed assets planned. |

## Iran-first roadmap stages

| Stage | Status | Evidence | Gap |
|---|---|---|---|
| 1 Foundation: tax, cheques, bank reconciliation, import, reports, petty cash | partial | `modules/cheques/`, `modules/banking/`, `modules/data_import/`, `modules/accounting/reports/`, `petty-cash.pg.spec.ts` | "Tax" is a seasonal VAT draft only. Upload-to-balanced-statements sample run not proven. |
| 2 Compliance: Moadian, Tamin, payroll, statutory parameters | partial | see TPS-01, INS-01, PAY-01 | Each rule's source, date and test not yet complete; many flags unverified. |
| 3 Requirements audit | partial | this document | Gaps become issues with acceptance tests. |
| 4 Global core (multi-book, calendars, packs) | missing | `AGENTS.md` country packs: none | Single `country` column in statutory store only. |
| 5 First foreign pack | missing | none | Owner choice pending. |
| 6 More packs | missing | none | |

## Implementation order for this session

1. Manual voucher with draft, temporary and final states.
2. Floating detail accounts, cost centres, project centres.
3. Fixed assets and depreciation.
4. Article 169 seasonal report: purchases and threshold.
5. Electronic ledger and journal CSV export.
6. VAT return data and tax workbench.

Rates and thresholds go through `statutory_parameters` with `verified = false` until checked against an official text.
