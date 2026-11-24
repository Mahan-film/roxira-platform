# R23 Core Ledger Gap Check & Money Type Settlement (T270)

> Source issue: #1067 (T270)
> References: `docs/strategy/research/R23_DIGEST.md`, `docs/strategy/research/R24_DIGEST.md`, `docs/strategy/research/R16_ACCEPTANCE_TESTS.md`
> Author: Lane L5 (Core Ledger)

---

## 1. Executive Summary

This document performs an exhaustive gap analysis of Roxira's core ledger implementation (T177–T185) against the 10 structural architectural invariants defined in `R23_DIGEST.md`. It formally resolves the architectural conflict between `NUMERIC(p,s)` (R23) and `BIGINT` minor units (R24) by evaluating all 15 deterministic acceptance tests in `R16_ACCEPTANCE_TESTS.md`. Finally, it provides complete architectural specifications for gapless multi-partition document numbering and the crypto-shredded PII Vault, and enumerates the downstream row issues required to bring the platform into complete compliance.

---

## 2. R23 Schema & Architectural Invariant Audit

| # | R23 Invariant | Implementation Status | Evidence in Current Codebase | Gap Analysis & Remediation |
|---|---|---|---|---|
| **1** | **Separate `tenant_id` from `company_id`** | **MISSING** | Financial entities (`fin_journal_entries`, `fin_accounts`, `fin_gl_sequencers`, `fin_accounting_periods`, `erp_invoices`) only define `tenant_id: UUID`. Zero occurrences of `company_id` exist in migrations. | Prevents multi-company legal entities under a single tenant. R16 Test 1 (multi-entity consolidation, IC eliminations) requires distinct subsidiary and parent `company_id`s within the same tenant. |
| **2** | **FORCE RLS with tenant-first composite keys** | **PARTIAL** | `FORCE ROW LEVEL SECURITY` is 100% enabled across all tenant tables with `current_setting('app.current_tenant_id', true)::uuid = tenant_id`. | Tables use surrogate single `id: UUID` primary keys rather than composite keys `(tenant_id, id)`. Foreign keys do not enforce tenant consistency at the relational level, requiring application-layer tenant checks. |
| **3** | **Double-entry `stock_move` + quant projection** | **MISSING** | `erp_stock_documents` (`1789700000001-CreateErpStockCore.ts`) and `fifo-batch.entity.ts` use document-based warehouse-to-warehouse transfers. | No unified double-entry `stock_move` table (moves between virtual locations: Suppliers, Production, Inventory Loss, and physical locations) and no real-time balance `erp_quants` projection. |
| **4** | **Normalized lot bundles with genealogy** | **MISSING** | `fifo-batch.entity.ts` tracks cost layers (`remainingQty`, `unitCostMinor`), but no lot entities exist. | Lacks parent/child lot split, merge, and transformation tracking across production runs and shipments. |
| **5** | **Catch-weight dual UoM** | **MISSING** | Product and stock lines (`erp_products`, `erp_stock_document_lines`) define only a single `uom` unit of measure. | Inability to track items with variable weight (e.g. piece count vs actual kg) and post catch-weight valuation adjustments. |
| **6** | **Effective-dated prices/tax/BOM with exclusion constraints** | **PARTIAL** | Date validity ranges are checked programmatically in TypeScript (`TaxEngineService`, `AccountingPeriodService`). | No PostgreSQL `EXCLUDE USING gist ... WITH &&` constraints exist in migrations. Concurrent writes can produce overlapping valid date intervals. |
| **7** | **Frozen price/tax/FX snapshots on confirmed documents** | **PRESENT** | `erp_invoices` and `fin_journal_entries` snapshot `unit_price_minor`, `tax_rate_bps`, `fx_rate`, and `net_amount_minor`. Database triggers (`TRG_fin_journal_entries_guard_posted`) enforce strict immutability. | Fully compliant with GoBD/IFRS requirements. |
| **8** | **Landed cost in current period (split stock vs COGS)** | **PRESENT** | `erp_landed_costs` and `erp_landed_cost_allocations` (`1789700000002-CreateLandedCosts.ts`) allocate landed cost to current period inventory/COGS without retroactively reopening closed periods. | Fully compliant with R23 decision 3. |
| **9** | **Gapless document numbering per (company, doc type, channel, fiscal year)** | **PARTIAL** | `fin_gl_sequencers` provides gapless GL audit numbers per tenant. Invoices (`generateInvoiceNumber`) use pseudo-random strings (`INV-${year}-${Math.random()}`). | Global lock contention risk; missing partitioning across legal company, document type, sales channel, and fiscal year. |
| **10** | **PII Vault with crypto-shredding** | **MISSING** | Customer and employee PII (name, email, phone) is stored directly in plain-text columns in `enterprise_hub` tables. | Conflicts with GDPR Art. 17 right to erasure vs AO § 147 / GoBD 8-10 year accounting voucher retention requirements. |

