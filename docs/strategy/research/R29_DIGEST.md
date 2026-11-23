# R29 digest: SaaS security and trust baseline for EU SMEs and tax advisors (2026-11-21)

Full report with source table: `R29_RAW.md`. Stage 1 and Stage 2 done by one agent with web search and
page fetches. Prices are mostly vendor or broker estimates: ranges, not quotes. Recheck before spending.

## Verified facts (primary page read)
- **Tax advisors, section 62a StBerG** (statute page): a text-form contract with a confidentiality
  undertaking and a warning of criminal consequences; access limited to what is needed; sub-providers
  bound in text form; foreign processing only with comparable protection; consent for single-mandate
  services. A plain GDPR DPA does not satisfy it (commentary, not statute).
- **DATEV Marktplatz** (DATEV pages): certificate mandatory for **Premium Partners** since 30 Jun 2026;
  started-but-unfinished may file until 31 Dec 2026, else the partnership ends. **Schnittstellen
  Partners: not required**, recommended. Accepted: ISO 27001 (plus 27701/27017/27018 on top), C5,
  IT-Grundschutz and Basis-Absicherung, TISAX, Art. 42 auditor, **VdS 10000, CISIS12, TUEV TRUST IT**.
  **SOC 2 and CSA STAR are not on the list.** DATEV quotes 6-18 months preparation.
- ISO 27001:2022 is the only valid edition since 31 Oct 2025 (plus Amendment 1:2024). OWASP ASVS 5.0.0
  exists (30 May 2025). Art. 30(2) processor records apply to us; Art. 33: processor tells controller
  "without undue delay" (no hour count); BDSG section 38 DPO triggers (20 people, DPIA-class, commercial transfer).
- Trivy supply-chain compromise 19-22 Mar 2026 (Aqua advisory): malicious release and rewritten action tags.
- German NIS2 law in force 6 Dec 2025 (law firms); SaaS is a NIS2 matter, not CRA, unless remote
  processing is needed by a shipped product.

## Cost ranges (VENDOR, 2-person team)
- ISO 27001: first year about EUR 6-25k (narrow scope, little consulting) to 35k+ (broad); surveillance
  about 33-70% of the first audit. SOC 2: USD 25k+ first year, poor fit here. Lighter: CAIQ v4 / STAR L1
  self-assessment free; SME ISMS (VdS 10000, CISIS12) prices NOT found.
- Pentest Germany: EUR 5-15k plus EUR 1.5-3k retest, yearly. Cyber plus Tech E&O: US/UK about
  USD 1.5-7.5k per year; no German price found.
- Cheap path: own scanners (Trivy, Semgrep, gitleaks, OSV-Scanner, ZAP baseline, testssl.sh), public
  trust pack, AVV from the Commission's 2021/915 clauses plus a section-62a addendum.

## Proposed decisions (hub view)
1. Strategy B: self-published trust pack now, DATEV Schnittstellen listing first, one SME-grade ISMS
   certificate only when DATEV or a deal demands it (ISO 27001 if within 25% of the cheapest). No SOC 2.
2. **Remove the China-based AI vendor from the customer-data path for EU tenants** and give EU tenants
   an EU-resident, no-training routing profile.
3. EU-law AVV plus section-62a addendum plus sub-processor list plus TOMs annex, one lawyer review.
4. Make scanners block new HIGH/CRITICAL with a remediation SLA; checksum-verify Trivy; SHA-pin actions.
5. Backup evidence: dated restore test, written RPO/RTO, Object-Lock copy.
6. Pentest (ASVS L2, tenant isolation and AI) month 4-6; insurance before paid external tenants.
Indicative year-1 cash: EUR 2-5k (steps 1-5 plus insurance) up to 15-40k with pentest and certificate.

## Owner decisions (not for agents)
- Is "customer data may improve the service" (R8) kept for tax-advisor tenants? Default: off for them.
- Budget gate for the certificate (about EUR 8-20k) and the pentest (about EUR 7-18k).
- Whether the DATEV channel is a target at all (Premium needs a certificate; Schnittstellen does not).

