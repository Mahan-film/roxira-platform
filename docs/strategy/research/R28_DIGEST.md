# R28 DIGEST: Gulf country packs

Date 2026-11-21. Full table and sources: `docs/strategy/research/R28_RAW.md`. Builds on `R14_GULF.md`.
VERIFIED = primary document read; VERIFIED-2 = two or more secondary sources. Rates, dates and fines go in effective-dated pack config (`source_url`, `as_of`, `verified`).

## Verified facts
- KSA Wave 25: VAT revenue above SAR 187,500 in any of 2022-2025, integrate with Fatoora by 1 Feb 2027; announced 24 Jul 2026 (zatca.gov.sa). VERIFIED. Wave 24 was SAR 375,000, 30 Jun 2026 (VERIFIED-2). ZATCA notifies a wave at least 6 months ahead.
- KSA Detailed Guideline v2: simplified (B2C) invoice any value; simplified for B2B only below SAR 1,000; Arabic required, Arabic or Hindi numerals both accepted; 24 h reporting; 9-tag TLV QR. VERIFIED (R14 had the SAR 1,000 as "not found").
- KSA Phase 1 fines (2021): SAR 5,000 not issuing, SAR 10,000 deleting or amending; missing QR or notice starts with a warning. VERIFIED. Phase 2 fine ladder: guides disagree, UNVERIFIED.
- UAE consolidated Decision 244/2025 + 66/2026 (FTA PDF, Jul 2026): pilot and voluntary from 1 Jul 2026; revenue >= AED 50m: ASP by 30 Oct 2026, live 1 Jan 2027; below: ASP by 31 Mar 2027, live 1 Jul 2027; government: live 1 Oct 2027. B2C is out of scope until the Minister decides. VERIFIED.
- UAE Decision 197/2026 (in force 1 Oct 2026): exclusions incl. exempt or zero-rated financial services and transactions inside one Tax Group for 24 months from 1 Jan 2027; issue within 14 business days; in-country storage rule repealed, records must be producible to the FTA. VERIFIED.
- UAE accreditation Decision 168/2026 (1 Oct 2026): pre-approval removed, third-party Peppol products allowed with outsourcing; 32 providers approved by May. VERIFIED.
- UAE VAT registration AED 375,000 mandatory, AED 187,500 voluntary. Small Business Relief to periods ending 31 Dec 2029, AED 3m threshold, Decision 131/2026 (7 Aug 2026). VERIFIED.
- Oman Decision 189/2026 (Gazette 9 Aug 2026): e-invoicing above OMR 5m from 1 Apr 2027, others 1 Oct 2027; pilot firms not fined until 31 Mar 2027. VERIFIED-2.
- Qatar: Cabinet approved a draft e-invoicing law on 6 May 2026, unpublished, no dates. VERIFIED-2. Kuwait: no VAT, none planned in 2026-2030, no e-invoicing. VERIFIED-2. Bahrain: no official e-invoicing date. VERIFIED-2.

## CHANGED versus R14
- UAE penalties: R14 cited Decision 173/2026, but the MoF page found describes the older 106/2025. 173/2026 repeals it. Latest (Sovos, 30 Oct 2026): AED 5,000 then 5,000 per month, cap 50,000 per 12 months; AED 100 per invoice or credit note, cap 5,000 a month; AED 250 a day for late ASP data notice, cap 5,000 a month. Arabic primary text not read, keep `verified:false`.
- PINT AE version: R14 says v1.1; sources show v1.0.1 and v1.0.3. Store as config.
- "Guideline v3 May 2026" (R14): the file read is v2; v3 not confirmed.

## Recommended order and cheapest path
1. Saudi Arabia first: own adapter, free ZATCA SDK and simulation portal, no accreditation or listing, no per-invoice fee. Phase 1 (generate, QR, Arabic) before Phase 2 (clearance, reporting).
2. UAE second: own PINT AE mapper and validator, one accredited provider behind a provider-neutral adapter, tenant bring-your-own ASP. Never become an ASP.
3. Oman third: reuse the UAE mapper, wait for the OTA spec.
4. Bahrain, Qatar, Kuwait: data-only packs, no e-invoice code until an official date exists.
All start after the DE rows and core T169 (owner rule: product first). Wave 25 is a market date, not a reason to jump the queue.

