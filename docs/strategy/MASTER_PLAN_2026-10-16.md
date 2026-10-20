# Roxira master plan — v2, 2026-10-16

Supersedes v1 of the same day and the priority lists in `docs/STRATEGY.md` §5 and
`docs/STRATEGY_STATUS_2026-10-14.md` §9. `docs/STATE.md` stays the live status page.

## 0. Owner decisions (2026-10-16)

1. **Priority 1 is the software factory**: our own machine that can build any product fast, with the best
   technology at the lowest cost, open source first, choosing technology through our research system.
2. **Then a global business** through the owner's Malaysian company (owner: Malaysian residence card and
   bank account; partner holds 70–80% as investor). Infrastructure and accounts move to that entity first.
3. **Cost-effective**: spend only where it is clearly necessary; prefer open source.
4. **Sales and marketing**: open to hiring and to AI-automated marketing (posts, replies) on Instagram
   and other platforms; will buy the APIs that are needed.
5. Smart Judge and Roxira (Iran) continue, but in maintenance-plus-growth mode, not as the main build focus.

## 1. Where we really are (measured 2026-10-15/16)

| Area | Fact |
| --- | --- |
| Smart Judge | Complete product (cited chat, laws v6, 300 rulings, 112 regulations, drafting, voice, payments, PWA). 2 registered users, 1 test payment, almost no organic traffic yet (measured 2026-10-15/16). **Update 2026-10-20**: 4 pricing tiers (Free / Basic $4 / Pro $10 / Premium $29) with tiered model routing, Zibal + USDT-TRC20 payments live (real payment verified), email+password and phone-OTP auth, 51 guides, owner console `/owner`, Telegram channel @ghazihoushmand, own mail relay; details in `docs/STATE.md`. |
| Roxira | Portal + 7 tenant-isolated modules; Moadian not connected live. 0 inquiries. |
| Factory (pieces exist, no single pipeline) | Build+host engine (`ecosystem_core/src/factory/ephemeral_runner.py`, swarm, templates, mission-control UI); server agents (`run_task.sh`, OpenCode, worktrees, scope checks); key pool (free first, paid fallback, cost log); research service (GPT-Researcher + SearXNG + Tavily); auto-deploy with rollback; SBOM, mutation, property tests; throwaway DBs; owner bot. |
| Factory gaps | No brief→research→spec→plan pipeline; agents cannot run npm/tsc/tests (the hub tests by hand); one agent = one task, no queue, no retry/escalation; free models fail multi-step tasks and the paid agents key is empty; no reusable product chassis for new (global) products; deploy is single-repo; no marketing engine. |

## 2. Structure: two tracks, clearly separated

| | Track I — Iran | Track G — Global |
| --- | --- | --- |
| Entity | Owner personally (as today) | Malaysian company |
| Products | Smart Judge, Roxira | New products built by the factory (§4) |
| Payments | Iranian gateways (Zibal) | Stripe Malaysia or a merchant of record (Paddle / Lemon Squeezy / Polar) — to be confirmed (§3) |
| Accounts | Current GitHub org, Hetzner, Cloudflare | **New** GitHub org, cloud, Cloudflare, domain, email, all billed to the company |
| Mode | Maintenance + low-cost growth (content, lawyers) | Main build focus after the factory core |

Why separate: payment processors and US-based platforms screen sanctions exposure; mixing Iranian
operations with the global entity's accounts can get the global accounts frozen. The factory code is
ours and can serve both, but each track deploys from its own accounts.

## 3. Phase 0 — entity and compliance foundation (owner, weeks 1–2, in parallel with the factory)

These are business/legal steps. The hub prepares checklists and documents; it does not give legal advice.

1. **Professional check (mandatory before taking payments):** a Malaysian corporate lawyer/accountant
   confirms that the company may sell SaaS globally with the current shareholders and the owner's role,
   and how payment providers' KYC/sanctions screening will treat it. Ask specifically about Stripe
   Malaysia vs a merchant of record. (Our search found no definitive public answer.)
2. **Owner–partner agreement in writing:** who owns the factory code/IP, revenue share, the owner's role
   and salary/dividends. Protects both sides before value is created.
3. **Company accounts:** domain (.com), email, GitHub org, Cloudflare, Hetzner (or another EU host),
   OpenRouter/model APIs, Meta Business, all registered to the company.
