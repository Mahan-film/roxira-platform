# R26 digest: EU/Germany regulatory, licence and cost baseline (Gemini Deep Research, 2026-11-21)

Stage 1 + stage 2 in one report. Stage 2 verified many items against primary pages; items it could not
verify stay marked. Dated facts below are as of 2026-11-21: recheck before relying on them.

## Facts the report verified (primary sources)
- EU AI Act: Digital Omnibus, Regulation (EU) 2026/1744, in force 27 Jul 2026. Annex III high-risk
  (employment, administration of justice) now 2 Dec 2027; Art. 50 transparency since 2 Aug 2026.
  Art. 6(3) exemption does not apply to profiling; relying on it still needs a documented assessment and
  EU database registration (Art. 49(2)); a Git memo alone is not enough.
- Germany e-invoice: receive since 1 Jan 2025; issue from 1 Jan 2027 if prior-year turnover > EUR 800k,
  from 1 Jan 2028 otherwise (UStG 27(38)). BMF letter 15 Oct 2026 confirms the three-tier error split.
  GoBD 2nd amendment (14 Jul 2025): archiving the structured XML is enough.
- ELSTER/ERiC is free to integrate. German payroll filing needs ITSG system examination (payroll: skip).
- New in the next 12-24 months: EU Product Liability Directive applies 9 Dec 2026 (software and AI under
  strict liability); Cyber Resilience Act reporting duties active since 11 Sep 2026, full scope 11 Dec 2027
  (only if we ship downloadable clients/agents); EU Data Act bans switching charges from 12 Jan 2027 (a
  full tenant export is mandatory).
- Licences: ERPNext/Frappe HR GPLv3, Frappe framework MIT, Odoo Community LGPLv3, Twenty CRM **AGPLv3 with
  some server modules under a paid enterprise licence**, EspoCRM AGPLv3, Bigcapital AGPLv3, TigerBeetle
  Apache-2.0, PayrollEngine MIT, Better Auth MIT.
- Provider terms: Anthropic API 30-day retention, no EU residency on the direct API (EU via cloud
  partners); Mistral EU endpoint has limited tools/models; Gemini Developer API has no ZDR.
- Prices that move: Gemini API doubles 1 Dec 2026 and 1 Jan 2027; Hetzner raised prices twice in 2026.
  Hetzner Object Storage supports S3 Object Lock and versioning (WORM for 8-year archives).

