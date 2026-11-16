# Research R10–R12 — our business, growth and support, tech future-proofing (digest)

Source: the owner's deep-research runs R10, R11 and R12, all stage 2 (self-review and decision pack), received 2026-11-16. The hub checked the items marked **(hub)** against primary sources the same day. Rules as before: a number backed only by a secondary source is `verified: false` in config, and no USD is computed from MYR without an official rate.

## Assumptions in the reports that we do not use
- Several assumptions are wrong, now that the owner already has a Malaysian Sdn Bhd (R8 "Owner answers"):
  - the founder's country, German exit tax and residence rules;
  - entrepreneur visas (MTEP);
  - incorporating a new Sdn Bhd;
  - "merchant of record first".
- A "strict zero-retention" promise. The owner decided against it; the paid private data option exists instead.
- R12's advice to drop the LiteLLM gateway and fold the Python FastAPI service into NestJS. The free-first key pool runs through LiteLLM, and the legal AI core is Python. A rewrite costs months and saves little. We keep both and limit the risk (see R12 decisions).
- Hosting-location advice. Out of scope.

## R10 — our own business (entity, tax, money, brand)

**Facts that matter**

| Fact | Status | Effect |
|---|---|---|
| Paddle's Acceptable Use Policy prohibits "phone services" and SMS/message-app mass marketing, and restricts voice impersonation and automated decisions about people. | verified (paddle.com AUP) | Paddle does not fit Roxira (phone agent, WhatsApp, HR). We sell through our own Sdn Bhd with local gateways. Paddle is dropped, not just deferred. |
| HitPay MY: DuitNow QR 1.2%, domestic card 1.2% + RM 1, FPX 1.8% + RM 0.40, **+0.2% for recurring billing**, no setup or monthly fee, FPX T+1. Airwallex MY: 1.9% + RM 0.50 domestic card, local methods 1.4% + RM 0.50, no monthly fee. | verified (vendor pages) | Collection through HitPay. Our own ledger keeps plans and entitlements; the gateway only collects. |
| The MSME corporate tax rate (15% / 17%, proposed 14% / 16% from YA2027) needs ≤20% foreign ownership, among other conditions. Otherwise the rate is 24% from the first ringgit. | rates verified (LHDN); the 20% rule from secondary sources | Owner question: who owns the company. |
| Payments to foreign providers for software use or services (cloud, LLM APIs, Google/Meta ads) can carry **10% withholding tax** (s.109 / s.109B ITA), due within a month. Without it, the expense is not deductible. This comes on top of 8% service tax on imported services when the seller does not charge SToDS. | LHDN WHT page exists; rates secondary | The company's accountant decides per provider. We keep a list of every foreign provider the company pays (key pool, VPS, domains). |
| Service tax 8%; registration at RM 500k over a rolling 12 months; SST-02 every two months; 10% penalty for late payment in the first 30 days. | verified (MySST, 14 Nov 2026) | Our own billing charges no SST until the company passes RM 500k of taxable services (or is already registered for its food business; owner question). |
| Audit exemption (SSM Practice Directive 10/2024): 2 of 3 criteria over the current and two previous years. For 2026: revenue ≤ RM 2M, assets ≤ RM 2M, ≤ 20 employees. | verified (SSM FAQ 19 May 2026) | An existing company may already be exempt. The accountant confirms. |
| MDEC "Malaysia Digital" status lifts local-ownership limits. Its tax incentive needs **RM 50,000 paid-up capital**. Cradle grants need a Malaysian majority team if the company is under 51% Malaysian-owned. | verified (MDEC, Cradle) | Grants and incentives come later, only after revenue. |
| Madrid trademark basic fee CHF 653. MyIPO and EUIPO fees come from IP firms only (about RM 950 per class at MyIPO). | WIPO verified; others secondary | Search "Roxira" in MyIPO and file classes 9 and 42 through the company (owner money decision). |

**Decisions:** sell in Malaysia from the existing company; collect through HitPay; drop Paddle. The company's accountant owns withholding tax, SST and the audit question; we keep the provider list. Trademark search now, filing on the owner's approval.

## R11 — growth, messaging, support, partners

**Facts that matter**

