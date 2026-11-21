# R29 RAW: SaaS security and trust baseline for selling to European SMEs and tax advisors

Date: 2026-11-21. Method: web search plus page fetches on primary pages where reachable. Status
legend: VERIFIED (primary page read), PARTIAL (primary page read but a detail missing, or primary
statute seen only through a commentary), VENDOR (price or claim from a vendor or broker blog, treat as
a range), UNVERIFIED (not confirmed). Prices are EUR or USD as quoted; they were not converted.
Facts first (Stage 1), then Stage 2 (re-check, missed risks, decision pack, open questions).

## STAGE 1 - FACTS

### 1. What buyers in this segment actually require

1. **Tax advisors (Steuerberater) have a statutory duty that is stricter than GDPR.** Section 62a
   StBerG: the advisor must choose a provider carefully; the contract must be in text form, bind the
   provider to confidentiality with a warning of the criminal consequences, limit access to what is
   needed, and say whether the provider may use further persons (who must be bound in text form too).
   For services performed abroad, secrets may be disclosed only if protection is comparable; for
   services serving one single mandate, the client's consent is needed (Abs. 5). Source: statute page,
   read directly (the page shows no "Stand" date; text assumed current). A plain GDPR Art. 28 DPA does
   not replace this: commentary says §62a needs its own confidentiality undertaking (secondary source).
   Consequence for us: every tax-advisor customer needs a **§62a confidentiality addendum** next to the
   DPA, and our sub-processors must be bound the same way or be themselves under a statutory duty.
2. **DATEV Marktplatz (the main channel to German tax advisors) now requires a security
   certificate for Premium Partners.** Obligation from 30 Jun 2026; partners who had started
   certification may file it until 31 Dec 2026 (presence deactivated meanwhile); without proof by
   31 Dec 2026 the Premium partnership ends. **Schnittstellen Partners do not need one** (recommended
   only; they must implement a DATEV data service and pass a technical interface check). Accepted list
   (DATEV page): ISO 27001 (+27701/27017/27018 only on top of 27001), BSI C5, BSI IT-Grundschutz and
   Basis-Absicherung, TISAX, an Art. 42 GDPR certification auditor (cloud, SMEs), **VdS 10000**,
   VdS 10010 (on top of 10000), **CISIS12**, **TUEV TRUST IT Trusted Application**. **SOC 2, CSA STAR and
   Cyber Trust Label are not on the page.** Scope must include development and operation of the
   marketplace solution. DATEV states preparation takes 6-18 months and that it publishes submitted
   certificates unchecked; the partner alone is responsible for security. VdS 10005 and ULD were dropped
   (search snippet of a DATEV deck, PARTIAL).
3. **Germany implemented NIS2** (law in force 6 Dec 2025, BSI registration within 3 months, i.e. by
   about 6 Mar 2026; management liability; fines up to EUR 10M or 2% turnover for essential entities per
   law-firm summaries). Cloud computing services, including SaaS, are in the digital sector. Size rule
   (recital 12 of the CRA text confirms SaaS is a NIS2 matter and that medium-sized or larger cloud
   providers are in scope): a 2-person company is below the size line, but **its customers that are in
   scope must flow supply-chain security duties to us by contract**. Medium threshold figures (50 staff
   or EUR 10M) are from the 2003/361 Recommendation by memory, UNVERIFIED here: check Art. 2 of the Annex.
4. **Cyber Resilience Act:** pure SaaS is mainly a NIS2 matter; only remote data processing that a
   product with digital elements needs in order to function is in CRA scope. Commission draft guidance
   exists (communication dated 17 Nov 2026 per a search snippet, PARTIAL). Relevant only if we ship an
   installable client or agent. Dates (reporting from 11 Sep 2026, full 11 Dec 2027) come from R26.
