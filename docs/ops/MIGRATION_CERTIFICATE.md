# Migration reconciliation certificate (phase 2, step 3)

Issue #355. Input: the typed staging Parquet from `docs/ops/MIGRATION_TRANSFORM.md`. Engine: `services/migration_worker/certificate.mjs`
(JSON). PDF: `output_apps/enterprise_hub/modules/data_import/migration/certificate/` (Persian, Vazirmatn, same writer as the
accounting reports). Nothing here posts anything: it proves, or refuses to prove, that the staged data equals the source.

## What it checks (all in integer rials, rounded half away from zero from the DECIMAL(28,4) staging values)
1. **Trial balance to the rial.** The source trial balance (`gl_trial_balance`) against the ledger the staged vouchers would
   produce (`gl_lines`), per account. Each difference is routed to the **حساب واسط توازن افتتاحیه** (`OB-SUSPENSE`): the
   correction goes to the account, the opposite side to the suspense account, so the opening trial balance equals the source.
   Every difference lists the source documents that can explain it (unbalanced vouchers touching that account: source
   table, voucher number, first source row). Also reported: total debit vs credit of the migrated lines, unbalanced
   vouchers, account codes used in vouchers but absent from the chart.
2. **AR/AP and cheques in transit.** Open-item totals by kind (AR/AP; sign is used and flagged `kindInferred` when the source
   has no kind) and in-transit cheques (statuses meaning collected, passed, returned or cancelled are excluded; "در جریان
   وصول" is in transit; unknown statuses count as in transit), each against the **control accounts the customer designates**
   (`control: { ar, ap, chequesReceivable, chequesPayable }`). Without a designated account the check is shown as not run.
3. **Stock per item and warehouse.** Quantity and **FIFO** value from the staged movements (layers consumed oldest first,
   computed with window functions so millions of movements stay in DuckDB) against the source stock balances
   (`stock_balances`). Items that went negative (even if they recover) or end negative are listed with a proposed
   adjustment quantity and the last known unit cost. Stock value is only compared when the source has a value column.
4. **Rejected rows.** Source table and row of everything that could not be typed (see the transform doc).

`status`: `blocked` (any blocking reason: no source trial balance, unbalanced migrated lines, unknown accounts, a control
account that differs, stock differences), `differences-routed-to-suspense` (only trial-balance differences, all routed) or
`clean`. Blocking reasons are Persian in the PDF.

## Nothing goes live before approval
`canGoLive(certificate, approval)` refuses unless the customer approved **this exact certificate** (`contentSha256` of the
JSON), the status is not `blocked`, and, when amounts were routed to suspense, the customer explicitly accepted that.
A changed certificate invalidates an earlier approval. This is the rule the post step must call.

## Not done (so the feature is not live)
- Wiring: a job that runs the worker after upload, stores the certificate JSON and PDF in object storage, an API to read it
  and to record the approval (a tenant-scoped table with FORCE RLS needs its own migration PR), and calling `canGoLive`
  from the bulk post. The worker CLI does not yet write `certificate.json`; `buildCertificate()` is the function to call.
- Posting the suspense and correction entries into the ledger (needs the accounting module's opening-balance API).
- The "migrate opening balance plus open items and the current year, archive older years as Parquet" option is a posting
  decision for the wiring step; the certificate already works on whatever subset is staged.
- Cross-currency, multi-fiscal-year trial balances and per-party AR/AP (only totals per kind are compared today).

## Tests
Worker: 5 certificate tests on synthetic data (rial rounding, suspense and the named unbalanced voucher, FIFO quantity and
value, negative stock, cleared vs in-transit cheques, AR control difference, every blocking reason, approval guard).
enterprise_hub: 2 tests (tables, a real PDF written to `$CERT_PDF_OUT`; checked visually: Persian shaping and RTL amounts render).
`pdf-writer.ts` now lays out each table separately (tables of different column counts in one file); existing report tests pass.