4. **Payments:** open the provider the adviser recommends; the factory chassis supports both Stripe and a
   merchant of record behind one adapter.

## 4. The software factory (priority 1)

Goal: give the factory a one-paragraph brief and get a researched, specified, built, tested, deployed and
measured product, with the hub (Claude) as architect/reviewer and the owner approving at two gates.

```
Brief → Research → Spec + decision (owner gate 1) → Plan (tasks + acceptance tests)
      → Parallel build (agents in worktrees) → Verify (tests, types, property, mutation, SBOM, review)
      → Deploy (chassis + autodeploy) → Measure (analytics, cost, errors) → Improve (owner gate 2: scale/kill)
```

| # | Milestone | What it adds | Builds on | Weeks |
| --- | --- | --- | --- | --- |
| F1 | **Agent workbench** | A test container per agent worktree with cached `node_modules`/venv, so agents (and the hub) run `tsc`, `eslint`, `jest`, `pytest`, builds on the server; result attached to every agent run. Removes the hub's manual testing bottleneck. | `run_task.sh`, agent DBs | 1 |
| F2 | **Task queue + escalation** | A queue (Postgres table) of tasks with acceptance tests; N parallel agents with stagger; automatic retry on failure with model escalation (free → DeepSeek Flash → stronger), patch collection, a cross-model reviewer pass, results to the bot. | F1, key pool, cost log | 1–2 |
| F3 | **Research → spec pipeline** | `brief.md` → 3 research jobs (market, tech, compliance) → a spec + decision record (stack options, cost, risks, task list) in English with a Persian summary → owner approves in the bot. | research service, bot | 2 |
| F4 | **Golden chassis (global SaaS template)** | A new repo template: TypeScript monorepo (pnpm), Next.js app + API, Postgres, auth with organisations and API keys (open source), billing adapter (Stripe / merchant of record), i18n (en first + others), Umami analytics, AI gateway client (our key pool), SEO/GEO kit (sitemaps, schema, llms.txt), legal pages, AI-disclosure label, Dockerfile, CI, SBOM. Every new product starts here; agents write only the domain logic. | research picks each part | 3–4 |
| F5 | **Multi-project deploy** | Generalise our autodeploy to a project manifest (repo, domain, services, DB) on the global server; one-command new project. | autodeploy | 4 |
| F6 | **Marketing engine** | Research → posts (text + images) → scheduled publishing on Instagram (Meta Graph API, business account), LinkedIn, X; comment/DM reply drafts with owner approval in the bot; weekly content calendar per product. Within platform rules: no fake accounts, no spam. | key pool, bot | 5–6 |
| F7 | **Per-project observability** | Cost log tagged by project, Umami funnels, uptime, error alerts, a weekly KPI report per product in the bot; scale/kill gate at 30/60/90 days (owner decides). | cost log, bot | 6 |

Model and budget policy for the factory: free tiers for research gathering and light edits; DeepSeek
V4.1 Flash for normal implementation (≈ $0.30/$1.20 per M tokens); a stronger model only for planning
and hard fixes. **A funded agents key is required** (~$20–50/month covers heavy use); free tiers alone
fail multi-step tasks, as measured on 2026-10-15.

Technology choices for the chassis are made by F3 research runs, not by preference. Earlier "skip"
verdicts change for Track G: Stripe/merchant-of-record and the EU AI Act transparency label become
**required**; usage metering (Lago) and machine payments (x402) stay **later**, only if a product needs them.

## 5. First global products (research run 2026-10-16, reports in `docs/research/global/`)

Each candidate still gets a demand test (landing page + waitlist + posts) before a full build.

