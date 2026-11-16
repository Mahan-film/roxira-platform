# Research R14 — Gulf country packs (digest)

Source: the owner's deep-research run R14, stage 1 (requirements catalogue) and stage 2 (fact re-check and decision pack), received 2026-11-17. The report's own verdict per claim is kept: **verified** means the report found it on the authority's site (zatca.gov.sa, tax.gov.ae, u.ae, tms.taxoman.gov.om, nbr.gov.bh, gta.gov.qa, peppol.org). **Secondary** means only Big 4 alerts or vendor blogs carry it. Secondary facts go into pack data with `verified: false` and are checked against the primary text before the adapter ships.

Pack order is unchanged (`ARCHITECTURE_DECISIONS_2026-11-16.md`): DE first, then SA and AE, then the rest. No Gulf row starts before the core rows below are merged.

## What R14 changes in the core (needed before any Gulf pack)

| Finding | Effect on Roxira |
|---|---|
| OMR, BHD and KWD have **3 decimal places**. SAR, AED and QAR have 2. | Our money columns are almost all `numeric(18,2)` (129 columns, hub count 2026-11-17). A 3-decimal currency cannot be stored. New core row **T169** (currency exponent per ISO 4217, wider money columns, rounding per currency). It also helps any currency with 0 or 3 decimals. |
| Two incompatible e-invoice models: **central clearance** (Saudi Fatoora) and **Peppol 5-corner through an accredited provider** (UAE, Oman). | The e-invoice adapter interface must support both a synchronous "clear before you send" flow and an asynchronous "send through a provider, receive status" flow. Our Moadian adapter is the first of the first kind. |
| A UAE VAT group's TIN **cannot** be used for e-invoicing. Each member uses its own TIN (verified, tax.gov.ae). | Tax registration ids live on the **legal entity** (company), never only on the tax group. Our company-group model (T155) must keep both. |
| Saudi invoices: Arabic is the binding language. Numerals may be Western or Arabic-Indic. Dates are numeric year/month/day. Latin letters are allowed for proper names (verified, ZATCA guideline v3, May 2026). Hijri dates on invoices: no primary rule found. | Reuse the Persian RTL renderer. Gregorian date on the invoice and in the XML; Hijri as an optional display only. |
| Zakat: fiscal-year days pro-rate the 2.5% rate; long-term debt is 354 days or more; Zakat revenue must reconcile with VAT returns on request (verified, ZATCA). | Ledger reports need a Zakat base report and a Zakat-to-VAT revenue reconciliation. Pack data, not core code. |
| Retention differs by country: KSA at least 6 years, 15 for real estate (15 verified); UAE VAT 5, corporate tax 7 (7 verified), real estate 15; Oman 10 (verified); Bahrain 5; Qatar 10. | Retention is a per-pack setting on the immutable archive. The longest applicable period wins. |

## Saudi Arabia (ZATCA Fatoora)

| Fact | Status |
|---|---|
| Phase 2 waves by VAT-taxable revenue; wave 25 is above SAR 187,500 in any of 2022–2025. | verified (threshold); date 1 Feb 2027 secondary but consistent across EY, PwC and KPMG |
| B2B (standard) invoices are **cleared** in real time before they go to the buyer. B2C (simplified) invoices are signed locally and **reported within 24 hours**. | verified |
| Each device or POS unit has its own certificate (CSID) and its own invoice counter (ICV) and previous-invoice-hash (PIH) chain. | verified |
| Onboarding: portal OTP valid **1 hour**; compliance CSID valid **24 hours**; production CSID valid "multiple years" (ZATCA support: 5 years). The report's earlier "365 days" was wrong. | OTP verified; CCSID and PCSID from ZATCA staff on the official developer forum |
| Signing: secp256k1 ECDSA, SHA-256, UBL 2.1, XML standard v1.2 (May 2023), advance-payment tags required when an invoice settles an advance. | verified |
| QR: 9 TLV tags; the length byte counts UTF-8 bytes (an Arabic character is 2 bytes). | verified (tags, byte length); 700-character cap secondary |
| A solution provider does **not** have to be listed by ZATCA. | verified |
| Simplified-invoice ceiling SAR 1,000; VAT return box numbers. | not found in the primary text; check before building |
| ZATCA ships a free SDK (Java, .NET) and a web validator; community Node and PHP libraries exist. | verified |