5. **EU Product Liability Directive 2024/2853** applies to products placed on the market after
   9 Dec 2026; software including SaaS is a "product" (law-firm summaries, consistent). Strict liability
   covers damage to natural persons, including data loss; our B2B exposure is mainly consumers and sole
   traders who use the software privately. Scope detail UNVERIFIED (needs lawyer).

### 2. Certification options and costs for a 2-person team

All numbers below are vendor or broker estimates (VENDOR). Treat as ranges, get 2-3 quotes.

| Option | What it is | One-off (first year) | Recurring | Time | Fit |
|---|---|---|---|---|---|
| Self-published trust pack (security page, CAIQ v4 on CSA STAR Level 1, DPA, sub-processor list, TOMs) | Self-assessment, public, not an audit. STAR self-assessments are updated annually. CAIQ Lite exists for SMEs/startups. Optional AI scoring fee USD 595 (CSA page) | EUR 0 to 2k of our own time | annual refresh | 1-3 weeks | Enough for many SME buyers; not for DATEV Premium |
| Art. 42 GDPR certification / Europrivacy | EDPB approved Europrivacy as a European Data Protection Seal in 2026 (Opinions 14 and 15/2026; secondary source, PARTIAL). Not enough for security by itself; DATEV accepts "Art. 42 auditor" | UNVERIFIED | UNVERIFIED | UNVERIFIED | Later |
| VdS 10000 / CISIS12 / TUEV TRUST IT (SME ISMS) | Lighter ISMS standards, on the DATEV accepted list. Audit prices not found | UNVERIFIED (ask 2 certifiers) | UNVERIFIED | UNVERIFIED | Candidate cheapest DATEV-valid route |
| BSI IT-Grundschutz Basis-Absicherung | Accepted by DATEV; TUEV Nord calls Grundschutz modular but complex, suited to larger bodies | UNVERIFIED | UNVERIFIED | months | Probably too heavy |
| ISO 27001:2022 | 2013 certificates expired 31 Oct 2025; current baseline is 2022 plus Amendment 1:2024 (climate). Stage 1, Stage 2, annual surveillance, 3-year recertification | Cert-body fees: about 5 audit days at about USD 1,500 per day = about USD 7.8k for 1-10 staff; first year 6-12k (1-10 staff) or 10.5-21k (10-25 staff) including consulting; Secfix: EUR 10-25k total first year; SECJUR gives EUR 35-160k (broader scope) | Surveillance about 33-70% of the initial audit; internal audit and tooling extra (compliance platform about USD 7.5-20k per year if used) | 1-4 months prep (Secureframe) to 6-18 months (DATEV) | Strongest evidence in Germany, accepted by DATEV |
| SOC 2 Type II | US attestation; CPA firm | Platform USD 7.5-20k per year (Vanta list USD 14k, Drata AWS listing USD 15k for 1-50 staff); audit USD 5-30k+; first year total USD 25k-200k; renewals often 30-50% above year-1 discounts | repeat yearly | 3-12 months incl. observation window | Weak fit for German SMEs and not on DATEV list; useful only for US buyers |
| Open-source compliance tooling (Comp AI, AGPL-3.0; Probo free tier) | Evidence collection and policy templates; you still pay the auditor | tooling 0-10k | - | - | Good cost lever; licence AGPL is fine for internal use |

Key reading for us: the cheapest credible ladder is (a) self-published trust pack now, (b) a
DATEV Schnittstellen listing first (no certificate), (c) one DATEV-accepted SME-grade ISMS certificate
only when the DATEV channel or a customer requires it, with ISO 27001 as the portable choice. SOC 2 is
not worth it for this market.

### 3. Penetration tests and scanners

- German market day rates EUR 1,100-1,800 (Berlin consultancy blog, VENDOR); grey-box test of a SaaS
  web app EUR 5-15k excluding VAT for 5-10 days; retest EUR 1.5-3k extra; multi-tenancy, SSO, payments
  and APIs push to the top of the range; very cheap quotes are often automated scans in disguise.
