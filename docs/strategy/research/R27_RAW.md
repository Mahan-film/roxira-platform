# R27 RAW: Malaysia country pack (second pack after the default pack)

Date of research: 2026-11-21. Author: research agent (Sonnet 5.5). Method: web search plus direct download of regulator PDFs
(LHDN/IRBM guidelines, SDK pages, SSM deck, LHDN payroll list). Status legend: VERIFIED (primary source read, URL and date given),
VERIFIED-2 (primary source not readable from here; two or more independent secondary sources agree), CHANGED (differs from an
earlier Roxira doc), UNVERIFIED (could not confirm). Facts are in PART A/B; recommendations are only in PART C/D.
Nothing here is legal or tax advice. Rates and thresholds are never to be hardcoded: they go in effective-dated config.

Access note: the regulator sites kwsp.gov.my, perkeso.gov.my, customs (mysst) rule pages and some LHDN HTML pages returned 403/404/timeouts to
automated fetches. LHDN PDFs, the MyInvois SDK pages, the SSM deck and the HASiL payroll-software list were readable.

## PART A. FACTS (STAGE 1)

### A1. MyInvois e-invoicing (LHDN/IRBM)

Phases (e-Invoice Guideline v4.8, section 1.5, read in full from the PDF; v4.9 Specific Guideline dated 7 Sep 2026):
- Phase 1: turnover/revenue above RM100m, from 1 Aug 2024.
- Phase 2: above RM25m up to RM100m, from 1 Jan 2025.
- Phase 3: above RM5m up to RM25m, from 1 Jul 2025.
- Phase 4: up to RM5m, from 1 Jan 2026 (and 1 Jul 2026 for those whose threshold-year turnover put them in the second tranche, per Table 16.1 wording "i) 1 January 2026 and ii) 1 July 2026 implementation date").
- Determination basis: audited statement of comprehensive income for FY2022, else YA2022 tax return; later turnover changes do not change the assigned date (guideline s.1.5).
- Voluntary early adoption allowed at any turnover.
- New businesses: started YA2023-2025 with turnover of at least RM3m: 1 Jul 2026. Started YA2026 onward: 1 Jul 2026 or at start; if first-year turnover is below RM3m, 1 Jan of the second year after the year turnover reaches RM3m.

Exemption (guideline v4.8 s.1.6.1(e), s.1.6.10): taxpayers with annual turnover or revenue **below RM3,000,000** are exempt (all taxpayer types).
It does NOT apply if the taxpayer (a) has non-individual shareholder(s) with turnover of at least RM3m, (b) is a subsidiary of a holding company with turnover of at least RM3m,
or (c) has a related company / joint venture (Promotion of Investments Act 1986 definition) with turnover of at least RM3m.
Changed date: raised from RM1m to RM3m; announced 30 Aug 2026 (The Star and Bernama, "effective Sept 1").
Also exempt: foreign diplomatic offices, non-business individuals, listed statutory bodies (limited), and certain income types (employment income, pension, alimony, zakat, listed securities, some dividends, donations) (s.1.6.1, s.1.6.7).
General FAQ update (4 Sep 2026, via Grant Thornton alert of 8 Sep 2026): exempt taxpayers need no application or approval, face no compliance action or penalty, need not join the SVDP, and may stop issuing e-invoices immediately.

Interim relaxation (Specific Guideline v4.9, section 16, Table 16.1, read in full): for taxpayers with turnover up to RM5m, the relaxation runs **until 31 Dec 2027**
(Phases 1-3 relaxation periods have ended: 31 Jan 2025, 30 Jun 2025, 31 Dec 2025). During relaxation: consolidated e-invoices allowed for all transactions, including industries in s.3.7;
consolidated self-billed e-invoices allowed; free text allowed in the description field; no individual invoice needed even if the buyer asks; and IRBM will not prosecute under s.120 Income Tax Act 1967 provided s.16.2(a)/(b) are followed.
Outside relaxation: a transaction above RM10,000 needs its own (transactional) e-invoice; smaller ones may be consolidated if the buyer did not request an individual one (v4.9 example 24).
Consolidated e-invoices: monthly, submitted within 7 calendar days after month end (v4.9 s.3.6, examples).

