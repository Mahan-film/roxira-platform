# Strategy now (one page, 2026-11-20; updated 2026-11-21)

This page is a map, not a new source of truth. Every claim links to the document it comes from. "Unverified" means I could not confirm it on `origin/main` (head `e56805260` when written). For the live state read [STATE.md](STATE.md); for how work is built read [FACTORY.md](FACTORY.md).

> [STRATEGY.md](STRATEGY.md) was last updated 2026-09-25. Its "repo stays private, buy GitHub Pro" and "Opus never types" sections are superseded by the decisions below. Treat it as history, not as the current plan.

## 1. Direction and priorities
1. **Product first.** CRM, ERP, accounting and tax that work worldwide. No company, market, pricing or pilot-customer decisions until the product is complete ([MASTER_PLAN_2026-11-16.md](strategy/MASTER_PLAN_2026-11-16.md), [OWNER_ASKS_FA.md](owner/OWNER_ASKS_FA.md)).
2. **Accounting first for the default pack** (live): finish the accounting checklist in issue #230 before anything else ([ISSUE_230_AUDIT_2026_11.md](strategy/ISSUE_230_AUDIT_2026_11.md), [MASTER_PLAN_2026-10-31.md](strategy/MASTER_PLAN_2026-10-31.md)).
3. **Then DE/EU, then the Gulf.** The strictest regime first, so the core that passes it passes most of the EU ([ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md), "Global product: country-pack order"). The pilot pack rows already queued stay only because they test the country-pack framework.
4. **Company and legal steps come after the product and the infrastructure** ([STATE.md](STATE.md), "Direction"; [OWNER_ASKS_FA.md](owner/OWNER_ASKS_FA.md), "paused until the product is complete").
5. **Hub = strategist and reviewer.** Lanes build; the hub writes rows, routes reviews, merges and runs production steps ([STATE.md](STATE.md)).

## 2. Product roadmap by phase
Rows are `T<n>`; each is a GitHub issue with a "Done when" spec (issue numbers are in the linked docs).