---

## 3. Money-Type Settlement: NUMERIC vs. BIGINT Minor Units

### 3.1 The Conflict
- **R23 Position (`NUMERIC(p,s)`)**: Argued for arbitrary precision decimals across all layers to support sub-cent fractional unit costs, exchange rates, and avoid integer overflow in 32-bit systems.
- **R24 Position (`BIGINT minor units`)**: Mandated integer minor units everywhere to eliminate IEEE 754 floating-point drift, guarantee bank file reconciliation (sum of net payslips must equal bank file payout to the cent), and prevent rounding discrepancies.

### 3.2 Evaluation Against R16 Acceptance Tests (T1–T15)
An audit of all 15 deterministic acceptance tests in `docs/strategy/research/R16_ACCEPTANCE_TESTS.md` reveals:
1. **Financial Balances, Settlements, and Cash Movements (Tests 1, 2, 3, 4, 9, 10, 12, 13, 14):**
   - Test 1 (Consolidated Group Financials): Net income 150,000.00, NCI 10,000.00, controlling net income 140,000.00.
   - Test 2 (Multi-currency Settlement): INV-101 GBP 1,000.00 posts EUR 1,182.50 book / USD 1,283.01 reporting. Settlement USD 1,300.00: Dr Bank EUR 1,189.50, Cr AR EUR 1,182.50, realized FX gain EUR 7.00. GBP receivable balance closes to exactly **0.00**.
   - Test 2 (Rounding Residual): A 3-line invoice (3 lines of 10.00 GBP at 1.182550 EUR/GBP yields 11.8255 -> 11.83 EUR per line, header total 35.48 EUR) explicitly requires:
     > *"the 3-line invoice posts a 0.01 EUR rounding residual so the entry balances"*
   - Test 4 (Immutable Ledger Hash Chain): Pre-image canonicalization verifies exact debits and credits.
   - Test 9 (Bank Reconciliation): Payout 970.00 + fee 30.00 matches AR 600.00 + AR 400.00 exactly.
   - Test 10 (Tax & Withholding): Contractor bill 1,000.00, payment Dr AP 1,000 / Cr Bank 950, Cr WHT payable 50.
2. **Exchange Rates and Unit Costs (Tests 2, 7, 8):**
   - Test 2: FX rate precision requires **6 decimals** (`1 GBP = 1.182500 EUR`, `1 EUR = 1.085000 USD`, `1 USD = 0.915000 EUR`).
   - Test 8: Inventory valuation: Average cost (AVCO) day 3 delivery of 12 units yields COGS 132.00, ending balance 88.00 from batches received at 10.00 and 12.00. Standard costing (STD) posts PPV variance lines (+10.00, -10.00).

### 3.3 The Settled Standard: Dual-Type Architecture

1. **Storage & Arithmetic of Monetary Values:**
   - All accounting ledger debits and credits, invoice totals, line amounts, bank movements, accounts receivable/payable balances, and payroll line items **MUST be stored as PostgreSQL `BIGINT`** representing exact integer minor units (e.g. cents, rials, sen).
   - In 64-bit signed `BIGINT`, the maximum value is $9,223,372,036,854,775,807$, which at 2 decimal places accommodates over $92 \times 10^{13}$ currency units—completely eliminating overflow risk while preventing IEEE 754 float drift.
   - All TypeScript application logic strictly uses `bigint` via `output_apps/enterprise_hub/modules/accounting/money.ts`. Floating-point types (`number` for currency, `float`, `double precision`) are strictly prohibited for monetary amounts.