- Cadence buyers expect: once a year and after major change. Scope for us: auth, tenant isolation (RLS
  bypass attempts, IDOR across tenants), the AI assistant (prompt injection, cross-tenant retrieval),
  file upload/import, e-invoice and bank import parsers, admin paths.
- Standard to test against: OWASP ASVS 5.0.0 (released 30 May 2025, VERIFIED on the OWASP page; it no
  longer maps to CWE directly). Use ASVS level 1 as our self-check list, level 2 for the pentest brief.
- **Open-source scanners we can run ourselves:** Trivy (already in CI, report-only), Semgrep CE
  (already, custom rules), gitleaks, OSV-Scanner, OWASP ZAP (now "ZAP by Checkmarx", still Apache-2.0
  and free; 2.17.x line, PARTIAL), Nuclei, testssl.sh, Lynis for host hardening, Scorecard for the repo.
  Licences other than ZAP not re-verified here (UNVERIFIED).
- **Supply-chain warning (VERIFIED, Aqua advisory GHSA-69fq-xp46-6x23 and Aqua blog):** on 19 Mar 2026
  an attacker used stolen credentials to publish a malicious Trivy release (v0.69.4) and rewrite tags of
  `trivy-action` and `setup-trivy`; later malicious Docker images (0.69.5/0.69.6) followed. Advice:
  pin to full commit SHAs, rotate secrets seen by affected runs. Our CI downloads a release tarball by
  version (0.75.0) and does not use the action, which avoids the tag problem, but it does no checksum
  or signature check. Whether 0.75.0 is clean was not checked here.

### 4. GDPR processor paperwork

- Art. 28 DPA: the Commission's standard clauses for controller-processor are Implementing Decision
  (EU) 2021/915 (optional, usable in whole or part); third-country transfers use 2021/914 SCCs. Public
  model AVVs exist (Bavarian interior ministry model, Austrian WKO model, Berlin DPA checklist), good
  starting outlines. A recent EDPB statement (10 Nov 2026, Statement 3/2026) concerns onward-transfer
  model clauses; not read in full (PARTIAL).
- Art. 30(2) processor records are required: the under-250-staff exemption does not apply to
  non-occasional processing, risky processing, or special categories (VERIFIED on the GDPR text mirror,
  which is a secondary host of the EUR-Lex text). Payroll data and health-adjacent HR data make our
  processing non-occasional anyway.
- Art. 33: controller notifies the authority within 72 h of awareness; the processor must tell the
  controller "without undue delay" (no fixed hours in the law). Customers will ask for 24-48 h in the
  contract.
- DPO: section 38 BDSG requires a DPO at 20 or more people constantly processing, **or** when the
  processing needs a DPIA, **or** when personal data is processed commercially for transfer or market
  research. A small processor is usually below this, but DPIA-class processing (large-scale payroll
  and AI profiling-adjacent features) is a trigger to check with a lawyer.
- EU-US transfers: General Court upheld the DPF on 3 Sep 2025; appeal C-703/25 P filed 31 Oct 2025 is
  pending, no ruling found (secondary sources). Commission review expected 2027.
- Digital Omnibus (GDPR part): Council has a negotiating mandate (late Oct 2026); Parliament had not
  set its position and trilogues had not started as of the latest source found. The proposals (72 h to 96 h,
  authority notification only for high risk, a single EU reporting point) are **not law**. Do not build
  to them.

### 5. Evidence enterprise questionnaires ask for (and what we hold today)

Typical formats: CSA CAIQ v4 (free, public), SIG Lite (126 questions, buyer-side, vendor-risk tools),
buyer custom sheets, and for tax advisors a short list tied to §62a/DATEV. Recurring question families
and our status from repo docs (not verified on the live server today):

