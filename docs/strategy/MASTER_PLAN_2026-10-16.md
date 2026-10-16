# Roxira master plan — 2026-10-16

Supersedes the priority lists in `docs/STRATEGY.md` §5 and `docs/STRATEGY_STATUS_2026-10-14.md` §9.
`docs/STATE.md` stays the live status page; this file is the plan it serves.

## 1. Where we really are (measured 2026-10-15/16)

| Area | Fact | Source |
| --- | --- | --- |
| Product | Smart Judge works end to end: grounded chat with citations, laws v6 (29+ laws, ~6,200 articles), 300 unity rulings, 112 regulations in chat, 31 guides, drafting, damages, voice, payments, PWA. | live tests this week |
| Roxira | Portal + 7 tenant-isolated modules (CRM, invoicing, accounting, HR, inventory, damages, tax). Moadian is **not** connected to the real system. | STATE.md |
| Users | **2 registered users, 2 tenants, 0 enterprise inquiries.** | prod DB counts |
| Revenue | **1 paid order (1,000,000 rial = 100k toman, a test); 4 pending.** | `payment_orders` |
| Traffic | A few hundred unique visitors a day at most, much of it bots and our own QA; **no search-engine referrals yet** (GSC/Bing verified 2026-10-14, indexing still young). | nginx logs, 7 days |
| Running cost | One Hetzner ARM server (8 GB) + free model tiers; paid DeepSeek only as fallback (≈ $0.0003 per paid answer). | key-pool cost log |
| Engineering | ~680 PRs, auto-deploy with rollback, monitoring, backups, SBOM, mutation/property tests, key pool, agents. | repo |

**Diagnosis.** We built a strong product and a strong engineering machine, and almost no distribution.
The bottleneck is not technology. It is (1) people finding the product, (2) trusting it enough to pay, and
(3) a clear offer and price. Every hour spent on infrastructure from now on must be justified by one of
those three. Infrastructure is frozen except for fixes and what the growth plan needs.

## 2. Business architecture (what makes money, in order)

| # | Business | Customer | Offer | Why it fits us | Status |
| --- | --- | --- | --- | --- | --- |
| A | **Smart Judge B2C** | Iranians with a legal problem (rent, cheque, labour, family, inheritance) | Free answers with citations → paid drafts (petition, complaint, defence) and a monthly plan | Product done; huge search demand; self-serve, no sales calls | Live, needs traffic + trust + price |
| B | **Smart Judge Pro** | Lawyers, legal staff, law students | Faster research, drafting, citation check, case files; per-seat monthly | Lawyers pay (owner decision); one lawyer brings clients; word of mouth in a closed profession | Not packaged yet |
| C | **Roxira tax wedge (Moadian)** | SMBs and the accountants who serve many of them | Invoice + e-invoice compliance + legal/tax Q&A; accountants manage many tenants | Legal mandate creates demand; accountants are a channel (one accountant = 20–50 SMBs); our legal AI is a differentiator | Modules exist; real Moadian link missing |
| D | **Legal data API (DaaS, Iran)** | Legal-tech, fintech, publishers | Clean laws/rulings/regulations with versions and citations via API | We already built the corpus and pipelines | Later, after A–C prove demand |
| E | **AI Software Factory** | SMBs that want a custom app | Done-for-you app built by our agents, sold as a project | Real capability, but needs sales calls and support | Park until A or C pays the bills |

Rules for choosing work (the solo-founder filter, accepted from the 2026-10-15 review): self-serve sale,
value in data/automation not in heavy UI, buyers are SMBs/professionals in Iran, no regulated
liabilities we cannot carry. CRM/HR/inventory stay add-ons, not the lead offer.

## 3. Target architecture (keep it; do not rebuild)

One server (srv1), one repo, one Next.js app for all domains, NestJS for business modules, FastAPI for the
legal AI, Postgres + Qdrant + Redis, LiteLLM key pool (free first, paid fallback), auto-deploy with
rollback. This is right for our scale for at least 12 months.

Only these architecture additions are justified, each tied to a business need:

| Addition | Serves | Cost |
| --- | --- | --- |
| Self-hosted privacy-friendly analytics (Umami on our Postgres) | Know the funnel: visit → chat → signup → pay | ~100 MB RAM, free |
| Messenger channel: Smart Judge bot in **Bale** (and Telegram) | Distribution where Iranians are; headless, no UI work | small, reuses chat API |
| Lawyer verification layer: "reviewed by a lawyer" badge, `lawyer_verified` golden cases | Trust → payment | lawyer time |
| Real Moadian integration (token, send, inquiry, per-tenant keys) | Business C | `docs/research/MOADIAN_REQUIREMENTS_2026-10-14.md` §7 |
| Pro workspace: case files, saved research, seats | Business B | mostly existing pieces |