| Rank | Candidate | Research verdict | Next step |
| --- | --- | --- | --- |
| 1 | **G2 — Citation-checked legal research for solo lawyers and small firms, Malaysia first, then other English-language ASEAN jurisdictions** | Strongest. The clearest documented market gap is affordable research for solos/small firms (big tools need 25–50+ seats; Paxton lists $499/user/month). Malaysia's Federal Legislation Portal (AGC) is the official source; courts now require source checking and hallucination controls, which is exactly our citation-guard + golden-set machinery. Sell to **lawyers** (pro tool), not consumers, to stay clear of unauthorised-practice rules. | Verify the AGC portal's reuse terms (open access ≠ automatically licensed for commercial reuse); ingest a pilot set of 20 key Malaysian Acts with the Smart Judge pipeline; landing page + waitlist for Malaysian lawyers. |
| 2 | G3 — AI marketing autopilot for small businesses | Built for ourselves first (F6); sell only after it works for us. | After F6. |
| 3 | G1 — MyInvois e-invoicing | **Weaker than assumed.** Since 2026-09-01 the exemption threshold is reported as RM3M (secondary sources; confirm with LHDN), removing >1.1M businesses from the mandate; the space is crowded (Bukku already does WhatsApp/photo capture at RM0–99/month, plus AutoCount, QuickBooks, Odoo, Xero). Remaining niches: one compliance dashboard for accountants across clients on different software, and self-billed e-invoices for importers. | Park; revisit only as a niche add-on. |
| 4 | G4 — Done-for-you apps from the factory | Fastest cash but needs sales calls. | Only if G2 is slow. |

Payments for the Malaysian company (research `payments`): a **merchant of record** fits low-price B2B/B2C
SaaS sold worldwide (it collects and remits VAT/GST everywhere; ~5% fees). Paddle pays out in 31
currencies; Lemon Squeezy pays bank payouts in USD only; Polar runs on Stripe. **All providers screen
beneficial owners against sanctions lists**, so the adviser check in §3.1 is a hard prerequisite.

## 6. Track I (Iran) — low-cost growth, mostly automated

Status 2026-10-20: paid tiers and payments are live (pricing and model routing in `docs/STATE.md` and `docs/strategy/MODEL_ROUTING_DECISION_2026-10-17.md`); Telegram marketing channel is publishing; the CRM (Twenty) is being dogfooded via `docs/ops/CRM_SYNC.md`.

- Weekly: 3 citation-checked guides (51 live by 2026-10-20); relay batches; collection refresh; lawyer review batch monthly.
- Measure: Umami (shared work with F4/F7). Owner decides prices for the free/paid tiers.
- Messenger bot for Smart Judge (Bale/Telegram) when F2 frees capacity.
- Moadian live integration only if an Iranian accountant pilot asks for it.

## 7. 12-week timeline

| Weeks | Factory (hub + agents) | Phase 0 (owner) | Products |
| --- | --- | --- | --- |
| 1–2 | F1 workbench, F2 queue + escalation, F3 research→spec | Adviser check, partner agreement, company accounts | Research G1/G2/payments; Track I guides continue |
| 3–4 | F4 chassis v1, F5 multi-project deploy | Payment provider opened | G1 landing + waitlist (built with F4) |
| 5–6 | F6 marketing engine, F7 observability | Meta Business, domains | G1 MVP if demand; marketing for G1 + Smart Judge |
| 7–12 | Factory hardening (sandbox for untrusted code, second server only if needed) | Hiring decision (sales/support) | G1 paid pilots; G2 demand test; kill/scale gates |

## 8. Monthly cost (target)

| Item | Now | With plan |
| --- | --- | --- |
| srv1 (Iran track) | ~€15–20 | same |
| Global server (Track G) | — | ~€15–40 (Hetzner ARM, company account) |
| Models (product, free first) | ≈ $0–5 | ≈ $5–20 |
| Agents (factory) | $0 (key empty) | $20–50 |
| Domains, email | small | ~$5–10 |
| Optional | — | ads, lawyer batches, a part-time marketer, only after the funnel is measured |

## 9. KPIs (weekly in the bot)

Factory: tasks completed per week, % merged without hub fixes, cost per merged task, time brief→deploy.
Products: visitors, sign-ups, activation, paying customers, MRR, cost per answer/task. Track I and G separately.

## 10. Owner actions now

(2026-10-20 additions: off-site backup storage, roxira.ir DKIM record typo, Kavenegar template last line `@ghazihoushmand.ir #%token`, one test USDT purchase, Twenty workspace + API key for the CRM sync. Security audit: `docs/security/SECURITY_AUDIT_2026-10-20.md`; OSS audit: `docs/research/OSS_ADOPTION_AUDIT_2026-10-20.md`.)

1. Fund the agents OpenRouter key (~$20) — unblocks F1–F3 at full speed.
2. Book the Malaysian adviser (questions in §3.1) and write the partner agreement (§3.2).
3. Press Start in `@roxira_ops_bot` (status, approvals and reports arrive there).
4. Approve this plan (or tell the hub what to change).