| Family | Typical question | Our evidence / gap |
|---|---|---|
| Governance | Security policy, owner, annual review, training | None published; write 6 short policies |
| Access | MFA everywhere, least privilege, joiner/leaver, admin separation | Tenant RLS forced; production still bypasses RLS via superuser (T105, R2/R3 digest) |
| Data | Encryption at rest and in transit, key management, data location | Hosting provider holds ISO 27001 (Hetzner page, PARTIAL); app-level key story not documented |
| Tenant isolation | How are tenants separated, tested? | RLS plus planned CI audit (R2/R3 digest); needs a test report |
| Logging | Audit trail, retention, tamper resistance | AI audit split planned; retention policy for security logs not defined |
| Backup/DR | Frequency, off-site, restore test, RPO/RTO | STATE says hourly encrypted off-site backups plus DR drill; the 20 Oct audit said no off-site copy (older). Reconcile and keep a dated restore-test record |
| Vulnerability mgmt | Scanning, patch SLA, pentest date | Scanners are report-only; no SLA; no pentest |
| Incident | Process, notification time, contact | Not written; SECURITY.md exists |
| Sub-processors | List, DPAs, change notice | Draft list exists; contains a China-based AI vendor (see conflicts) |
| Subcontract/AI | Is customer data used for training? Where do prompts go? | Current terms say customer data may improve the service |
| Exit | Data return and deletion | EU Data Act switching rules from 12 Jan 2027 (R26) |

### 6. Insurance

- No German-market price found. Indicative US/UK broker figures (VENDOR): cyber for small SaaS about
  USD 1.5-7.5k per year, median about USD 3k (Vouch), about USD 130/month (Insureon); a German source gives
  USD 750-8,000 per year for cyber liability in general. Marsh reports US cyber rates down 2% in Q2 2026
  (soft market) with sublimits creeping in.
- SaaS vendors usually buy **both** Tech E&O / IT-Haftpflicht (service failure, software defect causing
  customer loss) and cyber (attack, breach), often bundled. German insurers commonly require MFA and
  tested backups (broker summaries). Limits and retentions matter more than headline premium.

### 7. Source table