Submission channels (guideline v4.8 s.2.2-2.4, Table 2.1): two mechanisms only: (1) MyInvois Portal (manual form, or batch spreadsheet upload), (2) API, either direct ERP integration, or via Peppol service providers, or via non-Peppol technology providers (intermediaries).
Note: the "four modes" in R8/T152 (`exempt`, `voluntary`, `relaxation`, `mandatory`) are Roxira pack states, not LHDN submission channels. LHDN has two channels. Keep the names but do not call them "LHDN modes".
Rejection/cancellation: buyer may request rejection, supplier may cancel, both within 72 hours of validation; after that a credit/debit note is needed (v4.8 s.2.3.6, 2.4.5).
Validation returns a QR code that must appear on the visual copy (v4.8). Digital certificate (.cer/.pfx) is used for signing on the API route (v4.8 s.2.4.1.1).
Foreign suppliers: a Malaysian buyer must issue a self-billed e-invoice (General FAQ 4 Sep 2026, via Grant Thornton). Non-Malaysian individuals: general TINs `EI00000000010` (MyPR/MyKAS only) and `EI00000000020` (passport only) (Specific Guideline v4.9 as summarised by Grant Thornton, 7 Sep 2026; code values VERIFIED-2).
The responsibility stays with the taxpayer even if a third-party provider is used (General FAQ, same source).

API limits (SDK pages, read 2026-11-21): requests per minute per client ID: login 12 (taxpayer and intermediary), submit documents 100, get submission 300, cancel 12, reject 12, get document 60,
get document details 125, get recent documents 12, search documents 12, search TIN 60, validate TIN 60, taxpayer QR 60; HTTP 429 with Retry-After on breach. Token valid 60 minutes by default (cache it).
Submit documents: max submission 5 MB, max 100 documents per submission, max 300 KB per document; HTTP 202 on accept (validation is asynchronous); DuplicateSubmission (422) if identical content within 10 minutes; IncorrectSubmitter (403) if an intermediary lacks authorization. Sandbox: lower rate limit than production (effective 28 Apr 2025); sandbox data kept at most 3 months.
Sandbox access mechanics (portal URL, taxpayer onboarding, intermediary registration steps): UNVERIFIED in this run (SDK onboarding pages not fetched). Source to read: sdk.myinvois.hasil.gov.my "Getting started" / "Registering ERP system".

Penalties: Income Tax Act 1967 s.120; secondary sources give fine RM200-RM20,000 or imprisonment up to 6 months or both (VERIFIED-2: ClearTax, a software-vendor FAQ; official guideline v4.9 only says "prosecution under s.120"). Per-invoice stacking claimed by one commercial site: UNVERIFIED.
e-Invoice SVDP: runs 7 Jul 2026 to 31 Dec 2027 (v4.9 s.17.1, read); rectification uses credit notes plus new e-invoices; disclosure per taxpayer, not per group; special e-invoice versions "SVDP 1.2" (unsigned) and "SVDP 1.3" (signed) (v4.9 example 24).
Penalty-waiver detail of the SVDP (which errors, which penalties): UNVERIFIED (NST 2026-10 says full waiver for clerical errors; not read from LHDN).

Free competitor: MyInvois e-POS, free from LHDN for businesses with annual sales up to RM5m; includes sales, inventory and accounting-style reports, generates e-invoices on buyer request and consolidated e-invoices on a set date; runs on phone or tablet (The Star 2026-07-08, VERIFIED-2 with HASiL-hosted press PDFs). R8 said "launched in 2026": launch year UNVERIFIED (one source says 2024); what is verified is free status and scope.

Peppol: MDEC is the Peppol Authority; centralized Malaysian SMP; accredited service providers include large vendors (VERIFIED-2, several vendor pages). Peppol is optional; MyInvois clearance is still required (the LHDN guideline lists Peppol providers as one API route). Peppol is not needed for a domestic SME pack.

