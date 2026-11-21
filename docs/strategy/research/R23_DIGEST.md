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

## Second opinion (Gemini Deep Research, 2026-11-22)

Saved unchanged in `R23_GEMINI.md` (Stage 1 and a Persian Stage 2; Stage 1 was pasted twice, both copies identical). This section does not replace anything above. Rule used: where the two sides conflict, the claim with a primary URL and a date wins; everything else is UNVERIFIED until a lane reads the page. Note: Gemini's Stage 2 corrects several Stage 1 claims, and this digest already follows Stage 2. `R23_RAW.md` is not on main, so "only one side" was checked against this digest only. Gemini's Stage 2 sources are mostly secondary (blogs, partner pages); none was re-read.

### Agreements
- Licences: Twenty and Frappe CRM AGPL-3.0, ERPNext GPL-3.0, Odoo Community LGPL with paywalled accounting/POS; Medusa core, Temporal, GoRules ZEN, Typst, Dexie permissive. Gemini Stage 2 says Mustangproject, Typst, Dexie and Lerian Midaz licences were not re-read from the LICENSE files and must be locked by a CI scan (same as this digest).
- German e-invoice dates (reception 2025-01-01, issuance 2027-01-01 above EUR 800k, 2028-01-01 for the rest). Voucher retention is 8 years since BEG IV, 10 years for ledgers; the 15-year bill is only proposed (Stage 2 corrects Stage 1, which said 10 years for POS records).
- PostgreSQL 19 is GA (2026-11-19); Stage 2 corrects Stage 1's "Beta 1".
- Single Postgres modular monolith, append-only ledger inside Postgres, no second ledger database in the first 18 months (Stage 2 recommendation; Stage 1 still listed Formance/Blnk/TigerBeetle as options).
- Wedge: one market first (DE/DACH), defer POS, France, Poland, FSMA.
- Gapless numbering per (company, doc type, channel, fiscal year); PII in a separate vault with its own key; offline POS conflicts with a cloud TSE (needs local/LAN TSE); Now-Next partition numbers unverifiable.
- The seven schema invariants (tenant vs company, FORCE RLS with tenant-first keys, double-entry stock_move plus quant, lot bundles and genealogy, catch-weight, effective-dated rows, frozen snapshots) and current-period landed-cost split.

### Conflicts
| Topic | This digest | Gemini | Verdict |
|---|---|---|---|
| Money type | NUMERIC vs R24 BIGINT unresolved | NUMERIC(p,s) everywhere; rejects 32-bit integer minor units (overflow ~21.47M at 2 decimals); never discusses BIGINT | Does not settle it. Row #1067 decides against the R16 tests. |
| Postgres 19 now | We run 17; do not rely on 19 features | Stage 2 plan: deploy PG 19 in month 1 and use WITHOUT OVERLAPS and FOR PORTION OF; Stage 1: EXCLUDE constraints on 15-17, native on 18+ | Digest stands. GA date is a vendor-news claim; the upgrade is an ops decision (see #1129 PG 18 rehearsal). Exclusion constraints work on 17. |
| ZUGFeRD version accepted | not stated | Stage 1: 2.2+; Stage 2: 2.0.1+ except MINIMUM and BASIC-WL profiles (secondary source, 8 Nov 2026) | UNVERIFIED. Matters for #1068; check the BMF letter and the validator. |
| France e-invoice grace | France deferred | Stage 1: automatic penalty deferral to 31 Dec 2026; Stage 2: no automatic grace, conditional leniency only (SEEBURGER blog, 17 Sep 2026) | UNVERIFIED (blog). Irrelevant until France is in scope. |
| NetSuite POS end of life | not verified | Stage 2: retirement announced Feb 2026, support ends 31 Jan 2029, partner-reported only | UNVERIFIED, as Gemini itself says. |
| Engineering cost | none | Stage 2: EUR 380-550k (option B) vs 650-950k, infra EUR 1.2-2.8k/month | UNVERIFIED estimates, no source. Not for planning. |

### Only one side has it
- **Gemini only:** per-tenant point-in-time restore under shared-table RLS; OLTP vs reporting/MRP load (read replica or OLAP layer); European bank connectivity (PSD2 AISP/PISP, FinTS, CAMT.053, PAIN.001); MCP/AI prompt-injection, human approval for financial writes, metering; localization depth (SKR03/04, PCG, FEC, OSS, reverse charge); IDW PS 880 and GoBD process document as a tax-advisor gate; French self-certification liability (up to 15% of revenue, secondary source); Poland KSeF dates; FSMA 204 date 20 Jul 2028; German restaurant VAT 7% from 2026; ELSTER cash-register registration; Odoo 20 pricing and a EUR 7.90 Light User tier; revisit triggers (5,000 TPS, 1 billion journal lines, 30% offline-POS demand). All UNVERIFIED here.
- **Digest only:** Twenty licence row #1059; the R16 acceptance-test route to settle the money type; the R19 hash-chain fit.

### Row changes
- No new row. Import and cut-over are already covered by R32 rows (#1148, #1149, #1151). Comments to be added: #1067 (money type: Gemini's NUMERIC argument, no BIGINT view), #1068 (ZUGFeRD 2.0.1+ detail UNVERIFIED; Mustangproject sidecar default), #1071 (Gemini's allowlist MIT/Apache-2.0/BSD/ISC/CC0, check Midaz, Mustangproject, Typst, Dexie LICENSE files), #1110 (per-tenant restore gap), #1129 (Stage 2 assumes PG 19).
- Not covered by any row found: bank connectivity, OLTP/OLAP split, AI/MCP prompt-injection for CRM actions (partly #1056 for HR). Left as expert questions, no issue opened.

### Owner decisions (not for agents)
- Market wedge after the default pack (DE/DACH is the hub default), already listed above; Gemini Stage 2 agrees.
- Whether to buy an IDW PS 880 review, or start with a DATEV export plus a GoBD process document (Gemini default: process document first, review after about 50 paying customers).
- Whether and when to move from PG 17 to 19.

### Expert questions added (default in brackets)
1. Where is the legal line between GDPR erasure and AO section 147 retention for customer PII on archived invoices? [PII vault with per-party key; keep only legal name and tax id on the invoice snapshot]
2. Is Mustangproject as a JVM sidecar worth its upkeep versus a paid e-invoice API? [sidecar for XML/PDF generation and validation; paid API only for network delivery]