| Claim | URL | Source date | Status |
|---|---|---|---|
| §62a StBerG duties (Abs. 1-5) | https://www.gesetze-im-internet.de/stberg/__62a.html | no Stand shown | VERIFIED |
| §62a vs plain AVV, encryption, cloud practice | https://www.deubner-steuern.de/themen/digitalisierung-steuerberatung/ki/62a-stberg.html and https://www.rechtslupe.de/beruf/it-compliance-in-der-steuerberatung-zwischen-§-203-stgb-und-§-62a-stberg-3349058 | Aug 2026 / n.d. | PARTIAL (commentary) |
| DATEV Premium certificate deadline 30.06.2026, grace 31.12.2026 | https://www.datev.de/web/de/berufsgruppenuebergreifend/ueber-datev/portfolio/oekosystem/partnering/datev-marktplatz/datenschutz-und-informationssicherheit | page shows deck updated 27.10.26 | VERIFIED |
| DATEV: Schnittstellen Partner no certificate needed | https://www.datev.de/web/de/berufsgruppenuebergreifend/ueber-datev/portfolio/oekosystem/partnering/datev-marktplatz/faq-fuer-softwarehersteller | n.d. | VERIFIED |
| DATEV accepted certificate list | https://www.datev.de/web/de/berufsgruppenuebergreifend/ueber-datev/portfolio/oekosystem/partnering/datev-marktplatz/zertifikate-datenschutz-und-informationssicherheit | n.d. | VERIFIED |
| DATEV 6-18 months prep, VdS 10005 dropped | https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/datev-marktplatz-partner/Information_Zertifikate_DATEV_Marktplatz_Premium_Partner.pdf (PDF unreadable by fetch; figures from search snippets) | 2025-2026 | PARTIAL |
| German NIS2 in force 6 Dec 2025, BSI registration | https://www.mayerbrown.com/de/insights/publications/2025/12/cyber-rules-for-essential-and-important-entities-take-effect-in-germany-nis2-implementing-law | 15 Dec 2025 | PARTIAL (law firm) |
| CRA recital 12: SaaS is NIS2 | https://prighter.com/resources/laws/cyber-resilience-act/recitals/recital-12 | n.d. | PARTIAL |
| CRA vs SaaS | https://www.dlapiper.com/en/insights/publications/2026/02/cyber-resilience-act-the-fine-line-between-saas-and-digital-products | Feb 2026 | PARTIAL |
| PLD 2024/2853 applies from 9 Dec 2026, includes SaaS | https://www.reedsmith.com/articles/eu-product-liability-directive-software-digital-products-cybersecurity/ | 2025 | PARTIAL |
| ISO 27001:2013 transition ended 31 Oct 2025 | https://www.bsigroup.com/globalassets/localfiles/en-my/ISO 27001/resources/v0.5_bsi_iso-27001-timeline.pdf | n.d. | PARTIAL |
| ISO 27001 cost ranges | https://heydata.eu/en/magazine/iso-27001-costs-2026-certification-sme ; https://drata.com/learn/iso-27001/audit-cost ; https://www.kertos.io/en/compliance-hub/iso-27001-cost | 2026 | VENDOR |
| Secfix EUR 10-25k; SECJUR EUR 35-160k | https://www.secjur.com/blog/iso-27001-kosten and Secfix guide pages | 2026 | VENDOR |
| SOC 2 cost ranges, Vanta/Drata listings | https://drata.com/blog/soc-2-audit-cost ; https://soc2auditors.org/insights/vanta-pricing/ | 2026 | VENDOR |
| Comp AI open source (AGPL-3.0) | https://www.helpnetsecurity.com/2026/04/07/comp-ai-open-source-compliance-platform/ | 7 Apr 2026 | PARTIAL |
| Pentest prices Germany | https://kolonell.com/en/blog/web-application-penetration-test-cost-berlin-2026 ; https://7asecurity.com/blog/2026/04/the-2026-guide-to-penetration-testing-pricing-and-scoping/ | 2026 | VENDOR |
| OWASP ASVS 5.0.0 (30 May 2025) | https://github.com/OWASP/ASVS | 2025 | VERIFIED (search snippet of project page) |
| ZAP by Checkmarx, Apache-2.0 | https://www.zaproxy.org/blog/2026-02-02-zap-updates-2025-highlights-2026-plans/ | 2 Feb 2026 | PARTIAL |
| Trivy supply-chain compromise Mar 2026 | https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23 ; https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know/ | Mar 2026 | VERIFIED (search result summaries of both) |
| Art. 28 SCCs 2021/915, SCC 2021/914 | https://eur-lex.europa.eu/eli/dec_impl/2021/915/oj | 2021 | PARTIAL (result list) |
| Art. 30 processor records, 30(5) | https://gdpr-info.eu/art-30-gdpr/ | n.d. | VERIFIED (mirror) |
| Art. 33 timing | https://gdpr-info.eu/art-33-gdpr/ | n.d. | VERIFIED (mirror) |
| BDSG section 38 DPO rule | https://www.gesetze-im-internet.de/bdsg_2018/__38.html | n.d. | VERIFIED |
| DPF appeal C-703/25 P pending | https://connectontech.bakermckenzie.com/eu-us-data-privacy-framework-still-business-as-usual/ ; https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20251201-european-court-of-justice-to-review-challenge-to-eu-us-data-privacy-framework | 2025-2026 | PARTIAL; CJEU register not read |
| Digital Omnibus GDPR status (Council mandate, Parliament pending) | https://www.cuatrecasas.com/en/global/intellectual-property/art/digital-omnibus-eu-council-establishes-position | 27 Oct 2026 | PARTIAL |
| Europrivacy EDPB opinions 14 and 15/2026 | https://www.infolawgroup.com/insights/2026/6/16/europe-just-activated-a-new-tool-for-cross-border-data-transfers | 16 Jun 2026 | PARTIAL |
| CSA STAR L1 / CAIQ v4 free | https://cloudsecurityalliance.org/star/self-assessment/ | n.d. | PARTIAL |
| Hetzner ISO 27001:2022 (Nuremberg, Falkenstein, Helsinki) | https://docs.hetzner.com/general/others/certificates | n.d. | PARTIAL |
| Cyber insurance ranges | https://www.vouch.us/blog/startup-insurance-costs ; https://versicherungsmakler.ac/cyberversicherung/ | 2026 | VENDOR |