## Conflicts with existing docs
- `docs/legal_customer/SUBPROCESSORS.md` lists a China-based model vendor over ledger data as the
  primary engine: incompatible with section 62a Abs. 4 for tax advisors.
- `docs/legal_customer/DPA.md` is Malaysia-PDPA-first, GDPR "where applicable": needs an EU-law AVV.
- AGENTS.md section 4 / R8 "data may improve the service" vs the processor role (Art. 28(3)(a)).
- `docs/STATE.md` (hourly encrypted off-site backups) vs `docs/security/SECURITY_AUDIT_2026-10-20.md`
  (no off-site copy, restic not configured): reconcile with a dated restore test.
- `docs/ops/CI_SCANNERS.md` keeps scanners report-only; buyers ask for fix SLAs.
- R2/R3: production RLS bypass (T105) still open; blocks an honest "strong tenant isolation" answer.

## NOT verified
Prices of VdS 10000, CISIS12, TUEV TRUST IT and any German insurance quote; DATEV fees and the
Schnittstellen conditions beyond the FAQ; NIS2 size threshold and fine figures (read only in law-firm
notes); BSI registration deadline; CJEU progress on C-703/25 P (filing date conflicts between sources);
Product Liability Directive B2B scope; whether Trivy 0.75.0 in our CI is clean; whether any tool
licence other than ZAP changed; Digital Omnibus final text (only a Council mandate, not law).

