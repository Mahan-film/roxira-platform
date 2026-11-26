# Docs index

Where to find things. Written 2026-11-20 from the files on `origin/main`. **archive candidate** = older than 30 days (before 2026-10-21) and looks superseded. Nothing has been moved or deleted; the owner or hub decides ([AGENTS.md](../AGENTS.md) section 6). Already-archived files are in [archive/](archive/README.md) and are not to be trusted as facts.

Never read `repomix-output.xml`, `database_snapshots/`, `*.sql` or `*.tar.gz`.

## Start here
| File | What it is |
|---|---|
| [hub/HUB_START.md](hub/HUB_START.md) | Restart the hub on a new Claude account, Mac user or machine; hub memory copy in [hub/memory/](hub/memory/MEMORY.md) |
| [TEAM_START.md](TEAM_START.md) | One page for a new colleague and their AI accounts |
| [STATE.md](STATE.md) | Current state: what is live, what is open, what waits on the owner |
| `ARCHITECTURE.md` | Architecture overview (may be added by another change; unverified on this branch) |
| [STRATEGY_NOW.md](STRATEGY_NOW.md) | The current strategy on one page, with links to sources |
| [FACTORY.md](FACTORY.md) | Operating manual of the agent factory: task flow, lanes, review, merge, unblock |
| [AI_HANDOFF.md](AI_HANDOFF.md) | How any assistant continues the project |
| [SYSTEM_MAP.md](SYSTEM_MAP.md) | What exists in the repo |
| [agents/LESSONS.md](agents/LESSONS.md) | Rules from real review mistakes; read before every task |