| Fact | Status | Effect |
|---|---|---|
| WhatsApp Cloud API: each customer owns its own number and pays Meta directly through **Embedded Signup v4** (v2 and v3 were retired 15 Oct 2026). A tech provider may onboard **10 new customers a week** until business verification, app review and access verification raise it to 200. | verified (Meta docs) | WhatsApp needs Meta business verification of our company first: owner action. |
| From 1 Oct 2026: 1,000 free service messages per number per month, then each is charged. Meta's own "Business Agent" costs USD 2 per 1M tokens and has no free allowance. Developers report sends failing at the 1,000th message when no payment method is set. | verified; the failure is a forum report | We use our own assistant, never Meta's agent. The adapter checks the payment method and alerts at 900. |
| The Malaysia rate card (marketing about RM 0.35, utility/auth about RM 0.056; auth costs about 3× when the business is not verified in Malaysia) comes from BSP blogs only. | unverified | Business verification under the Sdn Bhd is also what avoids the 3× OTP price. |
| MCMC has telcos block any URL, phone number or personal-data request in SMS. Local SMS costs about RM 0.10–0.20; Twilio about USD 0.34. | telco-level verified | SMS is for plain OTP text only, through a local gateway. Never marketing. |
| Email: we send through our own SMTP (`roxira_mail`). If we move to Amazon SES: since 21 Jul 2026 new accounts default to a USD 0.16/1k bundle unless switched to USD 0.10/1k, the free tier is gone, attachments cost USD 0.12/GB, and every recipient is charged. | verified (AWS) | Keep our SMTP. Invoices go out as signed links, not attachments. SPF, DKIM and DMARC must pass. |
| Telegram bots: 30 messages a second, 20 a minute per group. | verified (Telegram FAQ) | Fine for internal alerts. |
| **MyInvois API limits:** login 12 a minute (token lasts 60 min), submit 100 a minute, search/cancel/reject 12 a minute, validate TIN 60 a minute; HTTP 429 above them. | verified (LHDN SDK) | T159 caches the token and queues calls per client. |
| LHDN penalty is under **s.120(1)(d) ITA** (RM 200–20,000 or up to 6 months), not s.82C. | verified (LHDN FAQ Q41) | Legal text and the help pages cite s.120(1)(d). |
| Partner programmes: Bukku pays 35% commission or gives a 35% discount, with an RM 10 dormant plan and a free top plan for partners. Xero gives 15–30% discounts. | Bukku verified; Xero tiers conflict | A partner programme for accountants (R7 accountant portal). The owner sets the percentage. |
| Support hours: StoreHub 9:00–21:00 every day including holidays; Qashier 9:30–21:30. | verified | Our POS promise: AI first line 24/7, a human for "POS cannot sell" 9:00–21:00 MYT, everything else on working days. |

**Decisions**
1. **Channel order:**
   1. accountants and bookkeepers as partners;
   2. direct outreach to 2–10-branch businesses with a trigger (RM 3M e-invoice deadline, complaints about their current system);
   3. comparison pages in three languages, plus free tools: an e-invoice deadline checker and a "CSV to daily P&L" tool;
   4. short live clinics.

   Google search ads wait until the free funnel converts.
2. **Cut for six months:** WhatsApp marketing blasts, cold SMS, broad social ads, trade shows, public Telegram channels.
3. **Migration offer:** a free "smart cutover" (chart of accounts, items, opening balance, open receivables and payables, reconciled stock) on annual or multi-branch plans. Old history goes to partner firms. POS switches happen on a Tuesday or Wednesday morning. Inventory subledger must equal GL before import (T100 dry-run).
4. **Helpdesk:** in-app chat, WhatsApp and email into one inbox. Self-hosted Chatwoot only when tickets exceed what two people can answer (resource cost on the server).

## R12 — tech future-proofing

**Checked against our repo and primary sources (hub)**

