# R32 digest: customer data migration and onboarding (2026-11-21)

Raw: `docs/strategy/research/R32_RAW.md`. Web tools worked. Facts and decisions are kept apart.

## Verified facts
1. Repo already has hand-written readers (CSV with encoding sniff, XLS, XLSX, ODS, DBF, SQLite, SQL dumps not executed, PDF/OCR, ZIP) on `fflate` and `sql.js`, a dry run, bulk runner, reconciliation, Holoo/Sepidar profiles and a support matrix where "supported" needs a fixture and a test. No xlsx/csv parsing library in any package.json. (repo read, 2026-11-21)
2. Licences read from repo LICENSE files 2026-11-21: MIT = exceljs, PapaParse, node-csv, RapidFuzz, dedupe, Splink, charset_normalizer, python-calamine, frictionless-py, pandas (BSD-3), polars, DuckDB; Apache-2.0 = SheetJS repo, Fuse.js; chardet 7 = 0BSD (rewrite).
3. SheetJS: npm `xlsx` is stuck at 0.18.5; docs say install 0.20.3 from a tarball on cdn.sheetjs.com (docs.sheetjs.com, page dated 2026-08-03). Pinning and supply-chain cost.
4. calamine (Rust) is MIT and reads xls, xlsx, xlsm, xlsb, ods (github.com/tafia/calamine).
5. ERPNext import: template per doctype, insert/update modes, validation shown before import, column mapping, advice of a few thousand records per batch (docs.frappe.io). Odoo: Test step, External ID for re-link/update, imports cannot be undone (odoo.com docs, via search snippet).

## Proposed decisions
- D1: Keep own parsers; add libraries only for a real failing file (exceljs or python-calamine first; avoid SheetJS tarball).
- D2: Staging pipeline: raw -> normalised -> validated -> commit; dry run runs the real commit path in a rolled-back transaction.
- D3: Idempotent re-import by (tenant, source system, natural key) plus file hash; every created row carries `import_batch_id`; "undo batch" only while no downstream use and period open, else compensating entries.
- D4: Cutover wizard with blocking tie-outs: opening TB balances; AR/AP control = sum of open invoices/bills; inventory value = sum of FIFO layers x cost; bank balance = statement.
- D5: Pre-cutover period locked after sign-off; historical documents keep original numbers in a legacy series, never renumbered (fits R23 gapless numbering).
- D6: FIFO without history = one layer at cutover average cost, stated in the report; open POs/SOs import remaining quantity only; tax returns before cutover are not migrated silently.
- D7: Matching without ML: normalise (Persian/Arabic letters and digits, ZWNJ) -> exact on tax id/phone/IBAN -> RapidFuzz token_set_ratio with human review queue.
- D8: 2-week playbook with four activation events (first posted invoice, first bank reconciliation, owner opens a report, second user active); details in RAW section 6.

## Owner decisions needed
Migration free, paid package or free for first 5 pilots (default: free for 5 pilots, paid after). Whether LLM may suggest column mappings on masked headers and sample rows (default: yes, human approves, private-option tenants paid-no-log only).

## Conflicts
- Money type (NUMERIC vs BIGINT, R23/R24) affects unit-cost imports with more than 2 decimals and tie-out rounding.
- Older chardet was LGPL (memory, not re-verified); v7 is 0BSD: pin >= 7 or use charset_normalizer.

## Not verified
Xero primary help page (only 4 secondary guides agree); Odoo exact rule for existing External ID; openpyxl licence file; DuckDB as validation engine; all churn numbers from vendor blogs (90% in 3 days, 5% in 90 days, 22 min to value): do not use. Whether a cutover workflow exists elsewhere in the repo (grep by name only).

## Top missed risks (12 in RAW section 8)
Uploaded files are PII and need purge rules; staging tables need tenant RLS; calendar/locale guesses shift periods; re-import after go-live needs reversal flow; legacy numbers colliding with the new series and e-invoice ids; migration labour can swamp a two-person team; exit portability must match entry.

## Proposed GitHub rows
| Lane | Title | Done when |
|---|---|---|
| L2 | Import tie-out engine (TB, AR/AP, stock value, bank) | Spec fails an import whose control totals differ; report lists each difference in money terms |
| L2 | Import batch tagging, idempotent re-import and undo | Same file twice creates 0 new rows; undo removes a batch or posts reversals; pg spec with RLS |
| L2 | Cutover wizard: opening journal, period lock, legacy number series | Wizard blocks go-live until tie-outs green; lock verified by a posting attempt |
| L2 | Opening stock layers and open PO/SO import | One layer per batch or one average layer with note; inventory value = TB; partial POs keep received part |
| L2 | Mapping templates and per-entity blank templates | Saved versioned mapping reused on second upload; Persian/Arabic header aliases tested |
| L2 | Fuzzy duplicate queue for parties/items (RapidFuzz, no auto-merge) | Fixture with known duplicates: queue finds them, none merged without a click |
| L5 | Two-week onboarding playbook and health dashboard | Checklist in docs; dashboard shows the four activation events and days since last login per tenant |
| L5 | Raw upload retention and purge policy (30 days after sign-off) | Policy text reviewed by lawyer; purge job spec; mapping and report kept |
