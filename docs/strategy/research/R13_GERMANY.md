# Research R13 — Germany country pack (digest)

Source: the owner's deep-research run R13, stage 1 (36 requirements, build-vs-buy, three phases) and stage 2 (primary-source check against gesetze-im-internet.de, eur-lex.europa.eu, xeinkauf.de, ferd-net.de, bsi.bund.de, developer.datev.de, elster.de, gkv-datenaustausch.de), received 2026-11-17. Stage 2 arrived mixed with the research tool's own working notes; only its findings are used. **Verified** = primary text seen by stage 2. **Secondary** = only advisory or vendor sites; goes into pack data with `verified: false` and is checked before the adapter ships.

## Key decision
Germany has no official certification for accounting software. We build the ledger side (GoBD, exports, e-invoices, DATEV, ELSTER) ourselves. We buy only what needs a certificate: a BSI-certified cloud TSE for POS, a Peppol access point, and payroll through a certified partner (ITSG system examination is mandatory even for in-house payroll software; verified, GKV spec 01/2026).

## Facts

| Area | Fact | Status |
|---|---|---|
| Retention | 8 years for vouchers and invoices, 6 years for commercial letters (§ 147 AO, § 257 HGB, § 14b UStG). 10 years for books and annual accounts. | 8/6 verified; 10 secondary |
| Invoice storage | § 14b Abs. 2, 5 UStG: invoices stored in Germany; storage elsewhere in the EU must be notified and allow immediate online access by the tax office. | verified |
| Penalties | § 146 AO Verzögerungsgeld EUR 2,500–250,000; § 26a UStG fines up to EUR 5,000; § 379 AO up to EUR 25,000. | verified (amounts); which subsection applies to tills: secondary |
| GoBD | Immutable postings with Storno-only corrections, capture timestamp, auditor access Z1 (read-only), Z2 (queries), Z3 (data handover in GDPdU format: `index.xml` + DTD + CSV). | secondary (BMF texts not retrieved) |
| VAT rates | 19% standard, 7% reduced (§ 12 UStG). | verified |
| Small business | § 19 UStG: exempt if prior year ≤ EUR 25,000 and current year ≤ EUR 100,000; crossing 100,000 mid-year ends the exemption. § 34a UStDV: such invoices may stay paper/PDF but must carry the tax number, VAT id or small-business id, and "Gutschrift" on self-billing. | thresholds verified; mid-year cliff mechanics secondary |
| VAT return frequency | § 18 UStG: monthly if prior-year VAT > EUR 9,000; annual exemption possible at ≤ EUR 2,000; otherwise quarterly. Permanent extension (1/11 special prepayment) by 10 February. | verified |
| E-invoicing | Receiving structured e-invoices is mandatory since 1 Jan 2025. Issuing: from 1 Jan 2027 if 2026 turnover > EUR 800,000, everyone from 1 Jan 2028. Invoices ≤ EUR 250 exempt (§ 33 UStDV, verified). | dates secondary (§ 27 Abs. 38 UStG text not retrieved) |
| BMF letter 15 Oct 2026 | Service description (type, scope, place) must sit in the XML; supporting files (timesheets, bills of quantities) must be embedded, not sent as separate email attachments; final invoices after advance payments and gross-price invoices have transition rules to 30 Jun 2030; non-objection ends 31 Dec 2026. | secondary |
| Formats | XRechnung 3.0 (bundle 3.0.2, 31 Jan 2026) in UBL 2.1 or CII; KoSIT validator 1.6.0; rule PEPPOL-EN16931-R120 is a warning now and will become fatal. ZUGFeRD 2.5.2 / Factur-X 1.09.2 (published 4 Aug 2026, valid 1 Sep 2026, CII D22B); a release with gross invoices and the revised EN 16931 is announced for autumn 2026. Self-billing needs Peppol BIS Self-Billing, not BIS Billing. GEBA is the default Peppol identifier in Germany (KoSIT, 11 Nov 2026, headline only). | verified; GEBA details not retrieved |
| ZUGFeRD profiles | MINIMUM and BASIC WL are not valid e-invoices; the XML wins over the PDF text. | secondary |
| Open source | KoSIT validator configurations: Apache-2.0. Mustangproject (ZUGFeRD generator/validator): Apache-2.0, Java. node-zugferd: MIT but marked work-in-progress. | verified |
| DATEV EXTF 700 | Buchungsstapel category 21 (format 13, min 12), Debitoren/Kreditoren 16 (format 5), Sachkontenbeschriftungen 20 (format 3); CP1252 or UTF-8 with BOM; max 99,999 postings per file; amount never 0,00; Belegfeld 1 only `[\w$&%*+\-/]{0,36}`; Belegdatum is TTMM, the year comes from the header's fiscal-year start; DATEV's own header regex for the format version omits 3. | verified (docs undated) |
| HGB size classes | Micro ≤ EUR 450k assets / 900k revenue / 10 staff; small ≤ 7.5M / 15M / 50; medium ≤ 25M / 50M / 250 (two of three). Late-filing fine EUR 2,500–25,000 (reduced to 500 / 1,000 / 2,500). | verified |
| E-Bilanz | Taxonomy 6.9 for FY 2026, 6.10 for FY 2027; account-level proofs (Kontennachweise) required, the free-text waiver ends with 6.10; Grundsteuer in its own account; asset history sheet and notes required for FYs from 2028. | secondary |
| ELSTER | ERiC library and manufacturer id (Hersteller-ID) from the Bavarian tax office; each tenant files with its own ELSTER certificate. | portal verified; ERiC v44, test flags and schemas secondary |
| POS | Every electronic till needs a BSI TR-03153 TSE. Swissbit Cloud TSE 2 certified under TR-03153-1 v1.1.1 (29 Oct 2026); fiskaly (2025) and Deutsche Fiskal (2022) under v1.0.1. Certificate expiry dates not seen. Tills are registered with ELSTER since 1 Jan 2025. DSFinV-K 3.0 optional 2028, mandatory 2029; a draft bill (23 Sep 2026) would require tills above EUR 100k turnover and electronic receipts from 2028. | certificates verified; DSFinV-K 3.0 and draft bill secondary |
| ViDA | Directive (EU) 2025/516: 1 Jan 2027 (single VAT registration, OSS/IOSS changes, Implementing Regulation 2026/1869), 1 Jul 2028 platform rules (latest 1 Jan 2030; under annulment cases T-393/25, T-394/25), 1 Jul 2030 cross-border digital reporting. Member states may defer input-VAT deduction until payment for cash-accounting suppliers. | verified; the 10-day issue limit is secondary |
| AI | EU AI Act Art. 50 transparency duties apply since 2 Aug 2026. | date verified; exact duties not retrieved |
| Data protection | § 38 BDSG: a data protection officer is required once 20 people regularly process personal data. | verified |