## Decisions (details in RAW)
- Option A (KSA self-build, UAE via partner ASP) recommended; B (resell one API) is the UAE fallback; C (become an ASP) rejected.
- Month 1: currency and business-day core, effective-dated pack config, KSA Phase 1. Month 3: KSA Phase 2 in CI. Month 6: PINT mapper, one ASP sandbox, pilot tenants. Month 12: second ASP, revisit HR and data law with an expert.
- Revisit: new ZATCA wave or amended UAE decisions, OTA spec, Qatar Gazette, Bahrain date, or no Gulf customer by month 6 (stop at KSA).

## Owner decisions needed
- Go or no-go on starting KSA after DE rows are merged, and whether to pay for one UAE ASP account.
- Whether the legal assistant is excluded from Gulf packs (default: yes).
- Whether to sell HR in the Gulf (default: no, accounting and e-invoicing only).

## Conflicts
R14 versus primary sources on UAE penalties and guideline version (above). Oman: the OTA FAQ still showed the old four-phase plan on 17 Aug 2026 while the Gazette decision gives two dates.

## NOT verified
CSID lifetimes; Phase 2 fines; UAE quarterly return rule; ASP requirements (ISO 27001, licence, Peppol membership); PINT AE version; Oman, Bahrain, Qatar primary sites; Gulf data-protection transfer rules; legal-practice rules for AI advice; HR statutory items. 17 missed risks are in RAW (rule churn, KSA Phase 1 mode, CSID expiry, business-day calendar, ASP lock-in, Arabic rendering and others).

## Changes to existing rows T174-T176 (#905-#907)
- T174: add Phase 1 generation-only mode first; SAR 1,000 and numeral config; CSID expiry monitor and hash-chain runbook; split into three PRs.
- T175: PINT version as config; 14-business-day timer; scope switches (B2C, financial services, intra-Tax-Group); split mapper from ASP adapter; Oman dates.
- T176: Small Business Relief 2029 verified; UAE thresholds; 173/2026 penalties as `verified:false`; per-country working-week calendar; Hijri display.

## Proposed GitHub rows (lane L6)
1. **Gulf pack config and calendar.** Effective-dated config for SA, AE, OM, BH, QA, KW (rates, thresholds, retention, penalties) plus per-country working-week and holiday calendar. Done when a test computes 14 business days for AE and 3-decimal rounding for OM, BH, KW from config only.
2. **KSA Phase 1 generation mode.** Arabic invoice, Arabic/Hindi numerals, 9-tag QR with UTF-8 byte lengths, SAR 1,000 B2B simplified rule. Done when QR and XML pass the ZATCA SDK validator for simplified and standard samples.
3. **KSA Phase 2 onboarding and signing.** CSR to compliance CSID to production CSID in one flow, secp256k1 signing, ICV/PIH lock per device. Done when all document types pass the simulation portal in CI.
4. **KSA clearance, reporting queue and CSID monitor.** Clearance for standard, 24 h reporting queue for simplified, credit/debit notes, certificate-expiry alerts. Done when a forced failure retries within 24 h and an expiring CSID raises an alert.
5. **PINT AE mapper and validator.** Provider-neutral UBL output with version in config and pre-send mandatory-field check. Done when sample invoices validate against the published PINT AE rules for the configured version.
6. **ASP adapter and bring-your-own ASP.** Send, receive, status webhook; one provider sandbox; per-entity TIN. Done when a sandbox invoice round-trips and a tenant switches provider by setting only.
7. **Oman PINT OM variant.** Config diff on the UAE mapper. Done when the OTA spec is read and a sample passes; blocked until the spec is public.
8. **Gulf watch list.** Monthly check of ZATCA, MoF UAE, OTA, NBR, GTA with a changelog in the pack config. Done when a dated entry exists per authority and a stale entry fails CI.