| Phase | Scope | Rows / issues | Source |
|---|---|---|---|
| 0: land what is built (to 31 Dec 2026) | Merge about 30 lane PRs in dependency order; fix review-desk blockers first (WAVE rule, WIP 3) | #831 (RLS cutover), #830, #839, country-pack chain #842 to #852 | [MASTER_PLAN_2026-11-16.md](strategy/MASTER_PLAN_2026-11-16.md) |
| Core | Global-grade ledger: acceptance suite, journal integrity and period states, reporting currency and FX, tax engine, dimensions, intercompany, multi-book assets, bank import, idempotency and webhooks | T177 to T185 (plus T169 currency precision) | [ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md), [R16_GLOBAL_CORE.md](strategy/research/R16_GLOBAL_CORE.md) |
| DE/EU pack | GoBD, XRechnung/ZUGFeRD, VAT data, DATEV export, ELSTER/E-Bilanz (parked until the company step), AI transparency labels | T186 to T191 | [R13_GERMANY.md](strategy/research/R13_GERMANY.md) |
| Gulf packs | Fatoora adapter, Peppol PINT mapper, Gulf tax data (start after the DE rows merge) | T174 to T176 | [R14_GULF.md](strategy/research/R14_GULF.md) |
| Infrastructure | Rust-ready retrieval contract and Smart Judge speed, law coverage, Qdrant cleanup, Postgres sizing, user-scoped RLS, CSP enforce, Redis durability, DR email | T211 to T218 | [INFRA_TARGET_2026-11-17.md](strategy/INFRA_TARGET_2026-11-17.md) |
| Hub-owned hardening | RLS coverage gate, off-site vector backups, restore drill, error capture, restricted DB role, fast toolchain, flagd, WAL-G, memory limits, CI guards | T192 to T200, T202 to T207 | [ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md) updates (2) and (3) |
| Factory speed | WIP limit, merge pass, `decide` model role (T166), A2UI spike (T167), faster M1 gate (T168), migration lint (T170), generated hotspot files (T171), review-desk freshness (T172), ledger property tests (T173) | T166 to T173 | [ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md), [R15_FACTORY.md](strategy/research/R15_FACTORY.md) |
| CI box and phone agent | Box CI images, runner, remote local CI, merge desk, phone stack deploy kit | T227 to T233 (#947, #949, #951, #956, #959, #965) | [STATE.md](STATE.md), [LINUX_CI_BOX.md](ops/LINUX_CI_BOX.md) |
| After the product | Outside pilots, payroll decision, WhatsApp capture, POS and payroll for DE | not scheduled | [MASTER_PLAN_2026-11-16.md](strategy/MASTER_PLAN_2026-11-16.md) phases 1 and 2 (paused by the product-first decision) |

Research digests: R1 to R9 ([R1](strategy/research/R1_PRODUCT_UX.md), [R2/R3](strategy/research/R2_R3_INFRA_ASSISTANT.md), [R4](strategy/research/R4_COUNTRY_PACKS.md), [R5-R7](strategy/research/R5_R6_R7_GTM_LEGAL_PORTFOLIO.md), [R8](strategy/research/R8_FACT_CHECK.md), [R9](strategy/research/R9_FIRST_CUSTOMER.md)), [R10-R12](strategy/research/R10_R11_R12_BUSINESS_GROWTH_TECH.md), R13 to R16 and R18/R19 above, [R19](strategy/research/R19_REUSE_MAP.md). The R17 digest was not found as a file under `docs/strategy/research/` (unverified; [STATE.md](STATE.md) says R1-R17 and R19 are digested).

## 3. Smart Judge plan (R18 decision)
Decision (main hub, 2026-11-20): adopt the report's **Option 2**, a phased Smart Judge v2 on the current shared server. The trigger to move it to its own server is the ERP guard alert in T254; moving and paying for a server stays the owner's decision ([R18_SMART_JUDGE.md](strategy/research/R18_SMART_JUDGE.md)).

- **Rows T234 to T258** are issues #973 to #997 (lanes L4, L3, L1, L7).
- **Targets:** first token at most 1.5 s p95; full answer at most 8 s p95; voice turn at most 1.5 s p50; Recall@5 at least 0.95 on the 70-question gate after T241, at least 0.93 on the 300-500 question set at about 500 laws.
- **Not adopted now:** new paid voice vendors, Langfuse, default-on semantic answer cache, speculative multi-draft, full 150K-250K corpus, global GraphRAG summaries.
- **Live today:** serves Qdrant collection v6 (16 laws, R@5 0.929); v7b (60 laws, equal R@5) is switched after T212 (#926, open) ([STATE.md](STATE.md)).
- **Order (L4):** T240, T234, T237, T236, T235, T238, T255, T246, T247, T241, T244, T245, T243, T242, T258, T256, T257.
- Earlier Smart Judge design: [LEGAL_CORE_2026-11-13.md](strategy/LEGAL_CORE_2026-11-13.md), speed contract [ADR_RUST_READY_HOT_PATH.md](strategy/ADR_RUST_READY_HOT_PATH.md).

## 4. Infrastructure and cost policy
- **Free first, lowest cost.** Free and key-pool models first, paid only as fallback; model ids live only in `config/models.yaml` ([AGENTS.md](../AGENTS.md) sections 3 and 4; [MASTER_PLAN_2026-11-16.md](strategy/MASTER_PLAN_2026-11-16.md)). Prices in `config/models.yaml` are re-checked before 2027-01-01 (T161).
- **Customer data:** may be used to run and improve the service (terms must say so); a paid private-data option routes to paid models with data collection denied ([AGENTS.md](../AGENTS.md) section 4, [R8_FACT_CHECK.md](strategy/research/R8_FACT_CHECK.md)).
- **No GitHub spend.** Owner chose private repo **plan A** (Free plan, USD 0) on 2026-11-18. Without protected branches, the guard is the pre-push hook plus a merge desk on the CI box (#951) and an alert on any direct push to `main` ([PRIVATE_REPO_PLAN_2026-11-17.md](strategy/PRIVATE_REPO_PLAN_2026-11-17.md)). The repo is still public today ([TEAM_START.md](TEAM_START.md)); the hub flips visibility only after #947, #949 and #951 land. The merge desk script (`scripts/dev/merge_desk.py`, PR #1005) is not on `origin/main` yet (unverified).
- **No rewrite.** Rust only for a measured hot path above 30% of p95, behind a contract; the heavy parts (TEI, Qdrant) are already Rust ([INFRA_TARGET_2026-11-17.md](strategy/INFRA_TARGET_2026-11-17.md), [ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md)).
- **Production:** one shared server on Docker Compose; a bigger server is the owner's spend (trigger: RAM above 70% for 7 days). Backups, monitoring and open items: [STATE.md](STATE.md), [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md).
- **Not now:** new runtime platforms, adopting outside suites, a PostgreSQL major on a `.0` release (revisit triggers in [ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md)).

## 5. Team and machines
Source: [TEAM_SPLIT_2026-11-17.md](TEAM_SPLIT_2026-11-17.md), [STATE.md](STATE.md).

| Machine | Lanes | Hub | Owns |
|---|---|---|---|
| Mac | L1 ops/CI/infra, L2 frontend + currency, L3 security/data, L4 Smart Judge (Antigravity) | main hub (Claude Code) | strategy, WAVE posts, merges of L1-L4 and hub PRs, all production steps |
| Linux box `roxira-ci` | L5 core ledger, L6 DE then Gulf, L7 box + phone kit | box hub (Claude Code, second account) | merges L5-L7 after "no blocker", CI runner, phone stack; never touches production |

Briefs: [MAIN_HUB_MASTER_BRIEF.md](hub/MAIN_HUB_MASTER_BRIEF.md) (Mac), [BOX_HUB_MASTER_BRIEF.md](hub/BOX_HUB_MASTER_BRIEF.md) (laptop). Mac-to-laptop tasks go through #965 without the owner.

Fallback builder when Antigravity quota runs out: Gemini CLI via `scripts/ops/ci_box/gemini_lanes.sh`. Full flow, rules and troubleshooting: [FACTORY.md](FACTORY.md).

## 6. Decisions log

| Date | Decision | Doc |
|---|---|---|
| 2026-11-12 | Hub spends minimal tokens; lanes build | [TEAM_OPERATING_MODEL_2026-11-12.md](strategy/TEAM_OPERATING_MODEL_2026-11-12.md) |
| 2026-11-16 | Product first; no company or market decisions until the product is done | [MASTER_PLAN_2026-11-16.md](strategy/MASTER_PLAN_2026-11-16.md) |
| 2026-11-16 | Lowest cost; customer data may improve the service; paid private-data option | [MASTER_PLAN_2026-11-16.md](strategy/MASTER_PLAN_2026-11-16.md), [R8_FACT_CHECK.md](strategy/research/R8_FACT_CHECK.md) |
| 2026-11-16 | No Rust/Go rewrite; WIP limit; merge pass; DE then Gulf pack order | [ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md) |
| 2026-11-17 | Two machines, lanes L1-L7 | [TEAM_SPLIT_2026-11-17.md](TEAM_SPLIT_2026-11-17.md) |
| 2026-11-17 | Rust-ready hot-path contracts; infra target | [INFRA_TARGET_2026-11-17.md](strategy/INFRA_TARGET_2026-11-17.md) |
| 2026-11-18 | Private repo plan A (Free, USD 0); merge desk on the box | [PRIVATE_REPO_PLAN_2026-11-17.md](strategy/PRIVATE_REPO_PLAN_2026-11-17.md) |
| 2026-11-18 | Printed secrets of 2026-11-17 not rotated now (owner, optional later) | [STATE.md](STATE.md) |
| 2026-11-19 | Gemini CLI fallback builder on the box | [TEAM_SPLIT_2026-11-17.md](TEAM_SPLIT_2026-11-17.md) |
| 2026-11-20 | Smart Judge v2: Option 2, phased, on the current server | [R18_SMART_JUDGE.md](strategy/research/R18_SMART_JUDGE.md) |
| 2026-11-20 | R20: one deterministic dispatcher on the laptop, GitHub as queue, private repo at USD 0 after replacements | [R20_DIGEST.md](strategy/R20_DIGEST.md) |
| 2026-11-20 | Hub bridge through GitHub (#965 WAVE:/REPORT:), not Remote Control (two Claude accounts) | [R21_AGENT_BRIDGE.md](research/R21_AGENT_BRIDGE.md) |
| 2026-11-21 | Mac Claude account moves to the colleague (main owner); the current account runs the laptop hub. Approval rule = open item O-1 | [STATE.md](STATE.md), [MAIN_HUB_MASTER_BRIEF.md](hub/MAIN_HUB_MASTER_BRIEF.md) |

## 7. Open owner decisions (names only)
Source: [OWNER_ASKS_FA.md](owner/OWNER_ASKS_FA.md) (read it each session; the list there is Persian). Last updated there 2026-11-17, so it may lag [STATE.md](STATE.md).
- Merge approval for the PgBouncer security update PR (#857): listed as waiting in OWNER_ASKS_FA.md; its current status is unverified.
- Optional rotation of the secrets printed on 2026-11-17 ([STATE.md](STATE.md)).
- Owner-run steps on the CI box and the phone stack, including the keys the phone agent needs (never via chat or git) ([STATE.md](STATE.md)).
- Bigger production server, and moving Smart Judge to its own server (owner spend; trigger T254).
- Private repo: spend choice already made (plan A); the visibility flip waits on #947, #949, #951.
- Paused until the product is complete: company details, registrations, brand, pricing, accountant commissions, lawyer review of customer legal drafts.
- Only if needed: enabling billing on a Gemini project after the free quota runs out.
