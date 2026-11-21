# R28 Gemini Deep Research, Stage 2 (second run, no live search)

Pasted by the owner on 2026-11-22 and saved unchanged except that the Google search redirect wrapper around one link was removed. The model stated that live web search was unavailable, so every row is UNVERIFIABLE; it lists the official pages to check. Companion of `R28_GEMINI.md` (Stage 1 and an incomplete first Stage 2).

**Verification Constraint:** Live web search is unavailable in this turn (0 search calls remaining). Because today is 2026-11-22 and the Stage 1 report relies heavily on mid-to-late 2026 regulatory enactments, deadlines, and vendor pricing, **no claim below could be live-verified against current primary sources**. Every factual row is therefore marked **UNVERIFIABLE** with the exact official primary-source URL to check, plus a distinction between (a) pre-2026 statutory baselines, (b) high-risk 2026 claims that require live verification before writing code, and (c) mathematical/logical errors caught directly in the report text.

---

# PART A: FACTS & SOURCE VERIFICATION

## 1. Claim-by-Claim Audit Table

| Claim (from Stage 1 Report) | Primary Source URL to Check | Source Date | Status & Audit Note |
| --- | --- | --- | --- |
| **KSA:** VAT 15%; mandatory registration above SAR 375,000; voluntary above SAR 187,500; Phase 1 on 4 Dec 2021; Phase 2 started 1 Jan 2023 | [https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx](https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — No live web access to confirm 2026 currency; consistent with pre-2026 ZATCA baseline (E-Invoicing Regulation 4 Dec 2020). |
| **KSA:** Wave 24 (above SAR 375k, 1 Apr–30 Jun 2026) and Wave 25 (above SAR 187,500 across 2022–2025, announced 24 Jul 2026, deadline 1 Feb 2027) | [https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx](https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx) | N/A (no live access) | **UNVERIFIABLE** — Post-cutoff 2026 announcement; must verify exact Wave 25 threshold, reference years, and 1 Feb 2027 deadline directly on ZATCA before prioritizing KSA. |
| **KSA:** 12B+ e-invoices; 1.7M SMEs (Q3 2025); 1,918,512 active CRs (Q2 2026) | [https://mc.gov.sa/en/Pages/default.aspx](https://mc.gov.sa/en/Pages/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — No live web access to verify 2025–2026 MoC / Monsha'at / ZATCA statistics. |
| **KSA:** UBL 2.1, EN 16931, ECDSA `secp256k1`, XAdES-EPES, 9-tag TLV QR, genesis PIH `NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==` | [https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Pages/default.aspx](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Pages/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — No live web access to check 2026 SDK/Schematron revisions. Genesis hash math (`Base64(Hex(SHA-256("0")))`) and UTF-8 byte count (`"شركة الخليج للتجارة"` = 19 chars / 36 UTF-8 bytes) check out mathematically. |
| **KSA:** PCSID validity (5 yr vs 2 yr vs 1 yr) and `PATCH /production/csids` renewal | [https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/default.aspx](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — No live web access; report itself flags conflicting community reports. Must parse `notAfter` dynamically regardless. |
| **KSA:** No mandatory ZATCA vendor license; directory is indicative only | [https://zatca.gov.sa/en/E-Invoicing/SolutionProviders/Pages/default.aspx](https://zatca.gov.sa/en/E-Invoicing/SolutionProviders/Pages/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — Consistent with pre-2026 ZATCA policy, but unverified for late-2026 changes. |
| **KSA:** Penalty ladders (SAR 5k–50k) and H2 2026 amnesty (1 Jul–31 Dec 2026) excluding e-invoicing fines | [https://zatca.gov.sa/en/MediaCenter/News/Pages/default.aspx](https://zatca.gov.sa/en/MediaCenter/News/Pages/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — Post-cutoff June/August 2026 ZATCA announcements cannot be checked without live web access. |
| **KSA:** Gregorian Zakat rate scaling (`2.5% / 354 × 365 = 2.577684%`; leap year `2.584746%`) under MR 1007/2024 Art. 15 | [https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/default.aspx](https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — Arithmetic checks out (`2.5/354×365 = 2.577684%`), but live verification is needed on whether Art. 15 fixes denominator at 354 vs. actual Hijri year days (354 or 355). |
| **UAE:** MD 243/2025 amended by MD 197/2026, MD 244/2025 amended by MR 66/2026, MD 168/2026 (ASP), CD 173/2026 (penalties), Guidelines v2.0 (26 Oct 2026), Mandatory Fields v1.1 (28 Oct 2026) | [https://mof.gov.ae/einvoicing/](https://mof.gov.ae/einvoicing/) | N/A (no live access) | **UNVERIFIABLE** — Critical post-cutoff October 2026 legal instruments. Do not build against MD 197/2026 reliefs (e.g., repealed data residency, 14 business days) or CD 173/2026 penalties without reading the gazetted texts. |
| **UAE:** Universal B2B scope (incl. non-VAT SMEs); Phase 1 (at least AED 50M) go-live 1 Jan 2027; Phase 2 (under AED 50M) ASP by 31 Mar 2027, go-live 1 Jul 2027; Phase 3 (B2G) 1 Oct 2027 | [https://mof.gov.ae/einvoicing/](https://mof.gov.ae/einvoicing/) | N/A (no live access) | **UNVERIFIABLE** — Post-cutoff 2026 timeline; must confirm exact statutory dates in MR 66/2026 and MD 244/2025. |
| **UAE:** ASP criteria (AED 50k capital, ISO 27001/22301, AED 2.5M PI + 5M crime + 5M cyber insurance, 2-yr experience, 100 free annual exchanges/user); 88 accredited ASPs by 13 Nov 2026 | [https://mof.gov.ae/einvoicing/](https://mof.gov.ae/einvoicing/) | N/A (no live access) | **UNVERIFIABLE** — Post-cutoff MD 168/2026 and live MoF Central Register count cannot be verified without web access. |
| **UAE:** PINT AE v1.0.4 (`urn:peppol:pint:billing-1@ae-1`), scheme `0235` + 10-digit TIN, 8-digit `BTAE-02`, stand-in endpoints `9900000097–99`, AED line conversion (`IBR-104-AE`), TDD reporting | [https://docs.peppol.eu/](https://docs.peppol.eu/) | N/A (no live access) | **UNVERIFIABLE** — Must check latest PINT AE schema version and rules on OpenPeppol / MoF developer docs before coding. |
| **UAE:** VAT 5% (AED 375k/187.5k); 2026 VAT reforms (FDL 16/2025 RCM abolition & 5-yr credit expiry, CD 129/2025 14% p.a. late payment, CD 149/2026 supplier due diligence) | [https://tax.gov.ae/en/default.aspx](https://tax.gov.ae/en/default.aspx) | N/A (no live access) | **UNVERIFIABLE** — 5% rate and AED 375k/187.5k thresholds align with pre-2026 law; all 2026 VAT reforms (FDL 16/2025, CD 129/2025, CD 149/2026) are post-cutoff and unverified. |
| **UAE:** Corporate Tax 0% up to AED 375k / 9% above; Small Business Relief (≤ AED 3M) extended to 31 Dec 2029 by MD 131/2026 (7 Aug 2026); MD 84/2025 audit rules | [https://uaelegislation.gov.ae/en](https://uaelegislation.gov.ae/en) | N/A (no live access) | **UNVERIFIABLE** — 0%/9% brackets align with FDL 47/2022; **MD 131/2026 SBR extension to 2029** is a major post-cutoff claim (original MD 73/2023 sunset was 31 Dec 2026) and must be live-verified. |
| **Oman:** 5% VAT (16 Apr 2021, RD 121/2020; OMR 38,500 / 19,250); Decision 189/2026 (Gazette No. 1660, 9 Aug 2026) mandating Fawtara 1 Apr 2027 (above OMR 5M) and 1 Oct 2027 (all VAT registrants) | [https://www.taxoman.gov.om/](https://www.taxoman.gov.om/) | N/A (no live access) | **UNVERIFIABLE** — Pre-2026 VAT baseline aligns with RD 121/2020; Decision 189/2026 and 2027 Fawtara dates are post-cutoff and unverified. |
| **Oman:** Peppol Authority (7 Jan 2026), PINT OM v1.0.1 (29 Jul 2026), scheme `0248` + 12-char VATIN, UUID v5, 20-char `BTOM-001`, mandatory B2C QR, OMR 6k ASP capital | [https://fawtara.taxoman.gov.om/](https://fawtara.taxoman.gov.om/) | N/A (no live access) | **UNVERIFIABLE** — Post-cutoff 2026 technical spec and ASP criteria; **note math flaw in report's first Baisa Gap example** (it truncated `0.047619` to `0.047` instead of rounding to `0.048`, where `0.048 + 0.002 = 0.050` has zero gap; the 20-line example is mathematically valid). |
| **Qatar:** No VAT; 10% foreign CIT; 15% DMTT (registration extended 4 Nov 2026 to 31 Jan 2027); Cabinet-approved draft e-invoicing law (6 May 2026, not gazetted); GTA centralized pilot | [https://gta.gov.qa/en/](https://gta.gov.qa/en/) | N/A (no live access) | **UNVERIFIABLE** — Pre-2026 tax baseline aligns; May/Nov 2026 developments and GTA pilot specs are unverified without live access. |
| **Bahrain:** 10% VAT (1 Jan 2022; BHD 37,500 / 18,750); voluntary e-invoicing since Nov 2023; Q1 2026 draft UBL specs; draft 10% CIT (Dec 2025 / Feb 2026) | [https://www.nbr.gov.bh/](https://www.nbr.gov.bh/) | N/A (no live access) | **UNVERIFIABLE** — 10% VAT and thresholds align with pre-2026 NBR rules; 2026 draft CIT and e-invoicing status are unverified. |
| **Kuwait:** No VAT, no e-invoicing; 15% DMTT (Decree-Law 157/2024); Cabinet approved GCC Excise Tax draft decree-law (27 Oct 2026); 15% BPT un-enacted | [https://www.mof.gov.kw/](https://www.mof.gov.kw/) | N/A (no live access) | **UNVERIFIABLE** — Baseline aligns; Oct 2026 excise draft and April 2026 DMTT safe harbour / retention updates are unverified. |
| **ISO 4217:** 3-decimal currencies (KWD, BHD, OMR) vs 2-decimal (SAR, AED, QAR) | [https://www.six-group.com/en/products-services/financial-information/data-standards.html](https://www.six-group.com/en/products-services/financial-information/data-standards.html) | N/A (no live access) | **UNVERIFIABLE** — Standard ISO 4217 minor-unit exponents (3 vs 2), unverified live in this turn. |
| **Pricing & TCO Benchmarks:** OpenPeppol fees (€2,100 + €3,700/yr + €2,500/yr); UAE ASP setup AED 250k–700k; Esnad/Storecove/Qvalia pricing; $18k–$50k build costs | [https://peppol.org/about/membership/](https://peppol.org/about/membership/) | N/A (no live access) | **UNVERIFIABLE** — Vendor rates cannot be checked without live access. **Critical methodological flaw:** The report's $18k/$32k/$50k build costs and $12k/yr maintenance reflect agency/enterprise labor rates, not a 2-person AI-agent SaaS team's actual cash burn. |

---

# PART B: ANALYSIS, MISSED RISKS & RECOMMENDATIONS

## 2. What the Stage 1 Report Missed (12 Risks That Will Hurt Roxira in 12–24 Months)

1. **GCC Payroll, WPS SIF Files, and Social Insurance (Mudad, MOHRE WPS, GOSI, EOSB)**
*Why it matters:* Roxira is an ERP + HR suite, not a standalone invoicing tool. In KSA and UAE, SMEs are legally fined or blocked from renewing visas if they fail to submit bank-specific **Wage Protection System (WPS) SIF** files monthly (UAE MOHRE/CBUAE; KSA Mudad/Qiwa) or miscalculate **GOSI** (which has tiered Saudi vs. expat rates and progressive hikes for new Saudi entrants) and **End-of-Service Benefits (EOSB)**. Selling "accounting + HR" without WPS SIF export and EOSB accruals will kill SME conversion and cause churn within 90 days.
2. **Multi-Tenant Cryptographic Key Custody (ZATCA Annex 1 vs. Cloud SaaS Liability)**
*Why it matters:* ZATCA prohibits exporting the `secp256k1` signing private key. If Roxira stores thousands of tenants' Production CSID private keys in standard PostgreSQL tables (even app-encrypted), a single DB leak compromises every tenant's legal tax identity and violates Annex 1. You need HSM/KMS-backed key custody (e.g., AWS KMS / HashiCorp Vault Transit) with strict per-tenant isolation—adding per-key monthly costs and architecture work that the report omitted.
3. **Cross-Border SaaS Withholding Tax (WHT) & Non-Resident Digital VAT on Roxira's Own Revenue**
*Why it matters:* Billing GCC SMEs from a non-GCC entity (e.g., a Malaysian Sdn Bhd) triggers **5%–15% Withholding Tax** in KSA, Qatar, and Oman on cross-border software/technical services—many B2B buyers will either deduct 15% from your invoice or refuse to buy without a local VAT invoice. Simultaneously, selling to non-VAT-registered SMEs (especially in UAE/KSA/Oman/Bahrain) can trigger **zero-threshold non-resident VAT registration** obligations on electronic services unless routed through a Merchant of Record (MoR) or local distributor.
4. **Bidirectional Peppol (Inbound Accounts Payable / Corner 3) & Input VAT Recovery**
*Why it matters:* The report treats Peppol mostly as outbound AR billing. In UAE and Oman's 5-corner model, every SME must also **receive** structured PINT AE/OM supplier invoices through their ASP, validate them, send Tax Data Status (TDS) failure messages if invalid, and ingest them into AP to legally reclaim input VAT. Shipping outbound-only invoicing forces customers to use a second tool for AP.
5. **Offline-First POS & Multi-Till ZATCA Hash-Chain Integrity**
*Why it matters:* Retail and F&B SMEs run multiple POS tills that lose internet connectivity. If two tills share one EGS unit or if an offline till's clock drifts or stays offline past 24 hours, ZATCA's monotonic ICV counter and PIH hash chain break—creating unfixable compliance gaps. Each POS terminal needs either an isolated EGS unit with local key/queue storage or a strict server-side serialization boundary with clear offline-SLA alerts.
6. **Personal Data Protection & Regional Hosting (KSA PDPL, NCA ECC, UAE PDPL)**
*Why it matters:* Even if UAE e-invoicing data residency was relaxed in late 2026 (unverified), Roxira holds **HR payroll, Emirates IDs/Iqamas, CRM PII, and legal queries**. KSA's PDPL restricts cross-border transfers of personal data without adequacy/SCCs/risk assessments, and enterprise/regulated GCC clients routinely demand in-region hosting (`me-central-1` UAE, `me-south-1` Bahrain, or KSA cloud regions). Hardcoding a single non-GCC VPS creates a painful multi-region migration in 12–24 months.
7. **ASP White-Label Minimums, KYC Friction, and "100 Free Exchanges" Reseller Traps**
*Why it matters:* The report assumes you can cheaply white-label an ASP and pass through the UAE's 100 free annual exchanges per SME. In practice, accredited ASPs charge **$500–$2,000/month platform minimums**, charge per-tenant KYC/KYB onboarding fees (trade license + Emirates ID + TIN verification), and often restrict the statutory free tier to *direct* end-users rather than white-label SaaS resellers. Signing the wrong ASP contract will destroy minimal-budget unit economics.
8. **UAE FTA Audit File (FAF) & Customs/Import VAT Reconciliation**
*Why it matters:* E-invoicing compliance does not replace tax audit exports. UAE VAT audits require generating the standardized **FTA Audit File (FAF)** (mapping GL accounts, suppliers, customers, and tax codes to FTA specifications), and UAE/KSA VAT returns pre-populate import VAT from customs declarations. If your accounting schema doesn't capture FAF fields and customs declaration IDs from day one, tenants will fail their first audit.
9. **KSA Zakat Balance-Sheet Base vs. Mixed-Ownership CIT Chart of Accounts**
*Why it matters:* The report mentions Zakat rate scaling (2.5777%) but ignores that **Zakat is calculated on a balance-sheet/equity base** (capital + retained earnings + long-term liabilities minus fixed assets/investments), not P&L net profit. Mixed Saudi/foreign entities must split the same trial balance between Zakat and 20% CIT. Retrofitting Zakat-compliant CoA mappings onto a standard Western chart of accounts is a major migration hazard.
10. **"Smart Judge" AI Legal Assistant: Arabic Legal Primacy & Unauthorized Practice of Law (UPL)**
*Why it matters:* In every GCC state, **Arabic is the sole authoritative legal language**—English translations of Royal Decrees and FTA/ZATCA decisions carry no legal force and often lag amendments. Having "Smart Judge" answer GCC tax/labor/commercial questions from unverified English summaries or stale 2025/2026 regulations creates severe UPL and professional-liability exposure for a 2-person team without regional E&O insurance.
11. **GCC-Specific Payment Rails & Collection Friction**
*Why it matters:* Stripe/international cards have low penetration for local B2B/B2C workflows compared to **Mada & STC Pay** (KSA), **KNET** (Kuwait), **BenefitPay** (Bahrain), and local bank transfers / Open Banking (**Lean / Tarabut**). If Roxira's invoices lack local payment links and automated bank-statement reconciliation (MT940/CSV for Al Rajhi, SNB, Emirates NBD, ADCB, Bank Muscat), SMEs will still reconcile manually in Excel.
12. **GCC Commercial Accounting Edge Cases: Prepayment VAT Invoices, Retentions, & Split Weekends**
*Why it matters:* GCC trading and contracting SMEs rely heavily on **advance-payment tax invoices** (mandatory VAT invoice on deposit, netted via `PrepaidAmount` on the final invoice) and **5%–10% contract retentions**. Furthermore, **weekends differ across the GCC** (UAE is Sat–Sun; KSA, Oman, Bahrain, Qatar, Kuwait are Fri–Sat)—hardcoding Western business-day calendars breaks UAE's 14-business-day issuance rule, ASP 5-business-day update SLAs, and payroll cutoffs.

---

## 3. DECISION PACK (Tailored to Roxira: 2-Person AI-Agent Team, Minimal Budget)

### Strategic Correction to Stage 1

The Stage 1 report's TCO model is **wrong for Roxira**. It assumed `$32,000` upfront + `$12,000/yr` to build native ZATCA Phase 2 vs. `$18,000` + `$13,200/yr` for middleware. For a 2-person team using AI coding agents on NestJS/Python/PostgreSQL with open-source libraries, **engineering labor is sweat equity (opportunity cost), while middleware/ASP retainers are real cash burn**.

* **For KSA (Direct API):** Building native ZATCA Phase 2 in-house using open-source UBL 2.1 + `secp256k1` XAdES libraries + ZATCA's official free Java/CLI SDK for validation costs **~$0 in vendor cash** (2–4 weeks of agent-assisted dev). Paying a Saudi middleware vendor $0.10–$0.16/invoice + monthly minimums makes **zero financial sense** for Roxira.
* **For UAE & Oman (Mandatory Peppol ASP):** You **cannot** self-accredit (2-year experience blocker + AED 250k–700k cost). Here, a partner ASP is mandatory—but you should **avoid high-minimum white-label API contracts** until you have paying UAE/Oman customers, starting with a **referral/co-sell or pay-as-you-go (no-minimum) ASP integration**.

### Options Comparison

| Option | Architecture | One-Off Cash Cost | Monthly Recurring Cash | Effort (2-Person + AI Agents) | Reversibility | Fit for Roxira |
| --- | --- | --- | --- | --- | --- | --- |
| **Option 1: Defer GCC entirely until post-Malaysia/Germany traction** | Build GCC-safe primitives into core ledger now (3-decimal, RTL, immutable ledger); ship 0 GCC packs in 2027 | $0 | $0 | 1–2 weeks (core schema hardening) | **High** (can enter later) | **Best if** you have zero committed GCC pipeline today. |
| **Option 2: Lean Native KSA + Referral/PAYG UAE ASP (Recommended if entering GCC)** | Shared GCC Core + **Native in-house ZATCA Phase 2** (open-source UBL/ECDSA + KMS) + **1 zero/low-minimum UAE Peppol ASP** (referral/API) | $200–$1,000 (legal/tax review of schemas + test accounts) | $50–$250/mo (KMS keys + regional VPS/DB + PAYG ASP fees) | 8–12 weeks total (Core 2–3w, UAE 3–4w, KSA 4–5w) | **High** (adapter pattern lets you swap ASP or drop a country cleanly) | **Best if** you actively want GCC revenue in 2027 on minimal cash. |
| **Option 3: Stage 1 Report's Multi-GCC Paid Middleware ("Path A")** | Single paid middleware/ASP aggregator for KSA + UAE + Oman | $1,000–$5,000 (vendor setup/onboarding) | $500–$1,500/mo minimums + per-invoice fees | 5–7 weeks | **Medium** (contract lock-in + per-tenant KYC migration pain) | **Poor fit** — burns $6k–$18k/yr cash before product-market fit. |

### Recommendation

**Adopt Option 1 (Core-Only Hardening) unless you already have at least 5–10 committed GCC pilot SMEs or a local GCC distribution partner.** A 2-person team simultaneously launching in Malaysia, expanding to Germany, and building an AI legal assistant cannot afford to chase 3 different 2027 GCC tax mandates speculatively.

**If you DO commit to GCC in 2027, execute Option 2 (NOT Stage 1's Path A):**

1. **Never pay middleware for Saudi Arabia.** Build native ZATCA Phase 2 directly behind your internal `TaxTransportAdapter` interface using open-source Node/Python crypto + ZATCA's free official validation SDK.
2. **Ship UAE first ONLY if you secure a zero-minimum / referral-model MoF-accredited ASP** (where the SME contracts directly with the ASP or pays PAYG via Roxira, avoiding $1k/mo platform minimums). Otherwise, ship **KSA first** (zero ASP gatekeeper, zero licensing fees, largest TAM).
3. **Keep "Smart Judge" strictly out of GCC legal/tax advice** until you have verified Arabic primary-source ingestion and disclaimers—do not bundle unverified GCC tax advice into the ERP.

### Execution Roadmap (Assuming Option 2; If Option 1, Stop After Month 1 Core Hardening)

* **This Month (Weeks 1–4): Verify & Harden the Core**
* **Live-verify** all post-cutoff 2026 claims in the Audit Table above (especially UAE MD 197/2026, MD 168/2026, MD 131/2026 SBR, KSA Wave 25, Oman Decision 189/2026) directly on official portals.
* **Harden Roxira's core schema once (zero cash):** Ensure all monetary columns store ISO 4217 currency precision (supporting 3 decimals for KWD/BHD/OMR, 6 decimals for unit prices/FX), append-only immutable invoice/credit-note tables, `name_ar` / `name_en` columns, configurable country weekend arrays (Fri–Sat vs. Sat–Sun), and Playwright/HarfBuzz RTL HTML-to-PDF/A-3 rendering.
* **Outreach to 5–8 UAE MoF-accredited ASPs** asking explicitly for: (a) zero-minimum PAYG API or referral/co-sell terms, (b) whether inbound AP (Corner 3) is included, and (c) how the 100 free annual exchanges apply to SaaS-integrated SMEs.


* **Month 3 (Weeks 5–12): First Country MVP (UAE or KSA)**
* **If zero-minimum UAE ASP is signed:** Ship UAE Pack (5% VAT + Emirate Box 1 + FAF export + CT 0%/9% + SBR toggle + PINT AE outbound/inbound via ASP sandbox/voluntary mode) ahead of the UAE SME window.
* **If ASP minimums are too high ($500+/mo):** Pivot to **Native KSA Phase 2 MVP** (UBL 2.1, `secp256k1` signing via KMS/Vault, per-EGS ICV/PIH chain, 9-tag QR, PDF/A-3, 15% VAT return) with zero vendor cash burn.
* Validate billing/collection mechanics (MoR vs. local reseller) so WHT/non-resident VAT doesn't eat revenue.


* **Month 6: Production Hardening & Second Country**
* Add **WPS SIF payroll export** and basic **EOSB calculator** for Country #1 (unblocks HR/ERP bundle sales).
* Ship Country #2 (KSA native if UAE was #1, or UAE via ASP if KSA was #1).
* Add **advance-payment invoice netting** and **inbound AP XML ingestion** (for Peppol markets).


* **Month 12: Regional Expansion & Infrastructure Scaling**
* Reuse UAE Peppol ASP adapter + KSA QR encoder to ship **Oman PINT OM** (if Oman pipeline exists and ASP covers Oman).
* Evaluate regional cloud deployment (`me-central-1` UAE or `me-south-1` Bahrain) for GCC tenants if KSA PDPL or enterprise deals require in-region data residency.
* Re-evaluate Bahrain (fast follower on 3-decimal + 10% VAT) and Qatar (only if Official Gazette enacts binding law).



### Revisit Triggers (Change Plan Immediately If Any Occur)

1. **No zero-minimum UAE ASP found** → Drop UAE as Country #1; build Native KSA first or defer GCC.
2. **UAE MD 197/2026 or KSA Wave 25 fails live verification** (e.g., data residency still required in UAE, or Wave 25 delayed) → Recalculate hosting cost and country priority immediately.
3. **Saudi B2B customers withhold 5%–15% WHT on Roxira's own SaaS invoices** → Switch GCC billing to a Merchant of Record or local reseller partner.
4. **GCC tenant count exceeds 50 active SMEs or 25,000 invoices/month** → Provision dedicated GCC cloud region (`me-central-1` / KSA) + managed HSM/KMS and re-negotiate volume Peppol ASP pricing.
5. **Qatar gazettes binding e-invoicing law with 2027 SME dates** → Pull Qatar ahead of Bahrain (reusing KSA's centralized UBL/ECDSA/PDF/A-3 stack if Qatar confirms that architecture).

---

## 4. Open Questions Requiring a Human Expert (With Recommended Defaults)

1. **UAE ASP Contract & Free-Quota Legal Interpretation (UAE Tax Lawyer / ASP Commercial Lead)**
* *Question:* Under MD 168/2026, can a foreign SaaS vendor white-label an accredited ASP's API without triggering UAE licensing/accreditation obligations itself, and do SME end-users onboarded via Roxira still receive the statutory 100 free annual exchanges (including inbound AP)?
* *Default until answered:* Use a **direct-contract / referral integration model** where the SME holds the direct legal agreement with the ASP and connects via OAuth/API key into Roxira—zero regulatory liability and zero platform minimum for Roxira.


2. **Cross-Border SaaS Withholding Tax & Non-Resident Digital VAT (GCC Tax Advisor)**
* *Question:* Will Roxira's Malaysian Sdn Bhd SaaS invoices to KSA/UAE/Oman SMEs trigger 5%–15% WHT in KSA/Oman or mandatory non-resident VAT registration when selling to non-VAT-registered SMEs?
* *Default until answered:* Route GCC self-serve subscriptions through a **Merchant of Record (e.g., Paddle)** that handles non-resident digital VAT, and explicitly state in B2B terms that prices are **exclusive of WHT** (gross-up clause) until volume justifies a local entity/reseller.


3. **KSA PDPL Cross-Border Transfer & ZATCA In-Kingdom Data Accessibility (Saudi Privacy/Tax Counsel)**
* *Question:* Can Roxira host KSA tenant accounting and HR/payroll data on non-KSA servers (e.g., AWS UAE `me-central-1` or EU) using PDPL Standard Contractual Clauses, or does ZATCA/PDPL enforcement require in-Kingdom servers for SME SaaS?
* *Default until answered:* Architect PostgreSQL with **region-portable tenant isolation** from day one; host initial KSA pilots on **AWS Bahrain (`me-south-1`) or UAE (`me-central-1`)** with encrypted backups and on-demand local archive export, and move to a KSA region only when revenue covers the ~$150–$300/mo infra delta.


4. **ZATCA Annex 1 Multi-Tenant Cloud Key Custody (KSA ZATCA Compliance Specialist)**
* *Question:* Does ZATCA accept multi-tenant cloud HSM/KMS envelope encryption (where private keys are non-exportable from KMS) as compliant with Annex 1's prohibition on exporting cryptographic stamping keys, or do they require dedicated per-tenant HSM partitions?
* *Default until answered:* Generate and keep every tenant EGS `secp256k1` private key inside **managed KMS/HSM (non-exportable asymmetric signing key)**—never store raw private keys in PostgreSQL or application memory.


5. **UAE & KSA "Smart Judge" Unauthorized Practice of Law Boundaries (GCC Legal Counsel)**
* *Question:* What exact disclaimers and guardrails are required so an AI legal/tax research assistant serving GCC SMEs does not constitute unlicensed legal consultancy under UAE/KSA bar regulations?
* *Default until answered:* Restrict "Smart Judge" in GCC packs to **cited informational search over official Arabic/English statutory texts only** (zero personalized legal/tax advice, prominent non-lawyer disclaimer, mandatory link to primary gazette/authority text).


6. **KSA Zakat Denominator & Mixed-Entity Accounting Validation (Saudi SOCPA CPA)**
* *Question:* Under MR 1007/2024 Art. 15, should automated Gregorian Zakat scaling use a fixed 354-day denominator or the exact Umm al-Qura day count (354 vs. 355) of the overlapping Hijri year, and what minimum CoA tags are required for automated Zakat base reporting?
* *Default until answered:* Make the Hijri denominator a **configurable fiscal-year parameter defaulting to 354** with an explicit CPA-review warning banner—do not auto-file Zakat returns without accountant sign-off.
