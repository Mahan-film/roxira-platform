# Research R4 — country packs and market entry (digest)

Source: the owner's deep-research run of prompt 4, received 2026-11-15. This file is the coordinator's digest, the decisions taken from it, and the plan for WAVE 15.

**Caution:** thresholds, rates, dates and vendor prices in the report were not verified here. Every legal number goes into versioned pack configuration with a source URL and an effective date, never into code. Verify each one against the official source before a pack goes to production.

## Where the code is today (checked 2026-11-15)
- `modules/country_packs` already defines a `CountryPack` interface (ADR_GLOBAL_CORE.md): chart templates, tax rules, `StatutoryPort`, `EInvoiceAdapter`, `PayrollRulesAdapter` and a report pack.
  - It has `ir` and `xx` packs and a registry.
  - **Nothing outside the module uses the registry yet.**
- There is no book or transaction currency on the ledger; only `fx_rate` exists, in five places.
- `Asia/Tehran` is hard-coded in 26 non-test files, and 57 files carry their own Jalali helpers.

## What the market leaders do (summary)
- **The core owns ledger invariants, multi-currency and workflow. A pack supplies data and adapters.**
  - **Data:** chart templates, tax codes, fiscal positions, report mappings, holidays.
  - **Adapters:** e-invoice serialise / validate / submit / poll / cancel / parse-inbound, POS fiscal signing, payroll statutory, accountant/audit exports.
- **Localisation belongs to a company, not a branch, and is locked after the first posted entry.** A group with companies in two countries uses two companies plus consolidation.

## Decisions (adopted)
1. **Company-scoped localisation.**
   - Fields: `country_code`, `pack_version`, `book_currency_code`, `default_calendar`, `timezone`, `locale` and `fiscal_year_start_month`, all on the tenant's company record.
   - A trigger locks country and book currency once a posted journal entry exists.
   - Existing tenants default to the current pack.
2. **Resolve the pack per request.** `CountryPackRegistry.resolve(company.country_code)` goes into the request context; services ask the pack and never branch on a country code.
3. **Dual-amount ledger.**
   - Journal lines carry `tx_currency_code`, `fx_rate_applied`, `tx_debit`/`tx_credit` and `book_debit`/`book_credit`.
   - Posting enforces SUM(book) balance, and SUM(tx) balance when the entry has one currency. A rounding residual goes to a rounding line.
   - `fx_rates` is keyed by (tenant, base, quote, date, rate_type ∈ SPOT / TAX_OFFICIAL / CLOSING).
   - Realised FX is booked at payment reconciliation. Unrealised revaluation runs at period end with an automatic reversal the next day.
   - This is rolled out expand → backfill → contract.
4. **Thresholds and rates are effective-dated pack config, never code.** Examples: e-invoice exemption and consolidation caps, tax rates by date, turnover cut-offs.
5. **Every external adapter has a circuit breaker and a tested fallback.**
   - Tax-authority API: outbox retry inside the cancellation window, then a portal-upload export.
   - POS signing: an offline queue with a visible "not yet signed" flag.
   - FX feed: the last cached rate.
6. **Build vs. buy:**
   - **Build:** tax engines, e-invoice serialisers (with the official open-source validator run before every send), chart templates, accountant exports, and payroll where the authority publishes a computation spec.
   - **Buy:** certified cloud signing for German POS.
   - **Partner or export:** German payroll, because it needs a statutory system audit.
7. **Market order:** Malaysia first, then Germany. Afterwards, rank by reuse: Singapore, UAE, UK, then others.
8. **Immutability for every pack.** Posted entries and issued e-documents are never edited in place: corrections are reversals or credit notes. Original structured files are archived unchanged for the statutory period.

## Owner inputs needed (not code)
- **Go-to-market for Malaysia:**
  - which legal entity issues invoices;
  - the tax-authority sandbox account for testing e-invoicing (it needs a registered taxpayer);
  - the local data-protection officer once the thresholds are reached.
- **Pricing.** The report suggests about RM79 / RM149 a month for Malaysia and €29 / €69 for Germany. Pricing is the owner's call.
- **Before any German launch:** an EU-hosted pod, a tax-adviser partner to sign off the accountant export, and the POS signing vendor contract.

## WAVE 15 plan (global core) — post when WAVE 14 rows are mostly done
| Lane | Task | Done when |
|---|---|---|
| L1 | **Company localisation + per-request pack** | Add the fields from decision 1 through a migration (tenant column, RLS spec), plus the lock trigger with a spec. A cls/request-context provider resolves the pack, and `CountryPackRegistry` is used by at least the statutory and tax services. Existing tenants are backfilled to the current pack. |
| L2 | **Dual-amount ledger (expand + backfill)** | Add the new columns as nullable and backfill (book = tx = the current amounts, rate 1). Add the `fx_rates` table, the balance trigger on posting, and the rounding line. All existing accounting specs pass. The contract step (NOT NULL, readers switched) is a separate later PR. |
| L2 | Realised and unrealised FX (*after the expand PR*) | Book FX on payment reconciliation and add the period-end revaluation job with automatic reversal. Specs cover a gain, a loss, a partial payment and a revaluation followed by settlement. |
| L3 | **One `CalendarService`** | Replace all 26 hard-coded time-zone uses and the 57 local Jalali helpers with `CalendarService`, driven by the company's calendar and time zone. Fiscal periods have explicit start and end dates. Batch the PRs by module. |
| L4 | **Current pack behind the interfaces** | The existing e-invoice transmission becomes the pack's `EInvoiceAdapter`, statutory payroll becomes its `PayrollRulesAdapter`, and the tax rules become pack data. Callers go through the resolved pack. Behaviour is unchanged and all specs pass. |
| L4 | **`my` pack skeleton** | Add metadata, an SME chart template, effective-dated sales/service tax codes and thresholds as versioned JSON with source URLs, plus spec tests. There is no network adapter yet. |

## WAVE 16+ (later)
- **Malaysia:**
  - e-invoice API adapter against the sandbox (needs the owner's sandbox account), including:
    - consolidation guardrails (single-transaction cap, prohibited industries, buyer request);
    - 72-hour cancellation;
    - self-billed invoices;
  - sales/service tax return export;
  - payroll statutory engine (provident fund, social security, employment insurance, monthly tax deduction) tested against the authority's published computation spec;
  - `ms` and `en` catalogues;
  - data-protection pack (breach workflow, portability export, PII redaction before any LLM).
- **Germany:**
  - EN 16931 XRechnung and ZUGFeRD serialiser and inbound parser, where the XML takes precedence;
  - the official validator in a container, run before every send;
  - SKR03/SKR04 templates;
  - accountant export (EXTF + attachments);
  - GoBD immutability and an audit export;
  - the e-filing wrapper isolated in its own service;
  - POS cloud signing through a vendor;
  - payroll by export only.
