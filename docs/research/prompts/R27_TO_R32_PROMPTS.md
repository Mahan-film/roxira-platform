# Deep-research prompts R27-R32 (two stages each)

R22-R26 are done (digests in `docs/strategy/research/`). These are the next gaps the digests exposed.
How to use: Gemini web, Deep Research mode. Send STAGE 1, then STAGE 2 in the same chat. Give both
outputs to the main hub with "register R<n>". Paste this context once at the top of every STAGE 1:

> Context: Roxira is a SaaS platform (accounting/tax, CRM, ERP, HR, AI legal assistant "Smart Judge")
> built by a two-person team using AI coding agents. Budget is minimal; open-source and free tiers
> first; spend only when it clearly pays. Output: facts with primary-source URLs and dates, kept
> separate from recommendations. Today is 2026-11-21; flag anything you cannot verify.

Also still open: send the STAGE 2 for R22 (it was not included).

## STAGE 2 (identical for every R<n>)

STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, threshold and legal claim against a primary source. Table: claim | source URL | source date | VERIFIED / CHANGED (correct value) / UNVERIFIABLE.
2. List what the report missed that would hurt us in 12–24 months (at least 10), each with why it matters.
3. Turn it into a DECISION PACK: options, recommendation, one-off and monthly cost, effort, reversibility, what to do this month / 3 / 6 / 12 months, revisit trigger.
4. List open questions that need a human expert, each with the default you would choose.
Keep facts and recommendations separate. Do not repeat the original report; only correct, extend and decide.

## R27 — Malaysia country pack (second pack after the default pack)
STAGE 1:
1. MyInvois e-invoicing: phases, turnover thresholds, exemptions (RM 1M / 3M), the four submission modes, consolidated invoices, API limits, sandbox access, penalties. Cite LHDN/IRBM sources.
2. SST (sales and service tax) including the digital-services rules; how an SME's invoices and returns work.
3. Payroll statutory items: EPF, SOCSO, EIS, HRDF, PCB/MTD, EA form, Borang E; rates and ceilings as dated config, with where the official tables live.
4. Bookkeeping rules for a Sdn Bhd: MFRS for private entities, SSM filings, audit thresholds, record retention.
5. What a small software vendor must build vs buy (peppol-like access point, certified integrators), and the cheapest compliant path.

## R28 — Gulf country packs
STAGE 1:
1. Saudi ZATCA e-invoicing phases (generation, integration waves), technical requirements, certification of solutions, penalties.
2. UAE e-invoicing programme (timeline, accredited service providers, data model) and VAT/corporate tax basics for SMEs.
3. Oman, Qatar, Bahrain, Kuwait: VAT/e-invoicing status as of 2026.
4. Technical pitfalls: 3-decimal currencies, Hijri dates, Arabic right-to-left documents and numerals, bilingual invoices, QR codes.
5. Cheapest compliant build path and a recommended order of countries.

## R29 — SaaS security and trust baseline
STAGE 1:
1. Minimum credible security evidence for selling to European SMEs and their tax advisors in 2026: ISO 27001 vs SOC 2 vs lighter options, costs and timelines for a 2-person team.
2. Penetration tests: cost, scope, cadence; open-source scanners we can run ourselves.
3. GDPR processor paperwork: DPA, sub-processor list, TOMs template, breach process, records of processing.
4. Backup/DR evidence, secrets handling and audit logging that enterprise questionnaires ask for.
5. Cyber and professional liability insurance: what small SaaS vendors actually buy, cost range.

## R30 — Phone and voice agent for Smart Judge
STAGE 1:
1. SIP trunk and number providers for an EU-hosted voice agent (LiveKit SIP or alternatives): cost per minute, registration pitfalls behind NAT, outbound vs inbound.
2. Streaming speech-to-text for legal vocabulary in the default language and in German/English: accuracy on spoken statute numbers, keyword boosting, price.
3. Text-to-speech options with low first-audio latency; free tiers vs paid.
4. Call recording, consent and retention rules for an EU product; what must be said at call start.
5. Latency budget end to end (speech end to first spoken word), and what to measure in nightly tests.

## R31 — Billing, subscriptions and VAT for selling the SaaS itself
STAGE 1:
1. Payment providers for subscriptions in the EU, Malaysia and the Gulf: fees, payout rules, merchant-of-record vs direct.
2. VAT on B2B and B2C digital services (EU OSS, reverse charge), Malaysian SST on digital services; invoicing duties for the vendor.
3. Usage metering for AI features and per-seat billing: open-source options with licences safe for a closed SaaS.
4. Dunning, refunds, chargebacks, tax-id validation, trial abuse.
5. Cheapest setup for the first 50 customers and the trigger to change it.

## R32 — Customer data migration and onboarding
STAGE 1:
1. How SMEs actually migrate: spreadsheets, accounting exports, opening balances, open invoices, open stock layers. What breaks most often.
2. Import tooling patterns: dry run, validation reports, rollback, idempotent re-import, mapping templates.
3. Opening-balance cutover rules for accounting and inventory (period lock, FIFO layers, open POs).
4. Open-source libraries for messy Excel/CSV parsing and fuzzy matching with safe licences.
5. A 2-week onboarding playbook and the metrics that predict churn in the first 90 days.