**Decision:** build the Saudi adapter ourselves. Sign in Node with secp256k1, and test every document type against the official SDK validator and the Fatoora simulation portal in CI. Onboarding runs as one atomic flow (CSR → compliance CSID → compliance samples → production CSID) well inside the 24-hour window. The ICV/PIH counter is locked per device in Postgres, the same way our invoice numbering is. A broken chain stops issuing on that device, never silently continues. A revoked CSID cannot be reused, so revocation needs a confirm step.

## UAE

| Fact | Status |
|---|---|
| Peppol 5-corner model; the provider (ASP) validates and reports tax data to the FTA; both seller and buyer must use an ASP; batch sending allowed; PDF or scans are not e-invoices; TIN = first 10 digits of the 15-digit TRN. | verified (tax.gov.ae) |
| Phase 1 (revenue ≥ AED 50M) had to appoint an ASP by 30 Oct 2026. | verified |
| Go-live 1 Jan 2027 (phase 1), ASP by 31 Mar 2027 and go-live 1 Jul 2027 (below AED 50M), government 1 Oct 2027; PINT AE v1.1; issue within **14 business days**; intra-VAT-group invoices excluded until 31 Dec 2028. | secondary (Ministry of Finance texts not read) |
| Penalties (Cabinet Decision 173/2026): AED 5,000 per month without an ASP, capped at AED 50,000 a year; AED 100 per late invoice, capped at AED 5,000 a month. | secondary |
| The rule that e-invoice data must be stored in the UAE was **removed** (Ministerial Decision 197/2026); records must stay retrievable for the FTA. | secondary, several sources agree |
| Becoming an ASP needs a UAE licence, ISO 27001 and 22301, insurance and OpenPeppol membership. The FTA's separate **Tax Accounting Software Register** costs AED 10,000. | ASP rules secondary; register verified |
| VAT 5%; quarterly return below AED 150M revenue (verified, u.ae); return box 1 split per emirate **and** e-commerce versus other supplies (verified, tax.gov.ae). Corporate tax: small business relief up to AED 3M revenue in the current and all earlier periods (verified); extension to 2029 secondary. | as stated |

**Decision:** we do not become an ASP. We build the PINT AE mapper and a pre-send validator ourselves, and send through an accredited provider behind a provider-neutral adapter (a tenant can bring its own ASP). The open-source `phase4` AS4 library (Apache-2.0) is the fallback if we ever run our own access point; Oxalis is end-of-life. The Tax Accounting Software Register listing is a business decision for later.

## Oman, Bahrain, Qatar, Kuwait

| Country | Facts | Plan |
|---|---|---|
| Oman | VAT 5%; registration at OMR 38,500, voluntary OMR 19,250; 10-year retention; corporate tax 15% (all verified). E-invoicing (PINT OM, accredited providers) decided in Decision 189/2026: 1 Apr 2027 above OMR 5M, 1 Oct 2027 for the rest (dates secondary). | Reuse the UAE mapper and adapter. |
| Bahrain | VAT 10%; registration at BHD 37,500 (verified). No e-invoicing date. | Data-only pack: VAT, 3 decimals, bilingual "Tax Invoice". |
| Qatar | No VAT; corporate tax 10% on the foreign share, 5% withholding, registration within 60 days (verified). Draft e-invoicing law approved 6 May 2026 (secondary). | Data-only pack: commercial invoice, CIT and WHT. |
| Kuwait | No VAT, no e-invoicing (all secondary). | Data-only pack: 3 decimals, CIT and Zakat. |

## Not taken from the report
- Its engineering-week and cost estimates. Our lanes plan their own rows.
- Its go-to-market dates ("ship KSA before 1 Feb 2027"). The owner's rule is product first; dates follow the pack order, not market deadlines.
- Region pinning of customer databases per country. A later infra decision, not part of the pack.

## Rows
Core rows are in `ARCHITECTURE_DECISIONS_2026-11-16.md` (T169). Pack rows **T174–T176** are queued there and start only after the DE pack rows (R13) are merged.
