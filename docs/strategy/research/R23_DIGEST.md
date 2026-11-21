# R23 digest: CRM and ERP (sales, purchasing, stock, BOM, costing, POS) (2026-11-21)

Source: owner-run deep research, stage 1 plus a Persian stage 2 review. Figures marked
"requires primary check" must not be hardcoded. Facts and decisions are kept apart.

## Verified or stage-2-confirmed facts
- No full open-source CRM/ERP is safe to embed in a closed SaaS runtime: Twenty and Frappe CRM are
  AGPL-3.0, ERPNext is GPL-3.0 (browser JS distribution risk), Odoo Community is LGPL but gates
  accounting, barcode, shop floor and advanced POS behind Enterprise. Medusa v2 core is MIT.
- Permissive pieces usable at runtime: Temporal (MIT), GoRules ZEN (MIT), Typst (Apache-2.0),
  Mustangproject (Apache-2.0, stage 2 says re-check the licence file in CI), Dexie.js (Apache-2.0).
- German e-invoice: reception since 2025-01-01, issuance 2027-01-01 above EUR 800k turnover, 2028-01-01
  for the rest. German bookkeeping vouchers: retention is 8 years since BEG IV, 10 years only for
  ledgers and statements. A bill to raise it to 15 years is only proposed.
- PostgreSQL 19 went GA on 2026-11-19 (stage 2). We run 17: do not rely on 19 features.

## Proposed decisions
1. Keep the single Postgres modular monolith. No second ledger database in the first 18 months: an
   append-only ledger inside Postgres (triggers block UPDATE/DELETE, debit = credit check, outbox).
   This fits the R19 decision (hash chain on Postgres).
2. Non-retrofittable invariants before the first screen: separate `tenant_id` from `company_id`,
   FORCE RLS with tenant-first composite keys, double-entry `stock_move` plus a quant projection,
   normalized lot bundles with genealogy, catch-weight dual UoM, effective-dated prices/tax/BOM with
   exclusion constraints, frozen price/tax/FX snapshots on confirmed documents.
3. Landed cost posts in the current period (split remaining stock vs already-sold COGS); no
   retroactive repost of closed periods.
4. Wedge: one market first (default pack, then DE/DACH). Defer POS, France, Poland and FSMA.
5. Gapless document numbering per (company, doc type, channel, fiscal year), not one global lock.
6. PII kept in a separate vault with its own key so GDPR erasure does not fight ledger retention.

## Conflicts for the lanes to resolve
- Money type: R23 says `NUMERIC(p,s)` end to end; R24 says `BIGINT` minor units. Resolve against the
  R16 acceptance tests: ledger and unit costs need more than 2 decimals, payroll may stay minor units.
- Stage 2 (Persian) says offline POS and a cloud TSE contradict each other in Germany: a local or LAN
  TSE adapter is needed for real offline.
- Twenty CRM licence: already row #1059.

## Owner decisions
Which market wedge after the default pack (DE/DACH is the hub's default), and whether to buy a
certified-process review (IDW PS 880) before selling to German SMEs.

## Not verified
NetSuite POS end-of-life date (partner-reported only), Now-Next partition benchmarks (unverifiable),
all vendor prices.