Explicitly **not** now: x402/Stripe/Polar/Lago, Bifrost, Restate, LangGraph, Neon, Firecracker/second
server, Chatwoot, EU compliance, Camoufox (refused), microservice splits, a second product line beyond A–C.

## 4. 90-day plan

### Phase 1 — Measure and earn trust (weeks 1–2)
1. Analytics: Umami self-hosted + funnel events (landing, chat started, answer shown, signup, checkout, paid). Persian weekly KPI report to the owner bot.
2. Iran reachability: probe from an Iranian vantage (the Mac relay already runs in Iran); fix Cloudflare settings if needed.
3. Pricing and packaging (owner decides; hub prepares 2–3 options with Iranian competitor prices): free tier limits, per-draft price, monthly plan, Pro seat.
4. Lawyer loop: the review pack (`~/Downloads/بازبینی_پاسخ‌های_قاضی_هوشمند_۱۴۰۵-۰۷-۲۲.docx`) → verdicts into golden cases → fix wrong answers → "reviewed" badge on verified guides.
5. Conversion fixes: every guide/law/ruling page ends with a specific chat CTA ("ask about your case"), signup prompt after the 2nd answer, clear upgrade moment at drafting.

### Phase 2 — Distribution engine (weeks 3–6)
6. Content machine: 3 citation-checked guides per week from the 50 high-intent queries (agents write, hub checks citations, lawyer spot-checks). Internal links laws ↔ guides ↔ rulings.
7. GEO: `llms.txt`, FAQ/Organization schema audit, brand profiles, comparison pages ("قاضی هوشمند vs ...") — honest.
8. Bale bot (then Telegram): ask a question in the messenger, get a cited short answer + link to full answer/draft on the site.
9. Lawyer channel: free Pro for the first 20 lawyers in exchange for feedback and referrals; referral code for clients.
10. Missing law: direct taxes (consolidated text) — high search demand, also feeds Business C.

### Phase 3 — Second revenue line (weeks 7–12)
11. Moadian wedge MVP for accountants: multi-client view, invoice → e-invoice send/inquiry (real API), tax Q&A grounded in tax circulars (already in chat).
12. 3–5 paying pilot accountants (owner sells; hub prepares the demo, onboarding doc and contract template).
13. Smart Judge Pro packaging (seats, case files, saved research) if lawyers in step 9 ask for it.

### Always-on (small, weekly)
Weekly relay batches (laws/regulations) and collection refresh; SBOM/mutation reports; dependency bumps;
security fixes from the scan; cost report. No new infrastructure without a line in §3.

## 5. KPIs (weekly, in the owner bot)

| KPI | Now | 30 days | 90 days |
| --- | --- | --- | --- |
| Organic visitors / week (human) | ~0 measured | 1,000 | 10,000 |
| Chats started / week | tens | 300 | 3,000 |
| Signups / week | ~0 | 30 | 300 |
| Paying customers (cumulative) | 0 real | 10 | 100 + 3 accountant pilots |
| Revenue / month | 0 | first real payments | covers server + models + lawyer |
| Answer accuracy on lawyer-verified set | not measured | measured | ≥ 90% |
| Cost per answered question | ≈ $0 free / $0.0003 paid | tracked | tracked |

## 6. Operating model

- Owner: decisions (price, offers, lawyer, accountant sales), identity/payment actions, 2 short reviews a week.
- Hub (Claude): plans, specs, reviews, tests, merges, ops; reports in Persian; never hands the owner shell work unless a secret or identity is needed.
- Agents (server, OpenCode): implementation. Need the agents' OpenRouter key funded (~$10/month is enough at current rates); free tiers alone fail on multi-step tasks.
- Lawyer: monthly review batch (answers + new guides), paid per batch.
- Cadence: Saturday plan (hub posts the week's 3–5 goals), Wednesday check, KPI report every Friday via the bot.

## 7. Decisions needed from the owner

1. Personal goal: target monthly income and time horizon (sets how aggressive Phase 2–3 are).
2. Primary focus for the next 90 days: A+B (Smart Judge) first, or C (Moadian/accountants) in parallel.
3. Prices: free-tier limits, per-draft, monthly, Pro seat (hub will bring options with competitor data).
4. Budget: agents key top-up, lawyer per batch, optional ads (Yektanet/Instagram) once the funnel is measured.
5. Who sells to accountants/lawyers (the owner, a part-time sales partner, or referrals only).