2. **Storage of Rates, Multipliers, and Quantities:**
   - Exchange rates, tax rates, inventory unit costs, and fractional item quantities **MUST be stored as PostgreSQL `NUMERIC(p,s)`**:
     - FX Rates: `NUMERIC(18, 6)`
     - Inventory Unit Costs: `NUMERIC(24, 6)`
     - Item Quantities: `NUMERIC(18, 4)`
     - Tax / Percentage Rates: `NUMERIC(8, 4)` (or basis points in `integer`)

3. **Deterministic Rounding & Residual Allocation Protocol:**
   - Calculation: `Line Amount = RoundHalfEven(Quantity * Unit Cost * FX Rate)`.
   - Multi-line Balancing: When the sum of rounded line amounts differs from the rounded document header total (e.g. 0.01 EUR difference as in R16 Test 2), the 1-minor-unit residual is posted as an explicit rounding variance line (`ROUNDING_ERROR` / `FX_ROUNDING_RESIDUAL`), guaranteeing that debit and credit sums always balance to zero in integer minor units.

---

## 4. Gapless Document Numbering Architecture

### 4.1 Specification
To prevent table-level serialization bottlenecks while strictly complying with statutory requirements for gapless document sequences (GoBD, KDV, ZATCA, Peppol), document sequencers must be partitioned by `(tenant_id, company_id, document_type, channel, fiscal_year)`.

### 4.2 Database Schema
```sql
CREATE TABLE fin_document_sequences (
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    document_type VARCHAR(32) NOT NULL, -- 'INVOICE', 'CREDIT_NOTE', 'PAYMENT', 'STOCK_MOVE'
    channel VARCHAR(32) NOT NULL,       -- 'ONLINE', 'POS_1', 'DIRECT', 'BATCH'
    fiscal_year INT NOT NULL,
    next_sequence_number BIGINT NOT NULL DEFAULT 1,
    prefix VARCHAR(32) NOT NULL,        -- e.g., 'INV-2026-ONL-'
    padding_length INT NOT NULL DEFAULT 6,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, company_id, document_type, channel, fiscal_year)
);

ALTER TABLE fin_document_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY fin_document_sequences_tenant_isolation ON fin_document_sequences
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

### 4.3 Atomic Issuance Algorithm
```typescript
async function acquireNextDocumentNumber(
  txManager: EntityManager,
  params: {
    tenantId: string;
    companyId: string;
    documentType: string;
    channel: string;
    fiscalYear: number;
  }
): Promise<string> {
  const row = await txManager.query(
    `SELECT prefix, next_sequence_number, padding_length
     FROM fin_document_sequences
     WHERE tenant_id = $1 AND company_id = $2 AND document_type = $3 AND channel = $4 AND fiscal_year = $5
     FOR UPDATE`,
    [params.tenantId, params.companyId, params.documentType, params.channel, params.fiscalYear]
  );

  if (!row || row.length === 0) {
    throw new NotFoundException('Document sequence configuration missing for partition');
  }

  const { prefix, next_sequence_number, padding_length } = row[0];
  const seqNum = BigInt(next_sequence_number);
  const formattedSeq = seqNum.toString().padStart(padding_length, '0');
  const documentNumber = `${prefix}${formattedSeq}`;

  await txManager.query(
    `UPDATE fin_document_sequences
     SET next_sequence_number = next_sequence_number + 1, updated_at = NOW()
     WHERE tenant_id = $1 AND company_id = $2 AND document_type = $3 AND channel = $4 AND fiscal_year = $5`,
    [params.tenantId, params.companyId, params.documentType, params.channel, params.fiscalYear]
  );

  return documentNumber;
}
```

---

## 5. Crypto-Shredded PII Vault Architecture

### 5.1 Regulatory Conflict
- **Commercial & Tax Law (AO § 147, GoBD, UAE Tax Law):** Mandates tamper-evident 8–10 year retention of accounting vouchers, customer invoices, and audit logs.
- **Data Protection Law (GDPR Art. 17, CCPA, PDPA):** Mandates permanent erasure of personally identifiable information (PII) upon verified data subject request.

### 5.2 Architecture & Envelope Encryption
To reconcile these contradictory mandates:
1. **Immutability of the Accounting Ledger:** Financial invoices and journal entries store only the immutable `party_id` (UUID), statutory Tax/VAT registration number, and anonymized legal entity classification.
2. **Isolated Storage:** All sensitive identity data (contact name, personal email, shipping address, phone, IBAN) is isolated in `sec_pii_vault`.
3. **Envelope Encryption:** Each party has a unique 256-bit Data Encryption Key (DEK). The DEK is encrypted by a tenant-specific Key Encryption Key (KEK) managed in HSM / KMS.
4. **Crypto-Shredding on Erasure:** Upon an approved GDPR Art. 17 erasure request:
   - The party's DEK is securely wiped and destroyed.
   - The encrypted PII in `sec_pii_vault` becomes permanently unrecoverable mathematical ciphertext.
   - The accounting ledger, hash chains, and journal lines remain 100% intact, balanced, and compliant with tax audits without retaining identifiable personal data.

### 5.3 Database Schema
```sql
CREATE TABLE sec_pii_vault (
    tenant_id UUID NOT NULL,
    party_id UUID NOT NULL,
    dek_encrypted BYTEA NOT NULL,   -- 256-bit AES DEK wrapped with Tenant KMS KEK
    ciphertext BYTEA NOT NULL,      -- AES-256-GCM encrypted JSON payload of PII fields
    iv BYTEA NOT NULL,              -- 12-byte initialization vector
    tag BYTEA NOT NULL,             -- 16-byte authentication tag
    is_erased BOOLEAN NOT NULL DEFAULT FALSE,
    erased_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, party_id)
);