## STAGE 2 - SKEPTICAL REVIEW OF STAGE 1

### 2.1 Re-check table (numbers, dates, legal claims)

| Claim | Re-check result | Status |
|---|---|---|
| DATEV 30 Jun 2026 / 31 Dec 2026 | Read on DATEV's own page and FAQ. One deck snippet says 1 Jul 2026; the page text wins. | VERIFIED |
| "Schnittstellen Partner need no certificate" | Stated in FAQ and in the search summary of DATEV pages; the fetched page itself is silent on that group. Re-read the Marktplatz contract before relying. | PARTIAL |
| SOC 2 not accepted by DATEV | Absent from the accepted list page (a negative from one page; the list may have footnotes). Ask DATEV. | PARTIAL |
| Aqua dates (19-22 Mar 2026) | Two sources agree on 19 Mar; tag counts differ (76 of 77 vs 75 of 76). We cite no count. | VERIFIED (dates) |
| German NIS2 in force 6 Dec 2025; BSI registration deadline | Law firms agree on 6 Dec 2025 and a 6 Mar 2026 deadline (one firm says April). Not read on BSI/BGBl. | PARTIAL |
| NIS2 fine "EUR 10M or 2%" | Heuking summary; the Directive's figures apply to essential entities (important: EUR 7M or 1.4%, from memory, UNVERIFIED). We rely on neither. | UNVERIFIED detail |
| PLD 9 Dec 2026, SaaS counted | Consistent across firms; one firm notes entry-into-force date differences of a day. Official Journal not opened. | PARTIAL |
| ISO 27001 cost ranges | All vendor sources; ranges disagree by 5x (USD 7.8k vs EUR 160k). Scope (2 people, one product) puts us at the low end only if scope is narrow and no consultant is hired. | VENDOR |
| Pentest EUR 5-15k | Single-consultancy blogs plus synthesis; consistent with 5-10 days at EUR 1.1-1.8k. | VENDOR |
| Insurance prices | No German price found; US ranges only. | UNVERIFIED for Germany |
| Art. 30(5), Art. 33, BDSG 38 | Read the texts. | VERIFIED |
| DPF appeal pending | Case number and filing date from secondary sources; one source says January 2026 for the filing, another 31 Oct 2025. Dates conflict; case number consistent. | PARTIAL, dates CONFLICT |
| Europrivacy as Art. 46(2)(f) seal | One law-firm article (corrected on re-read: it was the EDPB, not the Commission). | PARTIAL |

### 2.2 What the first pass missed (12-24 month risks)

1. **China-based AI sub-processor in our own draft list.** `docs/legal_customer/SUBPROCESSORS.md`
   lists a Chinese model vendor (routed via a gateway) as the primary reasoning engine over ledger
   data. A tax advisor must check "comparable protection" abroad (§62a Abs. 4) and there is no EU
   adequacy for that jurisdiction. This alone can lose every Steuerberater deal and attract a
   supervisory complaint.
2. **"Customer data may be used to improve the service" (owner decision, R8) vs the processor role.**
   Under Art. 28(3)(a) a processor acts on documented instructions; using customer personal data for
   own purposes makes us a controller for that use and needs a legal basis. For tax advisors, client
   data is also under §203 StGB secrecy. Needs a lawyer; default: opt-in only for tax-advisor tenants.
3. **Our draft DPA is Malaysia-first.** It lists PDPA 2010 as the first framework and GDPR as "where
   applicable". EU buyers want an EU-law AVV (Art. 28(3) content, SCCs where needed) with German-law
   confidentiality addendum.
