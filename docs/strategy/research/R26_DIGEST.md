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
