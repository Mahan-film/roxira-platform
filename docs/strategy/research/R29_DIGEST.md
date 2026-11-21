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
| L1 ops | CI scanner hardening: blocking HIGH/CRITICAL, remediation SLA, Trivy checksum, SHA-pinned actions, ZAP baseline nightly | Required checks set, SLA doc merged, pinned-action audit passes |
| L3 security/data | Trust pack v1: security page, 6 policies, CAIQ v4 Lite on STAR L1, questionnaire answer bank | Public page live, CAIQ filed, answer bank in `docs/security/` |
| L3 security/data | Tenant-isolation test report and production RLS bypass fix (T105) | CI RLS audit green, report committed, superuser path removed or compensated |
| L1 ops | Insurance + pentest procurement (broker quotes Tech E&O + cyber; 3 pentest quotes with ASVS L2 scope) | Quote comparison table in `docs/strategy/`, owner decision asked |
| L3 security/data | Incident response and breach-notice runbook with 48 h customer notice, security.txt, retention table per data class | Runbook merged, drill done once, `security.txt` served |