4. **§62a addendum is a separate document** with criminal-law warning text, and sub-processors need
   the same binding in text form. Missing today.
5. **Backup status is contradictory** in repo docs (hourly encrypted off-site backups vs "no off-site
   copy"). A questionnaire answer must be backed by a dated restore test; insurers also ask.
6. **Scanners are report-only** and have no remediation SLA. Buyers ask "how fast do you fix
   high/critical"; "we look at a report" fails. Also HIGH findings (about 164-179 dependency alerts per
   STATE) are open.
7. **CI supply chain:** after the Trivy incident, our tarball-by-version download has no checksum or
   signature verification; also no SHA pinning for actions was verified here. A compromised scanner in CI
   with deploy secrets is the worst case.
8. **Production RLS bypass (superuser, T105)** contradicts any "strong tenant isolation" claim in a
   questionnaire; do not answer "yes" until fixed or compensated and tested.
9. **Incident notification promises:** the law gives processors no hour count, but contracts will ask
   24-48 h; we have no on-call, so a promise we cannot keep is a liability. Choose 48 h and build the process.
10. **AI-specific buyer questions** (training on prompts, retention, prompt injection, tenant leakage in
    vector store) are becoming standard; the CSA also has AI-specific assessment material (UNVERIFIED).
    Our "free models first, may-log providers" policy is a disclosure item.
11. **Two-person ISMS pitfalls:** independence of the internal audit, separation of duties, access
    reviews, and device encryption/MDM for two laptops. An auditor will ask who reviews the admin.
12. **Public repository** gives attackers the source: need a vulnerability disclosure policy
    (SECURITY.md exists; no `security.txt` found), secret scanning clean-up and a rule for infra hints.
13. **DATEV rules can widen.** Certification is already compulsory for Premium Partners; a later extension
    to all partners is plausible (UNVERIFIED). Budget the VdS/ISO decision as a 6-12 month item.
14. **Growth thresholds:** at 50 staff or EUR 10M we likely enter NIS2 (verify), plus DPO under BDSG at 20
    staff handling data; and the PLD applies from 9 Dec 2026 regardless of size.
15. **Data retention vs minimisation:** audit-log retention (90 days for AI telemetry, statutory years for
    accounting) must be written down; questionnaires ask for periods per data class.
16. **Insurance exclusions:** insurers exclude failure to maintain minimum controls and sometimes
    cover only EU-law fines that are insurable; MFA/backups are conditions, so insurance depends on item 5.

### 2.3 Decision pack

Options: **A** self-published trust pack only; **B** A + DATEV Schnittstellen listing + SME ISMS
certificate later; **C** ISO 27001 now with a platform; **D** SOC 2. Recommendation: **B**, with ISO 27001
as the target certificate if DATEV or a customer forces it (portable abroad, e.g. Gulf and Malaysia
buyers also recognise it; SOC 2 not needed).