## Strategy
| File | What it is |
|---|---|
| [STRATEGY.md](STRATEGY.md) | Master strategy of 2026-09; **archive candidate** as a plan (repo visibility and role rules are superseded), still useful for the workstream history |
| [strategy/MASTER_PLAN_2026-11-16.md](strategy/MASTER_PLAN_2026-11-16.md) | Current master plan and phases |
| [strategy/ARCHITECTURE_DECISIONS_2026-11-16.md](strategy/ARCHITECTURE_DECISIONS_2026-11-16.md) | What we adopt and refuse; rows T166 to T210 |
| [strategy/INFRA_TARGET_2026-11-17.md](strategy/INFRA_TARGET_2026-11-17.md) | Target infrastructure and the Rust-ready path; rows T211 to T218 |
| [strategy/UPGRADE_PLAN_2026-11.md](strategy/UPGRADE_PLAN_2026-11.md) | Runtime and framework versions (current vs latest), upgrade order, Rust where it pays |
| [strategy/R20_DIGEST.md](strategy/R20_DIGEST.md) | Two machines, agent dispatcher, private repo at $0: decisions D1-D6 and rows R20-1..8 (raw: [research/R20_TWO_MACHINE_RAW.md](strategy/research/R20_TWO_MACHINE_RAW.md)) |
| [strategy/PRIVATE_REPO_PLAN_2026-11-17.md](strategy/PRIVATE_REPO_PLAN_2026-11-17.md) | Plan for making the repo private (plan A chosen) |
| [strategy/ADR_GLOBAL_CORE.md](strategy/ADR_GLOBAL_CORE.md) | Global core design decision |
| [strategy/ADR_RUST_READY_HOT_PATH.md](strategy/ADR_RUST_READY_HOT_PATH.md) | Retrieval contract and Rust trigger |
| [strategy/LEGAL_CORE_2026-11-13.md](strategy/LEGAL_CORE_2026-11-13.md) | Smart Judge legal core design |
| [strategy/PRODUCT_DECISIONS_2026-11.md](strategy/PRODUCT_DECISIONS_2026-11.md) | Product decisions of November |
| [strategy/PRODUCT_RESET_2026-11-15.md](strategy/PRODUCT_RESET_2026-11-15.md) | Product reset and scope |
| [strategy/TEAM_OPERATING_MODEL_2026-11-12.md](strategy/TEAM_OPERATING_MODEL_2026-11-12.md) | Team model: hub spends few tokens, lanes build |
| [strategy/HUB_TOKEN_STRATEGY_2026-11-15.md](strategy/HUB_TOKEN_STRATEGY_2026-11-15.md) | How the hub saves tokens |
| [strategy/COMPETITORS_2026-11.md](strategy/COMPETITORS_2026-11.md) | Competitor notes |
| [strategy/ISSUE_230_AUDIT_2026_11.md](strategy/ISSUE_230_AUDIT_2026_11.md) | Audit of the accounting checklist (#230) |
| [strategy/STRATEGY_COVERAGE.md](strategy/STRATEGY_COVERAGE.md) | Status per strategy area |
| [strategy/REQUIREMENTS_STATUS.md](strategy/REQUIREMENTS_STATUS.md) | Requirements status table (large) |
| [strategy/FEATURE_GAP_30.md](strategy/FEATURE_GAP_30.md) | Feature gap list |
| [strategy/DEEP_RESEARCH_ROUND1.md](strategy/DEEP_RESEARCH_ROUND1.md), [ROUND2](strategy/DEEP_RESEARCH_ROUND2.md), [ROUND3](strategy/DEEP_RESEARCH_ROUND3.md), [ROUND4](strategy/DEEP_RESEARCH_ROUND4.md), [PROMPTS_FA](strategy/DEEP_RESEARCH_PROMPTS_FA.md) | Prompts for the owner's deep-research runs |
| [strategy/MASTER_PLAN_2026-10-31.md](strategy/MASTER_PLAN_2026-10-31.md), [first-pack roadmap 2026-10-31](strategy/IRAN_FIRST_ROADMAP_2026-10-31.md), [ACCOUNTING_PRODUCT_2026-10-30.md](strategy/ACCOUNTING_PRODUCT_2026-10-30.md), [MASTER_STRATEGY_2026-10-30.md](strategy/MASTER_STRATEGY_2026-10-30.md), [FACTORY_GAP_AUDIT_2026-10-30.md](strategy/FACTORY_GAP_AUDIT_2026-10-30.md), [TEAM_WORKFLOW_2026-11-03.md](strategy/TEAM_WORKFLOW_2026-11-03.md) | Late-October to early-November plans; still referenced by the 2026-11-16 plan, so not archive candidates yet |
| [strategy/MASTER_PLAN_2026-10-16.md](strategy/MASTER_PLAN_2026-10-16.md), [MODEL_ROUTING_DECISION_2026-10-17.md](strategy/MODEL_ROUTING_DECISION_2026-10-17.md) | **archive candidate**: replaced by the 2026-11-16 plan and `config/models.yaml` |
| [strategy/LEAN_ARCHITECTURE_2026-10-22.md](strategy/LEAN_ARCHITECTURE_2026-10-22.md), [FACTORY_V2_2026-10-22.md](strategy/FACTORY_V2_2026-10-22.md), [SUITE_V2_COMPOSABLE_2026-10-22.md](strategy/SUITE_V2_COMPOSABLE_2026-10-22.md), [ROXIRA_BUSINESS_SUITE_2026-10-22.md](strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md), [QUALITY_SYSTEM_2026-10-22.md](strategy/QUALITY_SYSTEM_2026-10-22.md), [ECOSYSTEM_REVIEW_2026-10-22.md](strategy/ECOSYSTEM_REVIEW_2026-10-22.md) | 2026-10-22 designs; become archive candidates after 2026-11-21 if nothing links them |
| [STRATEGY_GAP_2026-10-12.md](../archive/docs/STRATEGY_GAP_2026-10-12.md), [STRATEGY_STATUS_2026-10-14.md](../archive/docs/STRATEGY_STATUS_2026-10-14.md), [plan.md](plan.md) | **archive candidate**: October status snapshots |

## Research digests (`strategy/research/`)
| File | What it is |
|---|---|
| [R1_PRODUCT_UX.md](strategy/research/R1_PRODUCT_UX.md) | Product, UX, frontend architecture |
| [R2_R3_INFRA_ASSISTANT.md](strategy/research/R2_R3_INFRA_ASSISTANT.md) | Infrastructure, security, delivery; chat and voice assistant |
| [R4_COUNTRY_PACKS.md](strategy/research/R4_COUNTRY_PACKS.md) | Country packs and market entry |
| [R5_R6_R7_GTM_LEGAL_PORTFOLIO.md](strategy/research/R5_R6_R7_GTM_LEGAL_PORTFOLIO.md) | Go-to-market, legal assistant, portfolio |
| [R8_FACT_CHECK.md](strategy/research/R8_FACT_CHECK.md) | Fact check of R4/R5; owner answers on data policy |
| [R9_FIRST_CUSTOMER.md](strategy/research/R9_FIRST_CUSTOMER.md) | First-customer field requirements |
| [R10_R11_R12_BUSINESS_GROWTH_TECH.md](strategy/research/R10_R11_R12_BUSINESS_GROWTH_TECH.md) | Business, growth and support, tech future-proofing |
| [R13_GERMANY.md](strategy/research/R13_GERMANY.md) | DE/EU country pack |
| [R14_GULF.md](strategy/research/R14_GULF.md) | Gulf country packs |
| [R15_FACTORY.md](strategy/research/R15_FACTORY.md) | Factory speed and quality |
| [R16_GLOBAL_CORE.md](strategy/research/R16_GLOBAL_CORE.md), [R16_ACCEPTANCE_TESTS.md](strategy/research/R16_ACCEPTANCE_TESTS.md) | Global-grade accounting core and its 15 acceptance tests |
| [R18_SMART_JUDGE.md](strategy/research/R18_SMART_JUDGE.md) | Smart Judge v2 digest, rows T234 to T258 |
| [R18_SMART_JUDGE_RAW.md](strategy/research/R18_SMART_JUDGE_RAW.md) | Raw R18 report (about 85 KB; input, not fact) |
| [R19_REUSE_MAP.md](strategy/research/R19_REUSE_MAP.md) | Open-source reuse map |
| [research/](research/) | Older research from 2026-10 (tool scouting, STT, legal RAG, autonomy, design): **archive candidate** for the dated 2026-09 and 2026-10 files before 2026-10-21 |

## Operations and runbooks
| File | What it is |
|---|---|
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | How things are done: deploy, workers, merging traps (sections 7-8) |
| [COLLABORATION.md](COLLABORATION.md) | Two people, many agents: claim, lanes, daily report |
| [PARALLEL_CHATS.md](PARALLEL_CHATS.md) | Hub and workstream chat model of 2026-09; **archive candidate** (model and lane table are superseded by FACTORY.md; chat handoff section still useful) |
| [TEAM_SPLIT_2026-11-17.md](TEAM_SPLIT_2026-11-17.md) | Two machines, lanes L1-L7, box setup |
| [ops/LINUX_CI_BOX.md](ops/LINUX_CI_BOX.md) | The Linux CI box |
| [ops/LAPTOP_HANDOFF_2026-11-18.md](ops/LAPTOP_HANDOFF_2026-11-18.md) | Moving work to the box laptop |
| [ops/AUTODEPLOY.md](ops/AUTODEPLOY.md), [DEPLOY_LOCAL.md](ops/DEPLOY_LOCAL.md) | Server autodeploy; local deploy script |
| [ops/AUTO_MERGE.md](ops/AUTO_MERGE.md), [RX_AUTOMERGE.md](ops/RX_AUTOMERGE.md) | Auto-merge rules (revisit under private repo plan A) |
| [ops/DISASTER_RECOVERY.md](ops/DISASTER_RECOVERY.md), [RESTORE_DRILL.md](ops/RESTORE_DRILL.md), [OFFSITE_BACKUP.md](ops/OFFSITE_BACKUP.md), [BACKUP_RETENTION.md](ops/BACKUP_RETENTION.md), [BACKUP_SCHEDULE_2026-10-30.md](ops/BACKUP_SCHEDULE_2026-10-30.md), [TELEGRAM_BACKUP.md](ops/TELEGRAM_BACKUP.md), [BACKUP_EMAIL.md](ops/BACKUP_EMAIL.md) | Backups and recovery |
| [ops/MONITORING.md](ops/MONITORING.md), [OBSERVABILITY.md](ops/OBSERVABILITY.md), [ESCALATION.md](ops/ESCALATION.md), [RESILIENCE.md](ops/RESILIENCE.md) | Monitoring and escalation |
| [ops/MEMORY_BUDGET.md](ops/MEMORY_BUDGET.md), [APP_DB_ROLE.md](ops/APP_DB_ROLE.md) | Memory budget; restricted database role |
| [ops/MODEL_ROUTING.md](ops/MODEL_ROUTING.md), [LLM_FALLBACK.md](ops/LLM_FALLBACK.md), [FALLBACK_CHAINS.md](ops/FALLBACK_CHAINS.md), [AI_DATA_POLICY.md](ops/AI_DATA_POLICY.md), [ADD_LLM_KEY.md](ops/ADD_LLM_KEY.md), [API_KEYS.md](ops/API_KEYS.md) | Models, fallbacks, data policy, key handling (names only) |
| [ops/SECRETS_SOPS.md](ops/SECRETS_SOPS.md), [SBOM.md](ops/SBOM.md), [CI_SCANNERS.md](ops/CI_SCANNERS.md), [ZERO_COST_CI.md](ops/ZERO_COST_CI.md) | Secrets, supply chain, CI scanners |
| [ops/SERVER_AGENTS.md](ops/SERVER_AGENTS.md), [TASK_CAPS.md](ops/TASK_CAPS.md), [SELF_IMPROVEMENT.md](ops/SELF_IMPROVEMENT.md), [CONTROL_BOT.md](ops/CONTROL_BOT.md) | Server-side agents and their caps |
| [ops/SMARTJUDGE_BEHAVIOR.md](ops/SMARTJUDGE_BEHAVIOR.md), [SMARTJUDGE_PROMPTS.md](ops/SMARTJUDGE_PROMPTS.md), [STT_BENCH.md](ops/STT_BENCH.md), [RULING_EVAL.md](ops/RULING_EVAL.md) | Smart Judge behaviour and evals |
| [ops/LEGAL_FETCH_LAWS.md](ops/LEGAL_FETCH_LAWS.md), [LEGAL_FETCH_EKHTEBAR.md](ops/LEGAL_FETCH_EKHTEBAR.md), [LEGAL_INGEST.md](ops/LEGAL_INGEST.md) | Legal corpus fetch and ingest |
| [ops/HUGE_IMPORT.md](ops/HUGE_IMPORT.md), [BAK_PIPELINE.md](ops/BAK_PIPELINE.md), [MIGRATION_TRANSFORM.md](ops/MIGRATION_TRANSFORM.md), [MIGRATION_CERTIFICATE.md](ops/MIGRATION_CERTIFICATE.md), [IMPORT_BOUNDARIES.md](ops/IMPORT_BOUNDARIES.md) | Bulk import pipelines |
| [ops/TWO_COMPUTERS.md](ops/TWO_COMPUTERS.md), [HOUSEKEEPING.md](ops/HOUSEKEEPING.md), [PUBLIC_REPO_MIGRATION.md](ops/PUBLIC_REPO_MIGRATION.md), [PUBLIC_EXPORT.md](ops/PUBLIC_EXPORT.md), [OLD_SERVER_DECOMMISSION.md](ops/OLD_SERVER_DECOMMISSION.md) | Machines, housekeeping, repo move, old-server decommission |
| [ops/CHAT_LATENCY_2026-10-09.md](ops/CHAT_LATENCY_2026-10-09.md), [VOICE_DIAGNOSIS_2026-10-11.md](ops/VOICE_DIAGNOSIS_2026-10-11.md), [REPO_TIDY_PLAN_2026-10-14.md](ops/REPO_TIDY_PLAN_2026-10-14.md), [LEDGER_AUDIT_2026-10.md](ops/LEDGER_AUDIT_2026-10.md), [BAKEOFF.md](ops/BAKEOFF.md), [MODEL_BAKEOFF.md](ops/MODEL_BAKEOFF.md), [TOURNAMENT.md](ops/TOURNAMENT.md) | **archive candidate**: October measurements and one-off plans, newer docs cover them |
| [testing/M1_GATE.md](testing/M1_GATE.md), [E2E.md](E2E.md) | Playwright gate and E2E notes |
| [security/](security/) | Security audit, tenant RLS and vector-store tenancy designs |
| [infra/](infra/) | Infrastructure map, key pool and key inventory (names only), cloud accounts plan |
| [accounting/](accounting/), [tax/](tax/), [inventory/](inventory/), [hr/](hr/) | Module design notes: posting rules, cheques, treasury, tax workbenches, stores, statutory items |
| [help/](help/) | User help pages (Persian) |
| [eval/](eval/) | Evaluation reports and plans |
| [radar/](radar/) | Tech radar decisions |

## Owner
| File | What it is |
|---|---|
| [owner/OWNER_ASKS_FA.md](owner/OWNER_ASKS_FA.md) | What only the owner can do (Persian); re-asked every session |
| [owner/README_FA.md](owner/README_FA.md) | Owner folder guide |
| [owner/STRATEGY_2026-11-10_FA.md](owner/STRATEGY_2026-11-10_FA.md) | Owner strategy note of 2026-11-10 |
| [owner/TRACK_C_FA.md](owner/TRACK_C_FA.md) to [TRACK_G_FA.md](owner/TRACK_G_FA.md) | Persian track briefs; **archive candidate** if the tracks are closed (unverified) |
| [owner/MAIL_DNS_RECORDS.md](owner/MAIL_DNS_RECORDS.md), [AGC_PERMISSION_REQUEST_DRAFT.md](owner/AGC_PERMISSION_REQUEST_DRAFT.md) | Mail records; permission request draft |
| [OWNER_GUIDE_FA.md](OWNER_GUIDE_FA.md), [OWNER_MASTER_OVERVIEW_FA.md](OWNER_MASTER_OVERVIEW_FA.md) | Owner guides (Persian) |
| [LAWYER_QUESTIONS_FA.md](LAWYER_QUESTIONS_FA.md), [LAWYER_QUESTIONS_ROUND2_FA.md](LAWYER_QUESTIONS_ROUND2_FA.md), [LAWYER_ANSWERS_2026-10-21.md](LAWYER_ANSWERS_2026-10-21.md) | Lawyer Q and A |
| [LAWYER_ANSWERS_2026-09-30.md](../archive/docs/LAWYER_ANSWERS_2026-09-30.md) | **archive candidate**: replaced by the 2026-10-21 answers |
| [legal_customer/](legal_customer/) | Customer-facing terms, privacy, DPA, subprocessors (drafts) |
| [legal/](legal/), [legal_sources/](legal_sources/), [LEGAL_COVERAGE_MANIFEST.md](LEGAL_COVERAGE_MANIFEST.md), [LEGAL_COVERAGE_ROADMAP.md](LEGAL_COVERAGE_ROADMAP.md) | Legal corpus builds, sources and coverage |
| [marketing/](marketing/) | Marketing setup and sources |

## Agents and factory
| File | What it is |
|---|---|
| [agents/LESSONS.md](agents/LESSONS.md) | Rules every agent follows |
| [antigravity/prompts/](antigravity/prompts/) | Lane prompts L1 to L7 and `ALL_LANES.txt` |
| [antigravity/LANE_PROMPT_FA.md](antigravity/LANE_PROMPT_FA.md), [README_FA.md](antigravity/README_FA.md), [TASKS.md](antigravity/TASKS.md) | Shared lane prompt, setup guide, task list |
| [AGENTS_WORKFORCE.md](AGENTS_WORKFORCE.md) | Agent workforce design of 2026-09 (W10); **archive candidate** |
| [PROJECT_FACTORY.md](PROJECT_FACTORY.md), [factory/](factory/) | Project factory plans of 2026-10; **archive candidate** for the dated ones, FACTORY.md is the current manual |
| [decisions/](decisions/) | ADRs: record decisions, model registry, agent operating model |
| [CONTEXT_HUB.md](CONTEXT_HUB.md) | Context selection for agents |
| [design/](design/), [ux/](ux/) | Design and UX audits |
| [gemini_handoff/](gemini_handoff/), [gemini_out/](gemini_out/) | Gemini task inputs and outputs of 2026-10; **archive candidate** |

## History and older docs
| File | What it is |
|---|---|
| [progress.md](progress.md) | Running progress log |
| [HANDOFF_2026-11-17.md](../archive/docs/HANDOFF_2026-11-17.md), [HANDOFF_2026-11-12.md](../archive/docs/HANDOFF_2026-11-12.md), [HANDOFF_2026-11-11.md](../archive/docs/HANDOFF_2026-11-11.md), [HANDOFF_2026-11-05.md](../archive/docs/HANDOFF_2026-11-05.md) | Recent hub handoffs (superseded by STATE.md as time passes) |
| [HANDOFF_2026-10-15.md](../archive/docs/HANDOFF_2026-10-15.md), [HANDOFF_2026-10-04.md](../archive/docs/HANDOFF_2026-10-04.md) | **archive candidate** |
| [W6_legal_corpus_diagnosis.md](W6_legal_corpus_diagnosis.md), [W7_voice_latency.md](W7_voice_latency.md), [W15_stt_plan.md](W15_stt_plan.md), [W17_payment_audit.md](W17_payment_audit.md), [W17_payment_fix.md](W17_payment_fix.md), [W20_realtime_voice.md](W20_realtime_voice.md), [W25_phase1_acquisition.md](W25_phase1_acquisition.md) | **archive candidate**: workstream reports of 2026-09 and 2026-10 |
| [SECURITY_daemon_worker_review.md](SECURITY_daemon_worker_review.md), [HISTORY_REWRITE.md](HISTORY_REWRITE.md) | **archive candidate**: one-off reviews of 2026-09; the history rewrite is done |
| [BULK_IMPORT.md](BULK_IMPORT.md), [IMPORT_SUPPORT.md](IMPORT_SUPPORT.md), [IMPORT_SOURCE_PRODUCTS.md](IMPORT_SOURCE_PRODUCTS.md) | Import design notes (current) |
| [SYSTEM_INVENTORY.generated.md](SYSTEM_INVENTORY.generated.md) | Generated inventory; regenerate, do not edit |
| [archive/](archive/README.md) | Already archived; do not trust as facts |
| [screenshots/](screenshots/) | UI screenshots for design audits |