### A2. SST (Royal Malaysian Customs)
- Service tax rate 8% for most taxable services (PwC Malaysian Tax Booklet 2026/27; KPMG), with a 6% rate for rental/leasing (Service Tax (Rate of Tax) (Amendment) Order 2026, gazetted 13 Mar 2026, retrospective to 1 Jan 2026), and 6% for F&B, telecom, parking (VERIFIED-2). One search summary wrongly stated the whole rate fell from 8% to 6%; KPMG shows it is rental/leasing only: CHANGED vs that summary.
- Registration threshold for taxable services: RM500,000 over 12 months (VERIFIED-2: PwC and others; mysst page did not state it).
- Digital services by foreign providers to consumers in Malaysia: registered once above RM500,000 per 12 months; 8% (VERIFIED-2). Regulations: "Service Tax (Digital Services) (Amendment) Regulations 2026" listed on the customs site dated 27/10/2026, reported by VAT Update (2026-10-30) as changing filing and payment rules; content UNVERIFIED.
- Software and IT services: Customs issued an updated Service Tax Guide on Information Technology Services (26 Feb 2026, VERIFIED-2); software development, online platform development, customisation, installation, support, cloud and managed data-centre services are listed taxable IT activities. A Malaysian vendor selling SaaS to Malaysian businesses must check whether it is a taxable person (RM500,000 threshold) and charge service tax on invoices. Group and exact scope: UNVERIFIED (guide not read).
- Returns: PwC says every 2 months for local taxable persons; one vendor says quarterly for foreign digital providers: UNVERIFIED which applies (the Oct 2026 regulation may alter this).
- Customers' side (invoice content): service tax identification number and tax amount on invoices; also reported on e-invoice (tax type code). Detailed mapping UNVERIFIED.

### A3. Payroll statutory items (rates are config; official tables)
| Item | Fact | Status |
|---|---|---|
| EPF (KWSP) | Citizens/PR under 60: employer 13% for wages up to RM5,000, 12% above; employee 11% (standard). Third Schedule bands for wages up to RM20,000; actual-percentage above. Employers may have no wage ceiling. | VERIFIED-2 (payroll vendor guides; kwsp.gov.my returned 403) |
| EPF foreigners | Mandatory from 1 Oct 2025, 2% employer + 2% employee (The Star 2025-02-05; NST 2026-10: Finance Ministry says no change decided) | VERIFIED-2 |
| SOCSO / PERKESO | Wage ceiling RM6,000 from 1 Oct 2024 (Malay Mail, NST 2024-10-01) | VERIFIED-2 |
| EIS | 0.2% employer + 0.2% employee, up to the same ceiling, via band table | VERIFIED-2 |
| SOCSO categories | Category 1 (injury + invalidity) vs Category 2 (injury only, usually age 60+): shares differ; conflicting figures across sites | UNVERIFIED: use the PERKESO table |
| LINDUNG 24 Jam / SKBBK | Employment-injury scheme extension; contribution to rise gradually (RinggitPlus) | UNVERIFIED |
| HRD Corp levy | 1% of monthly wages for employers with 10+ Malaysian employees (mandatory); 5-9 employees optional (sources say 0.5%); applied to basic wages plus fixed allowances; sector scope sources conflict | VERIFIED-2 (HRD Corp portal text quoted by a search, not fetched) |
| PCB / MTD | LHDN publishes a yearly "Specification for MTD Calculation Using Computerised Calculation" (2026 edition exists) and a list of payroll software that passed its tests; list "as at 12 Oct 2026", updated every two weeks, 77 PDF pages. Employers using listed software need no further verification | VERIFIED (list PDF downloaded and read; spec itself not read) |
| EA form, Borang E | EA statement to employees and Borang E to LHDN, annual (deadlines 28/29 Feb and 31 Mar) | UNVERIFIED this run; from prior knowledge only |
Where the official tables live: KWSP Third Schedule and employer pages (kwsp.gov.my); PERKESO contribution-rate tables (perkeso.gov.my "contribution rate"); LHDN employer section (MTD spec, TP1/TP3 forms, approved-software list); HRD Corp employer pages and eTRiS.
Payroll software approval means answering LHDN's MTD test cases correctly, then being listed (earlier R8 finding confirmed by the list header).