| Item | Recommendation | One-off | Monthly | Effort | Reversible? |
|---|---|---|---|---|---|
| D1 Remove or isolate the China-based model path for customer data of EU tenants; EU-tenant routing profile (EU-resident, no-training endpoints) | Do now | 0-1k (engineering time) | model cost delta | 3-5 days | Yes (config) |
| D2 EU AVV (Art. 28) + §62a addendum + sub-processor list + TOMs annex, lawyer-reviewed once | Do now | EUR 1-3k lawyer (estimate, UNVERIFIED) | 0 | 1 week + review | Yes |
| D3 Trust pack: security page, policies (6), CAIQ v4 Lite on STAR L1, questionnaire answer bank | Month 1-2 | 0 | 0 | 1-2 weeks | Yes |
| D4 Scanners: make Trivy/Semgrep/gitleaks/OSV blocking for new HIGH/CRITICAL; SLA (critical 7 d, high 30 d); checksum-verify Trivy; SHA-pin actions; add ZAP baseline nightly vs staging | Month 1-3 | 0 | 0 | 3-5 days | Yes |
| D5 Backup evidence: reconcile docs, quarterly restore test, written RPO/RTO, Object-Lock copy | Month 1 | 0-100 | EUR 5-30 storage (estimate) | 2 days + 0.5 day/quarter | Yes |
| D6 Pentest (grey-box, ASVS L2, tenant isolation and AI focus) with retest | Month 4-6, before first paying tax-advisor tenant if possible | EUR 6-15k + retest 1.5-3k | 0 | 2 weeks coordination | One-off |
| D7 Insurance: Tech E&O + cyber via a broker, limits EUR 1M, check MFA/backup conditions | Before paid external tenants (after 9 Dec 2026 PLD) | 0 | about EUR 150-600 (US/UK range, UNVERIFIED for DE) | 3 days | Cancellable yearly |
| D8 DATEV: apply as Schnittstellen Partner first | Month 3-6 | 0 (DATEV fees UNVERIFIED) | 0 | 2-4 weeks | Yes |
| D9 SME-grade ISMS certificate (ISO 27001 or VdS 10000/CISIS12, whichever the certifier quote makes cheapest) | Start month 6, cert month 9-12 | EUR 8-20k incl. audit; platform optional | surveillance 3-7k per year; tooling 0-1.5k per year | about 25-40 days own time | Hard to undo (sunk), but optional |
| D10 Fix production RLS bypass (T105) and publish an isolation test report | Month 1-3 | 0 | 0 | 1-2 weeks | Yes |

Cumulative cash estimate: month 1-3 about EUR 1-3k (lawyer only); by month 6 add EUR 6-18k (pentest,
insurance first year); by month 12 add EUR 8-20k (certificate). Total year 1: roughly EUR 15-40k if all
done; EUR 2-5k if we stop at D1-D5 plus D7. These are planning ranges built on VENDOR figures.

Timeline: month 1 = D1, D2 (draft), D5, D10 start; month 3 = D3, D4 done, D8 filed; month 6 = D6, D7 live,
decision gate on D9; month 12 = certificate in hand or a documented reason why not.

Revisit triggers: DATEV extends the certificate duty to Schnittstellen Partners; any prospect with
over 20 seats or a bank/insurer client asks for ISO; first security incident; headcount reaches 10;
CJEU rules on C-703/25 P; Digital Omnibus adopted; 3 deals lost over missing certification.

### 2.4 Open questions for human experts (with defaults)

1. Does a German lawyer consider our current AI routing acceptable for tax-advisor tenants, and what must
   the customer consent text say under §62a Abs. 5? Default: EU-only inference for those tenants.
2. Is processing customer data to "improve the service" lawful for a processor, and can it be limited to
   anonymised/aggregated metrics? Default: off for tax-advisor tenants, opt-in elsewhere.
3. Is a DPO required (BDSG section 38, DPIA-class processing)? Default: external DPO-as-a-service only if
   the lawyer says yes; otherwise a named privacy contact.
4. Which SME ISMS certificate does DATEV treat as lowest-friction, and what does it cost (VdS 10000,
   CISIS12, TUEV TRUST IT)? Default: ask DATEV partner management and two certifiers for quotes; pick
   ISO 27001 if within 25% of the cheapest.
5. Does the PLD change our B2B liability caps and insurance wording? Default: keep caps at 12 months fees
   and let the broker confirm the policy covers PLD claims.
6. Are we inside NIS2 scope via any special rule, and what supplier clauses will customers get from
   their own obligations? Default: assume out of scope, answer supplier questionnaires.
7. Insurance: limits, retentions, whether the China-based sub-processor or "free providers may log"
   is an exclusion trigger. Default: EUR 1M limit, resolve D1 first.
8. Retention periods per data class (accounting 8-10 years by statute, logs, call recordings).
   Default: written table, lawyer reviews once.