ALTER TABLE sec_pii_vault FORCE ROW LEVEL SECURITY;
CREATE POLICY sec_pii_vault_tenant_isolation ON sec_pii_vault
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

---

## 6. Actionable Implementation Rows

Each missing or partial invariant identified in this audit is scoped into a discrete, independent engineering row ready for issue tracking:

| Row ID | Title | Lane | Priority | Description & Scope |
|---|---|---|---|---|
| **T341** | `Multi-company partition: separate tenant_id from company_id in core ledger` | **L5** | P1 | Introduce `fin_companies` entity, add `company_id` to all financial tables, and implement multi-company scoping to enable R16 Test 1 consolidation. |
| **T342** | `Database enforcement: tenant-first composite foreign keys across financial tables` | **L5** | P2 | Transition primary and foreign key constraints on `fin_*` tables to composite `(tenant_id, id)` pairs to eliminate cross-tenant FK referencing. |
| **T343** | `Inventory core: double-entry stock_move ledger and real-time quant projection` | **L5/L7** | P1 | Replace document-only inventory transfers with double-entry `stock_move` entries between virtual/physical locations and an append-only `erp_quants` projection. |
| **T344** | `Inventory traceability: normalized lot bundles with split/merge genealogy` | **L7** | P2 | Create `erp_lots` entity with parent/child lineage graphs, lot attributes, and expiration tracking across manufacturing and sales. |
| **T345** | `Catch-weight dual UoM engine for discrete and variable-weight inventory items` | **L7** | P2 | Implement dual UoM support (units + physical weight) on products and movements with automatic valuation variance posting. |
| **T346** | `PostgreSQL bitemporal exclusion constraints (EXCLUDE USING gist) for periods and tax` | **L5** | P2 | Add `tstzrange` effective period columns and GIST exclusion constraints to prevent overlapping tax rate configurations and open accounting periods. |
| **T347** | `Gapless document sequence engine partitioned by (company, doc_type, channel, fiscal_year)` | **L5** | P1 | Build `fin_document_sequences` table and service providing lock-minimized gapless document numbering for invoices, credit notes, and payments. |
| **T348** | `Crypto-shredded PII Vault with envelope encryption for GDPR vs accounting retention` | **L5/L8** | P2 | Implement `sec_pii_vault` with per-party AES-256-GCM envelope encryption and crypto-shredding key destruction on GDPR erasure requests. |