## Not taken from the report
- Engineering-week estimates and the phase calendar; lanes plan their own rows.
- Commercial API prices (TSE, Peppol, payroll): retail figures only, no wholesale quotes. Decided when the POS phase starts.
- Pinning hosting regions: an infra decision, not a pack row.

## Phases
1. **Bookkeeping (rows T186–T190, after the core rows T177–T180):** GoBD, e-invoices in and out, VAT data and returns, DATEV export, ELSTER and E-Bilanz.
2. **POS** (later): certified cloud TSE, DSFinV-K with a 3.0-ready event model, receipts, till registration. No row until phase 1 is merged.
3. **Payroll** (later): HR master data in Roxira, certified partner calculates, locked wage journals come back. No in-house German payroll.

## To check with a German tax advisor before phase 1 ships (defaults in brackets)
1. Exact text of the 15 Oct 2026 BMF letter (default: embedded attachments, itemised service description, net unit prices).
2. § 19 mid-year cliff mechanics (default: warn at 90% of each threshold, stop exempt invoices above EUR 100,000).
3. § 13b domestic reverse-charge categories (default: codes locked until the tenant's advisor confirms).
4. SKR03/SKR04-compatible chart naming (default: neutral name "Standard-Kontenrahmen DE", 4-digit accounts, separate Grundsteuer account).
5. ERiC terms for a multi-tenant SaaS (default: each tenant uses its own ELSTER certificate).
6. GoBD procedure documentation (default: we ship the system part; the customer completes its process part).