### A4. Bookkeeping rules for a Sdn Bhd
- Audit exemption: Companies Act 2016 s.267(1) requires an auditor; s.267(2) lets the Registrar exempt. SSM Practice Directive 10/2024 (deck read) applies to financial periods starting on or after 1 Jan 2025: a private company qualifies if it meets **any two of three** over the current and previous two years: income not above, total assets not above, employees not above (final level RM3m, RM3m, 30 staff), phased over three years. Phase table: first phase RM1m/RM1m/10, second RM2m/RM2m/20, third RM3m/RM3m/30 (VERIFIED-2; the deck's own phase table was an image; one source dates phase 3 from 2027, another from 2028: UNVERIFIED which). Excluded: companies lodging an s.260 exempt-private-company certificate, subsidiaries of public companies, foreign companies. Dormant companies stay exempt. SSM expects about 42% of active companies to benefit; companies with charges to banks usually keep auditing.
- Accounting standards: MFRS or MPERS (Malaysian Private Entities Reporting Standard) per the same deck (VERIFIED for the names; which entities may use MPERS: UNVERIFIED).
- Accounting records: s.245 Companies Act 2016; retention period commonly seven years: UNVERIFIED (not found in a primary source here).
- SSM filings (annual return, financial statement lodgement, director/address changes): UNVERIFIED this run beyond R8's Practice Directive 2/2017 note on business-nature change.
- Resident director requirement (s.196(4)): carried over from R8 (verified there against SSM FAQ).

### A5. Build vs buy
- LHDN accepts API submission directly from an ERP, or via intermediaries (Peppol and non-Peppol). No certification of the software by LHDN is required for MyInvois (no approved-vendor list exists for e-invoicing; contrast with the payroll-software list). UNVERIFIED: absence of a certification scheme inferred from the guideline text and SDK; confirm on SDK "register ERP".
- Our own Sdn Bhd can register as an **intermediary** on MyInvois so customers authorise it to submit on their behalf (IncorrectSubmitter error semantics VERIFIED; registration procedure UNVERIFIED).
- Cheapest compliant path: own API client against the SDK sandbox, no Peppol, intermediary mode. Per-customer data needed: TIN, SST number if any, business classification (MSIC) code, digital certificate only if signing is used (v4.8; the SVDP signing variants suggest signing is optional).
- Peppol access point: needless unless a customer demands it; cost not researched.

## PART B. SOURCE TABLE

| Claim | URL | Source date | Status |
|---|---|---|---|
| Phases, exemption RM3m, group exclusions, new-business rules | hasil.gov.my/wp-content/uploads/IRBM-e-Invoice-Guideline.pdf (v4.8) | 30 Aug 2026 | VERIFIED |
| Relaxation to 31 Dec 2027 (up to RM5m), SVDP 7 Jul 2026 to 31 Dec 2027, RM10k example, 7-day consolidation | hasil.gov.my/wp-content/uploads/IRBM-e-Invoice-Specific-Guideline.pdf (v4.9) | 7 Sep 2026 | VERIFIED |
| RM1m to RM3m raised, effective 1 Sep | thestar.com.my/news/nation/2026/08/30/over-11-million-businesses-to-benefit-from-higher-e-invoicing-threshold-says-lhdn | 30 Aug 2026 | VERIFIED-2 |
| FAQ: no application, no penalty for exempt; self-billing foreign supplier; general TINs | grantthornton.com.my tax alert (30 Aug, 4 and 7 Sep 2026) | 8 Sep 2026 | VERIFIED-2 (summary of LHDN docs) |
| API limits, sizes, error codes, token 60 min, sandbox 3-month retention | sdk.myinvois.hasil.gov.my/integration-practices/ ; /einvoicingapi/02-submit-documents | read 2026-11-21 | VERIFIED |
| Penalty s.120 range RM200-RM20,000 / 6 months | cleartax.com/my/en/lhdn-penalties ; hasil FAQ | 2025-26 | VERIFIED-2 |
| e-POS free up to RM5m with inventory + accounting | thestar.com.my/news/nation/2026/07/08/myinvois-e-pos-free-platform-for-smes | 8 Jul 2026 | VERIFIED-2 |
| Peppol Authority is MDEC | peppol.org country profile; vendor pages | 2026 | VERIFIED-2 |
| Service tax rate 8%, rental 6% | pwc.com/my/en/publications/mtb/service-tax.html ; kpmg.com/my insights (Mar 2026) | 2026 | VERIFIED-2 |
| Customs site listing of 2026 digital-services regulation | mysst.customs.gov.my | listing to 6 Nov 2026 | VERIFIED (existence only) |
| IT services guide updated 26 Feb 2026 | vatupdate.com 2026/04/03 | 3 Apr 2026 | VERIFIED-2 |
| Payroll software list | hasil.gov.my/wp-content/uploads/List-of-Software-Provider-of-Payroll-System-approved-as-at-12-October-2026.pdf | 12 Oct 2026 | VERIFIED |
| EPF, SOCSO, EIS, HRD Corp figures | payroll guides, The Star 2025-02-05, NST 2024-10-01 and 2026-10 | 2024-26 | VERIFIED-2 |
| Audit exemption any two of three, RM3m/RM3m/30, excluded types | ssm.com.my/Pages/Publication/PDF Files/AD 2024 - New Audit Exemption Qualifying Criteria.pdf | early 2025 | VERIFIED (final level), phases VERIFIED-2 |

## PART C. STAGE 2: SKEPTICAL RE-CHECK

### C1. Re-check table (items that matter for code or pricing)
| Claim | Source | Result |
|---|---|---|
| Exemption RM3m, with group/related-party exclusions | v4.8 s.1.6.10 | VERIFIED. CHANGED vs R8/T152: R8 stated RM3m only; the group exclusions were missing and must be a pack flag. |
| Relaxation to 31 Dec 2027 | v4.9 Table 16.1 | VERIFIED. R8 said "relaxation" mode without an end date. |
| RM10,000 individual-invoice rule | v4.9 example 24 and s.16.2 | VERIFIED as "above RM10,000 needs a transactional invoice outside relaxation". Wording from an LHDN FAQ "from 1 Jan 2026" is secondary. |
| 72-hour cancel/reject | v4.8 | VERIFIED. |
| Consolidated: monthly, within 7 days after month end | v4.9 | VERIFIED. |
| "FX rate required" rule | v4.9 s.13 exists (heading "Currency exchange rate") | Heading VERIFIED; rule text not read: UNVERIFIED. |
| API 100 requests/min submit; 300 KB; 100 docs; 5 MB | SDK | VERIFIED. |
| Penalty RM200-20,000 | secondary | VERIFIED-2. |
| SOCSO ceiling RM6,000 | news | VERIFIED-2 (R8 said verified; keep). |
| EPF/EIS/PCB tables | not fetched | R8 said unverified: still UNVERIFIED for exact figures. |
| e-POS "launched 2026" (R8) | The Star | CHANGED: launch year unclear; feature scope (inventory, accounting) is wider than R8 implied. |

### C2. Missed risks (12-24 months) — at least 10
1. **Own-company exemption trap.** Our own Sdn Bhd is the MyInvois intermediary and also sells software; if it has a non-individual shareholder or is in a group with RM3m+ turnover, it is NOT exempt even if its own turnover is small (s.1.6.10). Matters: we could be non-compliant ourselves.
2. **Customer group status is invisible to us.** The pack mode `exempt` cannot be set from turnover alone: shareholder and related-company turnover decides. Wrong default means customers silently stop issuing e-invoices or get penalised. Needs a wizard question and an "assumed" flag.
3. **Relaxation ends 31 Dec 2027.** At that date up to RM5m customers must issue individual invoices (above RM10k, or on request). If we build consolidation only, we face a hard deadline migration in Q4 2027.
4. **Rules are changing monthly.** Guideline v4.7 (Apr 2026), v4.8 (30 Aug), v4.9 (7 Sep), FAQ updates (4 Sep): validation rules, TIN codes and version codes ("SVDP 1.2/1.3") changed within weeks. We need a regulation-watch job and effective-dated config with `source_url`.
5. **Intermediary liability.** The taxpayer stays responsible even when we submit for them (FAQ). If our bug mis-classifies, the customer is penalised and may claim against us. Terms and indemnity limits needed.
6. **Digital certificate and key custody.** Signing keys (.pfx) per customer: secrets handling, rotation, and the "no key in frontend" rule apply. Cost/complexity if we hold them.
7. **Service tax on our own SaaS.** A Malaysian vendor selling software services may need to register above RM500,000 and charge 8% (needs expert confirmation); the October 2026 digital-services regulation might also change filing and payment. Affects pricing display and invoices.
8. **Tax-type and classification codes.** Each line needs a classification code and tax type; wrong codes were the main SVDP trigger. Our POS needs a code-picker and a "missing code" report.
9. **Free competitor e-POS** includes sales, inventory and accounting for up to RM5m. For small shops our POS value is branch/BOM/multi-branch, not e-invoicing.
10. **Payroll software approval.** Payroll is gated by the LHDN test and listing, 2026 spec renewed yearly; each January a new spec means a re-test. Do not ship PCB without listing; wage CSV export stays.
11. **Statutory table drift.** EPF foreigner rate could rise (Finance Ministry comments Oct 2026), SOCSO category rates and LINDUNG are moving; HRD Corp sector scope is ambiguous. Hardcoding any of these breaks payroll output silently.
12. **Data residency and personal data.** TINs, IC numbers and passport numbers are personal data (PDPA 2010 and its 2024 amendments, e.g. mandatory breach notification and data-protection officer duties for some). Not researched here: UNVERIFIED but likely.
13. **Audit exemption interacts with our users.** Customers with bank loans usually still need audited accounts; export formats must match auditors' needs. SSM also sets MPERS vs MFRS choice; our ledger needs both chart mappings.
14. **Stamp duty and SST on e-invoice mixing.** Several taxes appear on one document; wrong order of rounding triggers validation failures (not researched, plausible).
15. **Sandbox data is deleted after 3 months** and has lower rate limits: CI tests that need long-lived sandbox objects will break.

### C3. DECISION PACK
Currency: RM figures are only for scale; costs in USD estimates, my judgement (UNVERIFIED as quotes).

| # | Decision | Options | Recommendation | One-off / monthly cost | Effort | Reversibility | Revisit trigger |
|---|---|---|---|---|---|---|---|
| D1 | MyInvois integration route | (a) manual portal for customers, (b) own API client as intermediary, (c) buy a certified Peppol/non-Peppol provider | (b) own thin API client, sandbox first; (a) as fallback for exempt customers | near 0 / near 0 (own Sdn Bhd already exists) | M (3-5 weeks agent time) | High: wrap behind an interface | A customer demands Peppol, or LHDN adds a certification scheme |
| D2 | Pack config model | Hardcode vs effective-dated config with `source_url`, `verified`, `as_of` | Effective-dated config; states `exempt/voluntary/relaxation/mandatory` plus a `group_flag` and `relaxation_end` | 0 | S | High | Any LHDN guideline version change |
| D3 | Exempt-customer default | assume exempt below RM3m / ask / assume mandatory | Ask 3 questions (turnover, corporate shareholder, related company at RM3m+); default `assumed_mandatory` if unanswered | 0 | S | High | LHDN publishes a self-test |
| D4 | Consolidated vs individual invoices | consolidated only / both | Build both now; show a 2027-12-31 relaxation-end banner | 0 | M | High | End of 2027 relaxation or LHDN extension |
| D5 | Payroll | defer / wage CSV / full PCB | Keep deferred (R8 decision 1); add effective-dated config tables for EPF/SOCSO/EIS/HRDF only as stubs; no computation | 0 | S | High | Roster customers ask for payroll, and we have budget for LHDN testing |
| D6 | Our own SST | ignore / register when threshold / ask adviser | Ask adviser now (open question Q2) | adviser fee, est. USD 100-300 once | S | High | Malaysian revenue approaching RM500,000 per 12 months |
| D7 | Product wedge vs e-POS | compete on e-invoice / on multi-branch POS+inventory+ledger | Keep R8 wedge; do not market e-invoicing as the hook | 0 | n/a | High | e-POS adds multi-branch or BOM |
| D8 | Regulation watcher | manual / job | Weekly fetch of LHDN guideline PDFs, version and hash diff to Telegram | 0 | S | High | n/a |

Timeline:
- **Month 1**: D2 config schema and seed values (RM3m exemption with group flags, relaxation end, 72 h, 7-day consolidation, API limits); D3 wizard questions; D6 adviser question; D8 watcher; register intermediary and sandbox access (needs human, Q1).
- **Month 3**: D1 API client in sandbox (login, submit, poll, cancel), per-endpoint rate limiter and Retry-After handling, 300 KB/100 doc/5 MB packers; consolidation job; QR on printouts.
- **Month 6**: Production pilot with 1-3 customers (own Sdn Bhd first); SVDP-aware credit-note flow; classification-code picker; payroll config stubs reviewed.
- **Month 12**: Individual-invoice mode default before 31 Dec 2027; decide payroll build-or-skip; review service tax status; DPO/PDPA review.

### C4. Open questions for human experts (with defaults)
1. Does LHDN require any registration or approval for a software vendor acting as intermediary, and what are the exact steps and audit duties? Default: register our own Sdn Bhd as intermediary per SDK, sandbox only until reviewed by an accountant.
2. Must our Sdn Bhd register for service tax on its SaaS and charge 8% to Malaysian customers (RM500,000 test; guide of 26 Feb 2026)? Default: not registered until revenue nears the threshold, monitor monthly.
3. Is our Sdn Bhd exempt from e-invoicing (shareholder or related-company test)? Default: assume mandatory.
4. Exact current EPF Third Schedule, PERKESO tables, EIS and HRD Corp sector scope? Default: load only after reading the primary tables; mark `verified=false`.
5. Which retention period applies to accounting and e-invoice records (Companies Act s.245, ITA s.82, SST)? Default: seven years from the end of the financial year.
6. PDPA 2010 (as amended) duties for a processor holding TINs and IC numbers: DPO, breach notice, cross-border transfer? Default: treat as personal data, minimise, encrypt at rest.
7. Do exempt customers who voluntarily join need a different version code? Default: same version as mandatory.
8. Is the FX-rate rule (v4.9 s.13) mandatory for foreign-currency lines and which rate source? Default: Bank Negara rate, stored with the document.

## PART D. WHAT CHANGED SINCE R8_FACT_CHECK (2026-11-16)
- Confirmed: RM3m exemption (R8 sourced to hasil page of 30 Aug 2026); SOCSO ceiling; MTD payroll list (now read: dated 12 Oct 2026, 77 pages).
- Added: group/related-company exclusion from exemption; relaxation end date 31 Dec 2027 for up to RM5m; SVDP 7 Jul 2026 to 31 Dec 2027; v4.8/v4.9 versions; exact API limits; e-POS scope includes inventory and accounting; Oct 2026 digital-services regulation; service tax IT guide 26 Feb 2026.
- Correction: the four "modes" are Roxira pack states; LHDN channels are Portal and API.
- Not resolved: EPF/EIS/PCB figures, retention period, SSM filing calendar, sandbox onboarding.
