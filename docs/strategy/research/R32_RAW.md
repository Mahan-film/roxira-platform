# R32 RAW: customer data migration and onboarding (2026-11-21)

Method: web tools worked. Licence claims checked on raw repo LICENSE files (raw.githubusercontent.com, 2026-11-21).
Repo state read-only from `output_apps/enterprise_hub/modules/data_import`, `docs/IMPORT_SUPPORT.md`, R23/R9/R16 digests.
Marks: VERIFIED (primary URL + date), CHANGED, UNVERIFIED.

## 1. What already exists in the repo (VERIFIED by reading files)
- `data_import` has hand-written readers (CSV with encoding sniff UTF-8/UTF-16/Windows-1256, TSV, fixed-width, JSON, XML without DTD,
  HTML-as-xls, XLS BIFF8, XLSX, ODS, DBF, SQLite, SQL dumps tokenised not executed, PDF/OCR review, ZIP packages), built on `fflate` and `sql.js`.
  No `xlsx`/`exceljs`/`papaparse` dependency found in any package.json (grep). So library choice below is for gaps, not a rewrite.
- `support-matrix.ts` is the single source of truth: a row may be `supported` only with a fixture and a test. Good pattern; keep.
- Dry run exists (`import-dry-run.spec.ts`, `.pg.spec.ts`), bulk import runner/processor/repository (`bulk/`), reconciliation
  (`analysis/reconciliation.ts`), source profiles for Holoo and Sepidar (Iranian packages, synthetic fixtures only), tenant export, hostile-file tests.
- `onboarding` module exists but is small (one service). Opening-balance code exists only inside accounting ledger reports; there is no
  guided cutover workflow (UNVERIFIED that none exists elsewhere: grep was by name only).
- R9 already plans marketplace-settlement import and an SVDP catch-up import; R16 test 9 requires bank import idempotency after 24 h.

## 2. How SMEs really migrate (mostly UNVERIFIED practice knowledge; vendor docs below are VERIFIED)
Typical sources: a messy Excel workbook per topic (customers, items, stock count, open invoices), a trial balance PDF/Excel from the old
package or the accountant, bank statements, and sometimes a database file. Recurring failures:
1. Wrong cutoff: stock count date differs from ledger date, open invoices listed as of another day, so AR/AP control accounts do not tie to the sub-ledger.
2. Trial balance does not balance, or uses closed-year retained earnings vs opening-year P&L mixed together.
3. Open documents entered as one lump sum instead of per invoice: ageing and reminders break, payments cannot be matched.
4. Duplicate parties (same customer with spelling, tax id and phone variants); item codes reused with different units; leading zeros lost in Excel (tax ids, SKUs, phone numbers).
5. Dates and numbers: mixed calendars (Gregorian/Jalali), text dates, decimal comma vs point, thousands separators, Arabic vs Persian digits and letters, negative numbers in brackets, currency symbols in cells.
6. Hidden sheets, merged cells, totals rows inside data, multi-row headers, formulas without cached values, links to other workbooks.
7. Stock: negative quantities, quantity without cost, no layer history so FIFO starts "flat" (one layer at average cost).
8. Customer expects "everything" (5 years of history); history import makes cutover slow and error-prone.

