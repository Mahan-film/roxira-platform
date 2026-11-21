# R27 DIGEST: Malaysia country pack

Date 2026-11-21. Full report with source table: `docs/strategy/research/R27_RAW.md`. Status: VERIFIED = regulator document read; VERIFIED-2 = two or more secondary sources (primary page blocked).
Rates and thresholds below go in effective-dated config (`source_url`, `as_of`, `verified`), never in code.

## Verified facts
- MyInvois phases (LHDN e-Invoice Guideline v4.8, 30 Aug 2026): above RM100m 1 Aug 2024; RM25-100m 1 Jan 2025; RM5-25m 1 Jul 2025; up to RM5m 1 Jan 2026. VERIFIED.
- Exemption below RM3m turnover (was RM1m); NOT available if a non-individual shareholder, a holding company or a related company/JV has RM3m+ turnover (v4.8 s.1.6.10). Exempt firms need no application and face no penalty (FAQ 4 Sep 2026). VERIFIED.
- Relaxation for up to RM5m runs to **31 Dec 2027** (Specific Guideline v4.9, 7 Sep 2026, Table 16.1): consolidated invoices for everything, no prosecution under ITA s.120. VERIFIED.
- Outside relaxation, a transaction above RM10,000 needs its own e-invoice; consolidated invoices are monthly, filed within 7 days after month end. 72 hours for buyer rejection or supplier cancellation. VERIFIED.
- LHDN has two channels only: MyInvois Portal (form or Excel batch) and API (direct, Peppol or non-Peppol provider). Peppol is optional. VERIFIED.
- API limits per client ID per minute: submit 100, get submission 300, login 12, cancel/reject 12, get document 60. Submission max 5 MB, 100 docs, 300 KB per doc; token 60 min; duplicate within 10 min rejected; sandbox rate limit lower, data kept 3 months. VERIFIED (SDK).
- SVDP (voluntary disclosure) 7 Jul 2026 to 31 Dec 2027; rectify via credit notes; per taxpayer, no group filing. VERIFIED.
- Penalty ITA s.120 about RM200-20,000 or 6 months (secondary). VERIFIED-2.
- Free LHDN MyInvois e-POS for sales up to RM5m includes sales, inventory and accounting reports. VERIFIED-2.
- Payroll: LHDN keeps a list of payroll software passing its yearly MTD spec (list dated 12 Oct 2026, read). SOCSO/EIS ceiling RM6,000; EPF 13%/12% employer; foreign staff EPF 2%+2% since 1 Oct 2025; HRD Corp 1% at 10+ Malaysian staff. VERIFIED-2.
- Audit exemption (SSM PD 10/2024, from periods starting 1 Jan 2025): any two of income, assets, headcount; final level RM3m / RM3m / 30 staff, phased over 3 years. VERIFIED (final), phases VERIFIED-2.
- Service tax 8% general, 6% rental/leasing; registration threshold RM500,000 per 12 months; IT-services guide updated 26 Feb 2026; a digital-services amendment regulation dated 27 Oct 2026. VERIFIED-2.

## Proposed decisions (details and costs in RAW part C3)
1. Own thin MyInvois API client as an intermediary, sandbox first; no Peppol, no paid provider. Cost about 0 plus agent time.
2. Pack config states `exempt / voluntary / relaxation / mandatory` plus `group_flag` and `relaxation_end = 2027-12-31`. These are Roxira states, not LHDN modes.
3. Onboarding asks three exemption questions; unanswered means `assumed_mandatory`.
4. Build consolidated AND individual invoices now; banner before 2027-12-31.
5. Payroll stays deferred; config stubs only; no PCB until LHDN listing.
6. Weekly regulation watcher (LHDN PDFs, version and hash diff to Telegram).
7. Do not market e-invoicing as the hook; the wedge stays multi-branch POS + inventory + ledger.

## Owner decisions needed
- O1: Does our Sdn Bhd register as MyInvois intermediary now? (default yes, sandbox only)
- O2: Pay an adviser (est. USD 100-300 once) for: own-company exemption, own service-tax status, intermediary duties? (default yes)
- O3: Budget for payroll listing later? (default no until paying customers ask)

## Conflicts with existing docs
- R8/T152 mode list omitted the group/related-company exclusion and the relaxation end date: update T152 config.
- R8 called the "four modes" LHDN submission modes in the prompt text; LHDN has two channels (Portal, API).
- R8 said e-POS launched 2026; launch year is unverified and its scope (inventory, accounting) is wider than R8 implied.
- R8 treated RM10k and consolidation rules as "limits"; they are now from v4.9 (7 Sep 2026): re-source.

## NOT verified
- Sandbox onboarding steps and intermediary registration procedure (SDK getting-started pages not read).
- Exact EPF Third Schedule, PERKESO category rates, LINDUNG 24 Jam, HRD Corp sector scope (kwsp and perkeso sites blocked).
- EA form and Borang E deadlines; record retention (seven years assumed); SSM annual filing calendar.
- Scope and content of the Oct 2026 service-tax digital-services regulation; whether our SaaS is taxable.
- Exact SVDP waiver terms; FX-rate rule text (v4.9 s.13); audit-exemption phase dates (2027 vs 2028 for phase 3).
- PDPA 2010 amendments and duties for holding TINs and IC numbers.

## Proposed GitHub rows (lane L6)
| Lane | Title | Done when |
|---|---|---|
| L6 | MY pack: effective-dated MyInvois config v2 (RM3m exemption, group_flag, relaxation_end 2027-12-31, 72 h, 7-day consolidation, API limits) | Config entries carry `source_url`, `as_of`, `verified`; specs cover each rule; no rates in code |
| L6 | MY pack: exemption wizard (turnover, corporate shareholder, related company) with `assumed_mandatory` default | Wizard stores answers and mode per company; unit tests for each of the 3 exclusions |
| L6 | MyInvois sandbox API client behind an interface (login, submit, poll, cancel, reject) with per-endpoint rate limiter, Retry-After, 5 MB/100 doc/300 KB packers | Passes against sandbox in a local run; 429 and duplicate-submission paths tested with fixtures |
| L6 | Consolidated plus individual e-invoice generation (monthly, 7-day deadline, above RM10k rule) with 2027-12-31 banner | Fixture months produce valid documents; mode switch changes output |
| L6 | Regulation watcher for LHDN guideline PDFs (version and hash diff, Telegram alert) | Job runs weekly in CI box; a changed hash opens an alert; files stored by fetch date |
| L6 | MY payroll config stubs (EPF, SOCSO, EIS, HRD Corp) as unverified effective-dated tables with no computation | Tables load, flagged `verified=false`, nothing computes pay; docs name the official table URLs |
| L6 | Adviser question pack: own exemption, own service tax, intermediary duties, retention, PDPA | Owner-ready Persian/English list with defaults in `docs/owner/` |