## Decisions proposed (hub view)
1. **Twenty CRM:** AGPL plus enterprise-licensed modules conflicts with a closed SaaS. The licence gate
   (#999) must classify it before any customer-facing use. Resolve the STATE vs SYSTEM_MAP contradiction
   (live vs retired) and decide: remove, isolate as an internal tool only, or replace with our own CRM module.
2. **Full tenant export** (GoBD XML + CSV/JSON for every module) before 12 Jan 2027.
3. **Persist EN 16931 business terms** in the invoice schema (not just PDF/XML blobs); ViDA reporting will
   need them.
4. **GoBD archive on WORM storage:** bundle daily XML + manifest hash into archives above 1 MB, store with
   Object Lock, keep a per-tenant hash chain in Postgres.
5. **Tenant switch "no employee telemetry"** (works-council mode, BetrVG 87(1)6): suppress per-user
   activity dashboards and individual AI usage analytics.
6. **Provider abstraction for LLMs** with EU-resident, no-training endpoints for customer data; never use
   models locked to 30-day retention for sensitive tenant prompts; plan model-id migrations (model ids only
   in `config/models.yaml`).
7. **Do not build German payroll or bank scraping in-house.** Bank feeds via a licensed aggregator behind a
   `BankFeedAdapter` after revenue; camt.053/MT940 import first; DATEV EXTF CSV first, Marktplatz later.

## Owner decisions (not for agents)
- Rename "Smart Judge" (an active UK product uses SmartJudge.ai; judicial-sounding names invite scrutiny).
- Trademark search and filing for "Roxira" (a Lithuanian company has the same name; fees are small).
- IT liability/cyber insurance before paid external tenants after 9 Dec 2026.
- Whether any German customer work starts before the default pack is complete.

## Not verified / treat with care
Trademark registers (not searched), the 15 Oct 2026 BMF third letter details beyond the primary PDF,
DPF appeal status, Gemini/Vertex retention numbers, bank-feed breakage statistics and competitor payroll
prices (secondary sources). The report's Hetzner and Neon price tables are secondary except where noted;
we already run on production hosting, so do not act on them without a cost row.

## Second opinion (Gemini Deep Research, 2026-11-22)

Saved unchanged in `R26_GEMINI.md` (Stage 1 baseline report and Stage 2 review, both in one old owner paste dated 2026-11-21). No `R26_RAW.md` exists, so claims were compared with this digest only. Rule used: where the two sides conflict, the claim with a primary URL and a date wins; everything else is UNVERIFIED until a lane reads the page. Caveat: this digest is headed "Gemini Deep Research, 2026-11-21, stage 1 + stage 2 in one report" and was added on 2026-11-21 (PR #1053), and its wording matches the paste almost line by line, so the paste is very probably the report the digest was written from (the PR text does not say so). This is a source copy, not an independent opinion. Nothing here replaces the sections above.

### Agreements
Because the digest was most likely written from this report, agreement below is not independent corroboration. Primary URLs in the paste are mostly undated, so they stay UNVERIFIED here.
- AI Act Digital Omnibus, Regulation (EU) 2026/1744, in force 27 Jul 2026; Annex III (employment, administration of justice) moved to 2 Dec 2027; Art. 50 since 2 Aug 2026.
- E-invoice: receive since 1 Jan 2025; issue from 1 Jan 2027 above EUR 800k prior-year turnover, from 1 Jan 2028 otherwise (UStG 27(38)); BMF letter 15 Oct 2026 with a three-tier error split; GoBD 2nd amendment 14 Jul 2025 (structured XML archive is enough).
- Product Liability Directive 9 Dec 2026; Data Act switching charges banned 12 Jan 2027; CRA applies only if we ship a downloadable client.
- Licences: Frappe MIT, ERPNext and Frappe HR GPLv3, Odoo Community LGPLv3, Twenty AGPLv3 with server modules under an enterprise licence, Bigcapital AGPLv3, TigerBeetle Apache-2.0, Better Auth MIT (Stage 2 says all eight were read on primary GitHub pages, undated).
- Provider terms: Anthropic 30-day retention; Mistral EU endpoint has limited tools and models; Gemini price doubling 1 Dec 2026 and 1 Jan 2027; Hetzner Object Storage has S3 Object Lock and versioning (Stage 2 cites primary docs for all, undated).
- Decisions: Twenty needs a licence decision; full tenant export; persist EN 16931 business terms; WORM GoBD archive in bundles above 1 MB with a manifest hash; tenant "no employee telemetry" switch; provider abstraction; no in-house German payroll or bank scraping (camt.053/MT940 and DATEV EXTF first, aggregator behind a `BankFeedAdapter` later).
- Owner items: rename "Smart Judge", trademark check for "Roxira", insurance before paid tenants after 9 Dec 2026. ELSTER/ERiC free; skip payroll.

### Conflicts
| Topic | This digest | Gemini | Verdict |
|---|---|---|---|
| Hetzner prices | Tables are secondary; do not act without a cost row | Stage 2 "corrects" Stage 1 from primary pages: dedicated 2 vCPU tier EUR 36.99 (Stage 1: 42.99), Helsinki about 15% cheaper than Germany | UNVERIFIED: Gemini's pages carry no date. Keep digest position. |
| EU model routing | EU-resident, no-training endpoints for customer data | Default German-hosted data plus Mistral EU; the US cloud's EU region for Anthropic models as opt-in tenant setting with SCCs and a TIA | Not a direct conflict; Gemini's opt-in is a design choice, the TIA need is UNVERIFIED (expert question 5). |
| Anthropic EU residency, Gemini retention numbers | No EU residency on direct API; Gemini API has no ZDR | Stage 2 marks both UNVERIFIABLE against primary pages; 30 days is confirmed by the primary privacy page, a "7 days" tracker claim discarded | UNVERIFIED for residency and Gemini numbers; 30-day Anthropic retention agrees. |
| Art. 6(3) and Art. 49(2) | Stated as verified: reliance needs a documented assessment and EU database registration; a Git memo is not enough | Stage 2 says the Art. 6(3)/(4) text was not extracted verbatim, registration rests on recitals and secondary analyses, and Omnibus simplification may change it (expert question 3) | UNVERIFIED; digest states it more firmly than the source. |
| CRA dates | Reporting since 11 Sep 2026, full scope 11 Dec 2027 | Cites EUR-Lex 2024/2847 without article text; the R29 section on main rated the same dates UNVERIFIED | UNVERIFIED (consistent with R29). |
| Hetzner price rises | "Raised prices twice in 2026" | Stage 2: the March, April and June rises and their percentages are UNVERIFIABLE (secondary trackers only); Stage 1 says April and June | UNVERIFIED. |
| EspoCRM AGPLv3, PayrollEngine MIT | Listed as verified | EspoCRM AGPLv3 is in Stage 1 with a primary URL, but Stage 2 says its licence body was not retrieved; PayrollEngine MIT is not in this report (it appears in the R24 report) | EspoCRM UNVERIFIED; PayrollEngine not covered here. |

### Only one side has it
- **Gemini only** (grep of this digest, no RAW): SmartJudge.ai operator named (UK company number) and a UAB Roxira registry code, plus a second "Roxira" company in Romania (UNVERIFIABLE, secondary mirror); DATEV Buchungsdatenservice per-client monthly fees and mandatory add-on; bank-feed breakage 19% and 36% (secondary, digest lists the statistic as unverified); ViDA dates 1 Jul 2028, 2029, 2030; trademark fees (DPMA EUR 290, EUIPO EUR 850-1,050); auth and database price tiers; model retirement floor Sep-Nov 2027; works-council scope covering CRM logs and AI prompt telemetry; coding-agent subscriptions and proxy bugs; phased cost roadmap. All UNVERIFIED here.
- **This digest only:** STATE vs SYSTEM_MAP contradiction on Twenty and the licence gate #999; the hub's proposed decision list; "model ids only in `config/models.yaml`".
- Overlap with R28 and R29 is small (retention clocks, insurance); not duplicated here.

### Row changes
- No new row. Comments posted after the PR exists on #1058 (ViDA dates and BT/BG scope, UNVERIFIED) and #1060 (works-council scope extension); #1057 and #1059 already match.

### Owner decisions (not for agents)
- Gemini D1 module order (accounting plus CRM first, HR later) against the digest's open question on German work before the default pack.
- EU region of a US-parent cloud for Anthropic models as an opt-in tenant setting.