## Proposed GitHub rows
| Lane | Title | Done when |
|---|---|---|
| L3 security/data | EU tenant AI routing profile: no China-based or may-log providers for tax-advisor/EU tenants | Config flag exists, tested route table, `SUBPROCESSORS.md` updated, one test proves the blocked path |
| L3 security/data | EU-law AVV + section-62a confidentiality addendum + TOMs annex | Drafts in `docs/legal_customer/`, based on 2021/915 clauses, lawyer review recorded |
| L3 security/data | Backup and DR evidence pack (reconcile STATE vs audit, quarterly restore test, RPO/RTO, Object Lock copy) | Dated restore-test log in repo, written RPO/RTO, docs consistent |
| L1 ops | CI scanner hardening: blocking HIGH/CRITICAL, remediation SLA, Trivy checksum, SHA-pinned actions, ZAP baseline nightly | Done (PR #1303): `docs/security/REMEDIATION_SLA.md`, `scripts/dev/install_trivy.sh`, `zap-baseline-nightly.yml`, pinned actions verified |
| L3 security/data | Trust pack v1: security page, 6 policies, CAIQ v4 Lite on STAR L1, questionnaire answer bank | Public page live, CAIQ filed, answer bank in `docs/security/` |
| L3 security/data | Tenant-isolation test report and production RLS bypass fix (T105) | CI RLS audit green, report committed, superuser path removed or compensated |
| L1 ops | Insurance + pentest procurement (broker quotes Tech E&O + cyber; 3 pentest quotes with ASVS L2 scope) | Quote comparison table in `docs/strategy/`, owner decision asked |
| L3 security/data | Incident response and breach-notice runbook with 48 h customer notice, security.txt, retention table per data class | Runbook merged, drill done once, `security.txt` served |

## Second opinion (Gemini Deep Research, 2026-11-21)

Saved unchanged in `R29_GEMINI.md` (Stage 1 and Stage 2). This section does not replace anything above. Rule used: where the two sides conflict, the claim with a primary URL and a date wins; everything else is UNVERIFIED until a lane reads the page.

### Agreements
- Section 62a StBerG: a plain GDPR DPA does not satisfy it; a text-form addendum with the criminal-consequence warning and text-form flow-down to sub-providers is needed (statute page on gesetze-im-internet.de, both sides).
- DATEV Premium Partner certificate mandatory since 30 Jun 2026, grace to 31 Dec 2026 for started processes; Schnittstellen Partners are not covered (DATEV pages, both sides). Both put VdS 10010 on top of VdS 10000 in the lower tier.
- ISO 27001:2013 certificates ended 31 Oct 2025; 2022 edition only.
- A processor tells the controller without undue delay; promise a customer notice time we can meet (this digest: 48 h, Gemini: 24-48 h). The 72 h clock belongs to the controller.
- The DPF is valid; General Court dismissed the challenge on 3 Sep 2025; appeal C-703/25 P pending. Keep SCCs as a fallback. Gemini gives lodging date 31 Oct 2025 from the court register, which matches the date in this digest's RAW row.
- Art. 30(2) processor records, SDM-based TOMs, restore drills with a dated record, Object Lock copy, tamper-evident audit log, insurance only after the controls exist.

### Conflicts (resolved by primary URL and date, else UNVERIFIED)
| Topic | This digest | Gemini | Verdict |
|---|---|---|---|
| ISO 27001 first-year cost | EUR 6-25k narrow scope | EUR 12.5-25k DIY, 23-49k consultant-led (vendor blog, Aug 2026) | UNVERIFIED both; vendor estimates. Keep our range, get quotes (T290). |
| Pentest price | EUR 5-15k plus retest | from about EUR 3-3.5k (two vendor rate cards) | UNVERIFIED; scope decides. Ask three quotes with ASVS L2 scope (T290). |
| German insurance price | none found | exali tariff pages: IT liability from EUR 125 net, cyber from EUR 145 net; sample sums | Gemini gives vendor pages, so keep as an indicative range only; the lane must re-read the exali pages and a broker. One DCD figure was read from a page for architects, not IT. |
| SDM guarantees | not stated | 7 guarantees; Resilience (Art. 32(1)(b)) is not an eighth | Gemini's own correction of its Stage 1 is right: use 7 in the TOMs annex. |
| SOC 2 log retention | not stated | Stage 2 says AICPA sets no fixed 12-month number | Treat 12 months as an operating norm, not a rule. |
| Scanners | Trivy compromised 19-22 Mar 2026 (Aqua advisory, GHSA-69fq-xp46-6x23); pin and checksum | Recommends Trivy and TruffleHog without noting this | This digest wins (primary advisory). TruffleHog is AGPL-3.0: fine as a CI tool, never in the runtime; the T252 licence gate must allow-list it explicitly. |
| CRA | SaaS is a NIS2 matter unless remote processing is needed by a shipped product | Same, plus: any local connector or desktop client is in scope; reporting duties from 11 Sep 2026, full duties 11 Dec 2027 | Dates UNVERIFIED (Gemini cites EUR-Lex 2024/2847 but gives no article text). Check only if we ever ship a local connector. |

### Only one side has it
- **Gemini only:** German standard-terms law (sections 307/309 BGB) can void a US-style liability cap; GoBD and structured e-invoice duties as a procurement veto for German tax advisors; AI Act buyer audits from 2 Aug 2026; CLOUD Act exposure of a US-parent host even in an EU region; Art. 37 DPO trigger beyond the 20-person rule; two-person segregation-of-duties problem for the ISO internal audit. All UNVERIFIED (no primary text in its sources). The first two are worth an expert answer.
- **This digest only:** DATEV accepted-certificate list including CISIS12 and TUEV TRUST IT and the exclusion of SOC 2 and CSA STAR; NIS2 law in force 6 Dec 2025; Trivy incident; the conflicts with SUBPROCESSORS.md, DPA.md, STATE.md and R8.

### Row changes
- No new row. Comments added to the existing rows: #1109 (T286: liability cap under sections 307/309 BGB, SDM has 7 guarantees, GoBD note), #1111 (T288: TruffleHog licence note for T252), #1113 (T290: indicative insurance and pentest ranges from Gemini, UNVERIFIED), #1112 (T289: log retention wording).
- The EU-tenant routing profile (D1) is owner-decided (2026-11-21) and tracked in #1108; nothing here changes it.

### Expert questions added (default in brackets)
1. Does our standard liability clause survive sections 307/309 BGB? [carve out intent, gross negligence, life/body/health; cap simple negligence on core duties at foreseeable typical loss, within insured limits]
2. Does our workflow need a GoBD process document for German tax advisors? [append-only storage, DATEV-compatible export, plain-language process document template]