| Fact | Status | Effect |
|---|---|---|
| PgBouncer 1.26.1 (14 Oct 2026) fixes CVE-2026-107350 (SCRAM login confusion, 1.17–1.26.0) and CVE-2026-107349 (CPU spin when `ignore_startup_parameters` is set). We run **v1.25.2**, with SCRAM and that setting on. | verified (pgbouncer.org) | **PR #857** moves to `v1.26.1-p0`. It is waiting for owner approval because merging restarts a production container. |
| OpenAI shuts down `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` on **6 Jan 2027**, `whisper-1` and `gpt-4o-transcribe` on 26 Feb 2027, `gpt-5`/`o3` on 11 Dec 2026, `gpt-4o`/`gpt-4.1` on 14 Jan 2027. | verified (OpenAI deprecations) | `services/voice_phone_agent/src/config.ts` defaults to `whisper-1` and `tts-1`: **T161**. |
| Anthropic retires `claude-sonnet-4-5` on 30 Nov 2026. Gemini 2.5 Pro and Flash auto-route to 3.x on 1 Dec 2026. `text-embedding-004` shut down 14 Jan 2026. | verified | None of these ids are in our config. A CI check keeps it that way (T161). |
| Node 22 ends 30 Apr 2027 (our 20 Dockerfile stages use `node:22-alpine`). Node 24 runs to 30 Apr 2028. Python 3.11 ends Oct 2027, 3.12 Oct 2028. Postgres 17 runs to Nov 2029. Next.js 16 has an LTS to about Oct 2027. NestJS 12 (ESM) is out; we stay on 11 for now. | verified (nodejs.org, devguide.python.org, postgresql.org, nextjs.org) | **T162** moves to Node 24 in Q1 2027. Python and Postgres are fine. |
| MinIO was archived 25 Apr 2026 (AGPL). Redis 7.4+ is under RSAL/SSPL/AGPL; Valkey is BSD. | verified (GitHub, redis.io) | We run no MinIO. Redis is internal-only, so its licence does not bind us; one compose file already uses Valkey. Switch the rest at the next infra window. No urgency. |
| LiteLLM: SSO for more than 5 admins, default audit logs and some guardrails need an enterprise key, and the MIT/enterprise boundary is disputed in the project's own issue tracker (#34241). | verified (docs, GitHub) | Keep LiteLLM pinned (`v1.105.6`). Use no enterprise-gated feature. Audit logs and budgets stay in our own tables. |
| Grafana, Loki and Tempo are AGPL; Prometheus, Qdrant and LiveKit (server and SIP) are Apache 2.0. | verified | Internal use of AGPL tools is fine. **T163** licence gate on shipped app dependencies. |

**Decisions:** PgBouncer fix now (PR #857); voice model ids off retiring models before 6 Jan 2027 (T161); Node 24 in Q1 2027 (T162); licence gate in CI (T163); a monthly automated restore drill that checks debits equal credits per tenant (T164); LiteLLM stays, pinned, enterprise features off.

## Rows added (WAVE 16, continued)

| Lane | Task | Done when |
|---|---|---|
| L4 | **T161 Retiring model ids** | `voice_phone_agent` defaults move off `tts-1` and `whisper-1`; replacements come from `config/models.yaml` roles, never hard-coded. `config/models.yaml` gets a `retired:` list with dates (the ids in R12, from the OpenAI, Anthropic and Google deprecation pages). A CI test fails if any role or code default uses a retired id or one whose shutdown is within 30 days. |
| L1 | **T162 Node 24 base images** | Every `node:22-alpine` stage moves to `node:24-alpine`. Backend jest, frontend build and the M1 gate pass. One PR, no other changes. Due before 1 Mar 2027. |
| L1 | **T163 Licence gate** | A CI job lists the licences of the production dependency trees (Nest backend, frontend, Python AI core). It fails on AGPL, SSPL, BSL, SUL, Commons Clause or unknown, with an allowlist file for reviewed exceptions. Dev-only and internal tools (Grafana and similar) are out of scope. |
| L3 | **T164 Monthly restore drill** | A script and timer restore the latest backup into a throwaway database. They check that row counts are sane and that, per tenant and currency, posted debits equal credits. They report pass or fail to the monitor. Docs in `docs/ops/`. No production writes. |
| L4 | **T159 amendment** | Add: token cache (60 min), per-client queues within the LHDN limits (login 12, submit 100, search/cancel 12, TIN 60 per minute), and retry on 429 with backoff. |
| L3 | **T152 amendment** | The `exempt` mode can be set again after `mandatory`/`relaxation` with an audit row and reason (LHDN FAQ Q17–Q19). |
| L2 | **T165 Free e-invoice deadline checker** (*after T152*) | A public page on roxira.net (en-MY first): revenue band, year reached and related-company question in; the MyInvois mode and start date out, computed from the MY pack config with source links and the "not tax advice" line. No login, no data stored. Malay and Chinese versions only after a native reviewer approves the text. |