VERIFIED vendor practice:
- Xero (secondary guides; Xero's own help page could not be fetched): conversion date = go-live; enter only unpaid invoices/bills before it;
  trial balance as of the day before conversion; Xero will not save conversion balances until AR/AP tie to the unpaid documents; setting the
  conversion date auto-sets a lock date; changing the date later is hard. Sources: digit.business/insights/xero/xero-conversion-balances-setup-guide,
  outbooks.co.uk conversion page, chargebee lock-date page (all via search, 2026-11-21). Status: UNVERIFIED against Xero primary; pattern is consistent across 4 guides.
- ERPNext data import (docs.frappe.io/erpnext/user/manual/en/data-import, 2026-11-21): template download per doctype, insert vs update mode,
  upload then on-screen validation grouped by row/column, must fix all warnings before import, column mapping, "submit after import",
  recommends a few thousand records per import; page does not describe dry run or rollback.
- Odoo import docs (odoo.com/documentation/19.0/applications/essentials/export_import_data.html, via search 2026-11-21): "Test" step before import,
  External ID column for update/relinking, imports are permanent and cannot be undone, filter by created/last-modified to find what an import changed, batch large files.
  Gap: exact rule on existing External ID not stated in results.

## 3. Import tooling patterns (recommendations; supported by section 2 sources)
- Staging first: file -> raw rows table (immutable, hash of file) -> normalised rows -> validated rows -> commit. Never write to ledgers from the parser.
- Dry run = full commit path in a transaction that rolls back (or a shadow tenant), not a separate simplified validator. The report shows counts
  (create/update/skip/error), money totals vs control totals, and per-row error codes with a downloadable annotated file.
- Idempotency: stable natural key per entity + source system id (like Odoo External ID) stored on the row; re-import = upsert; re-import of the
  same file hash returns the previous report. Keys: customer tax id or source id; item code + unit; invoice number + party + date.
- Rollback: tag every created row with `import_batch_id`; "undo batch" allowed only while no downstream document references it and the period is open;
  otherwise reverse by compensating entries (ledger is append-only, R23). Odoo has no undo, so this is a differentiator.
- Mapping templates: saved per (tenant, source system, file kind) with header aliases (Persian/English/Arabic-letter variants), unit and tax-code
  maps, account maps; versioned; exportable. Offer a downloadable blank template per entity with example row and a "known mistakes" sheet.
- Validation severity: blocker (cannot commit), warning (commit allowed with acknowledgement), info. Two-pass: structural (types, required) then business (tie-outs).
- Evidence: keep the original file and the mapping used for audit (retention follows R23 voucher rules; PII in file goes to the vault).

## 4. Cutover rules (recommendations; legal retention parts need an accountant)
Accounting:
1. Choose cutover date = start of a fiscal period; opening trial balance as of the previous day; period before cutover locked by period lock after balance check.
2. Opening journal: one dated entry (or set per ledger) debit = credit, flagged `opening`, excluded from P&L turnover reports, source = import batch.
3. AR/AP control accounts are not typed in: they are derived from imported open invoices/bills; opening journal must equal sub-ledger sums (tie-out blocker).
4. Bank: opening balance from the statement of the cutover day; uncleared items imported as open reconciling items.
5. Fixed assets: cost, accumulated depreciation, depreciation start per asset (tie to TB). Prepaids/accruals as lumps with a schedule if needed.
6. Tax: opening VAT/withholding balances and unfiled periods are NOT migrated silently: flag that returns before cutover stay in the old system or are filed by the accountant.
7. Gapless numbering (R23 decision 5): imported historical documents keep their original numbers in a separate "legacy" series; new series starts at configured next number; never renumber.
Inventory:
1. Stock count at cutover date, by location/lot; quantities and unit cost. FIFO layers: import one layer per receipt batch when history exists, else one layer at the cutover average cost with date = cutover (state the limitation in the report: COGS of old stock uses that cost).
2. Inventory value in opening TB must equal sum(layers x cost): tie-out blocker; the difference goes to a named adjustment account only with an accountant's sign-off.
3. Open POs and open sales orders: import remaining (unreceived/undelivered) quantity only; partially received POs keep the received part in stock layers; price/tax frozen snapshot at import time (R23 non-retrofittable invariants).
4. Goods in transit and consignment: separate location; never in main stock.
5. Freeze window: no stock movement in the old system between count and go-live, or import the delta as a second batch (documented delta import).
6. Landed cost on opening stock: not retro-posted (R23 decision 3).

## 5. Libraries (licences read from repo LICENSE files, 2026-11-21)
| Library | Use | Licence (file) | Verdict |
|---|---|---|---|
| exceljs 4.4.0 | xlsx read/write streaming | MIT (LICENSE, package.json) | OK; maintenance state UNVERIFIED |
| SheetJS community | xlsx/xls read | Apache-2.0 (repo LICENSE) | CHANGED: npm `xlsx` frozen at 0.18.5; docs say install 0.20.3 from cdn.sheetjs.com tarball (docs.sheetjs.com, page dated 2026-08-03). Supply-chain and pinning cost; prefer existing own parsers |
| PapaParse 5.7.1 | CSV (browser/Node) | MIT | OK |
| csv-parse (node-csv) | CSV streaming | MIT | OK |
| python-calamine | fast Excel/ODS read (Rust) | MIT (LICENSE); upstream calamine README says MIT | OK for Python sidecar |
| openpyxl | xlsx | licence file not fetched | UNVERIFIED (believed MIT) |
| xlrd | legacy xls | BSD-style (LICENSE has two parts) | OK-ish, read both parts |
| pandas | frames | BSD-3 | OK |
| polars / duckdb | big CSV/Parquet SQL | MIT / MIT | OK; DuckDB useful as validation engine (SQL checks over staged files) UNVERIFIED in our stack |
| RapidFuzz | fuzzy match Python | MIT | OK, first choice |
| fastest-levenshtein | distance JS | MIT | OK |
| Fuse.js | fuzzy search JS | Apache-2.0 | OK (search, not record linkage) |
| dedupe (dedupeio) | record linkage with active learning | MIT | OK but needs human labels; heavy |
| Splink | probabilistic linkage | MIT | OK for large dedup; overkill for SMEs |
| charset_normalizer | encoding detect | MIT | OK |
| chardet 7 | encoding detect | 0BSD (LICENSE + README) | CHANGED: older chardet was LGPL; v7 rewrite is 0BSD; pin >=7 |
| frictionless-py | table schema validation | MIT | OK |
| csvkit | CLI | MIT | dev tool only |
| qsv | CSV CLI | MIT/Unlicense dual (LICENSE-MIT present) | dev tool only |
Matching recipe (no ML): normalise (NFKC, Persian/Arabic letters and digits, strip spaces/ZWNJ, lowercase) -> exact on tax id/phone/IBAN ->
RapidFuzz token_set_ratio on names with threshold plus a human review queue; never auto-merge below a high threshold.

## 6. Two-week onboarding playbook (recommendation)
Day 0 (sales->success handoff): scope sheet = which modules, cutover date, source systems, who owns data, accountant contact.
Days 1-2: kickoff 45 min; send per-entity templates and a "what to export from your old system" guide; create tenant, roles, chart of accounts template, tax/pack settings.
Days 3-5: customer sends files; we dry-run, send the validation report; goal: first dry run within 3 working days of receiving files.
Days 6-8: fix round; import parties, items, opening stock layers, open invoices/bills, opening TB; tie-outs green; accountant signs off.
Day 9: lock pre-cutover period; first real invoice/bill posted by the customer with us watching (activation event 1).
Days 10-12: bank statement import and reconcile one month; first report reviewed (activation event 2); train 1-2 users 30 min each.
Day 14: go-live check: checklist, owner of daily tasks named, next review at day 30. Parallel run only for payroll/tax filings that cannot be undone.
Activation events (propose): first posted sales invoice, first bank reconciliation, first report opened by the owner, second user active.

First-90-day churn signals (sources are vendor blogs: UNVERIFIED numbers; qualitative pattern consistent):
- No login/event within first 3-7 days; long gap between kickoff and first customer login; activation milestone not reached in week 1.
- Import stuck: dry run not green by day 10; repeated re-uploads; tie-outs never reconcile.
- Only one user active; accountant not invited; no recurring weekly events by week 4.
- Support tickets of type "numbers differ from old system" in first 30 days; export requests of full data (exit signal).
- Billing: card failures or unpaid first invoice; request to cancel before first period close.
Track medians per cohort, not means (Meltingspot/Userpilot-type sources, UNVERIFIED benchmarks). Do not copy their numeric thresholds.

## 7. STAGE 2 re-check table
| Claim | Source | Date | Status |
|---|---|---|---|
| exceljs, PapaParse, node-csv, RapidFuzz, dedupe, Splink, charset_normalizer, python-calamine, frictionless MIT | raw LICENSE files | 2026-11-21 | VERIFIED |
| SheetJS repo Apache-2.0; npm stale at 0.18.5; CDN 0.20.3 | LICENSE + docs.sheetjs.com | 2026-08-03 page | VERIFIED |
| chardet 7 is 0BSD | chardet LICENSE/README | 2026-11-21 | VERIFIED (CHANGED vs older LGPL, from memory UNVERIFIED) |
| Fuse.js Apache-2.0 | LICENSE | 2026-11-21 | VERIFIED |
| calamine MIT, reads xls/xlsx/xlsm/xlsb/ods | github.com/tafia/calamine README | 2026-11-21 | VERIFIED |
| ERPNext import features | docs.frappe.io | 2026-11-21 | VERIFIED |
| Odoo test step, External IDs, no undo | odoo.com docs (search snippet) | 2026-11-21 | VERIFIED via snippet only |
| Xero conversion rules | third-party guides | 2026-11-21 | UNVERIFIED primary |
| Churn numbers (90% in 3 days, 5% in 90 days, 22 min TTV) | vendor blogs | n/a | UNVERIFIED, do not use |
| openpyxl licence, DuckDB fit | not checked | n/a | UNVERIFIED |

## 8. Missed risks (12-24 months), at least 10
1. Customer data in uploaded files is PII/financial: retention, deletion after migration (30-day purge of raw uploads) and GDPR erasure vs ledger retention.
2. Malicious files: zip bombs, XXE, formula injection (=cmd) when we re-export; hostile-file tests exist, keep them in CI per new format.
3. Tenant isolation in staging tables: staging rows need tenant_id + RLS like ledger tables (AGENTS rule 4).
4. Calendar and locale: Jalali vs Gregorian, Hijri for Gulf, German decimal comma; one wrong guess silently shifts periods.
5. Currency and rounding: imported unit costs with more than 2 decimals vs money type conflict R23/R24; rounding differences break tie-outs by cents.
6. Large imports (100k+ invoice lines) vs Postgres load, queue backpressure and the "few thousand per batch" rule seen in ERPNext docs.
7. Support cost: each migration is a human service; without self-serve reports it consumes the two-person team. Price a paid migration package.
8. Accountant as gatekeeper: sign-off needs a role and an audit trail; liability wording in terms.
9. Source-system formats change (Holoo/Sepidar versions, Xero/QuickBooks export layouts): fixtures go stale; support matrix needs a "last verified" date per row.
10. AI/LLM-assisted column mapping leaks customer data to models: AGENTS rule says free models may see data, but private-data-option tenants must use paid-no-log; also mapping must be deterministic after approval.
11. Re-import after go-live (customer fixes old data): conflicts with posted documents; need "supersede by reversal" flow, not overwrite.
12. Gapless numbering collisions: legacy numbers overlapping the new series in the same fiscal year; e-invoice authorities (MyInvois, German XRechnung) require unique ids.
13. Opening stock with tax: import VAT status of stock (input VAT already claimed) for packs that need it.
14. Exit: if migration in is a selling point, migration out (tenant-export exists) must be as good; regulators in EU expect portability.
15. Idempotency when customers rename columns or add rows between re-uploads: key stability, hash of file is not enough.

## 9. Decision pack
| Option | Effort | Cost | Reversibility |
|---|---|---|---|
| A. Keep own parsers, add cutover wizard + tie-out engine + import batch undo (recommended) | M (4-6 weeks) | no licence cost | high |
| B. Add SheetJS/exceljs/calamine as extra xlsx reader | S | supply-chain pinning (SheetJS) | high |
| C. Buy/embed a hosted importer (e.g. commercial widgets) | S | monthly fee, data leaves | medium; breaks zero-cost rule; not evaluated |
| D. White-glove only (we do it by hand) | high per customer | team time | high; does not scale |
Recommendation: A plus D for the first 5 customers, B only if a real file fails.
Timeline: month 1 = tie-out engine + dry-run report v2 + templates; month 3 = cutover wizard (accounting + inventory layers), batch undo, mapping templates saved; month 6 = fuzzy dedupe queue, source-system profiles refreshed, onboarding health dashboard; month 12 = self-serve migration for the top 3 source systems, paid migration package priced from real hours.
Revisit trigger: more than 3 of the first 10 customers need manual fixes after dry run, or support hours per migration above 8 h, or any tie-out dispute after lock.
Cost: one-off engineer time only; monthly near zero (queue/CPU); possible hosted importer fee if C is chosen.

## 10. Open questions for experts (default)
1. Accountant: may imported historical documents sit in a legacy series while the new series continues? Default: yes, separate series, never renumber.
2. Accountant/tax: what is the minimum opening data per country pack (default pack, DE)? Default: TB + open AR/AP + stock + fixed assets; VAT periods stay with the accountant.
3. Lawyer: retention and deletion of customer upload files after migration. Default: raw files purged 30 days after sign-off, mapping and report kept as evidence.
4. Owner: is migration a free service, a paid package, or free for first N customers? Default: free for the first 5 pilot customers, paid package afterwards (business decision is the owner's).
5. Security: may LLM suggest column mappings on customer files? Default: only on headers plus 3 masked sample rows, free tier allowed, private-option tenants paid-no-log, human approves.
6. Accountant: acceptable FIFO simplification when no layer history exists (one layer at average cost)? Default: yes with written note in the opening report.
