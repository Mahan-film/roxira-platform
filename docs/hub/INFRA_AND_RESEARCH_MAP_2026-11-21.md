# Infra and research map (main hub, 2026-11-21)

Built from the repo docs on 2026-11-21 plus the live PR list and #965 comments. Status labels come
from docs, not from live checks on production. Live GitHub data beats this file.

## 1. Components

| Area | Path | Status |
|---|---|---|
| Factory / agent infra | `factory_engine.py`, `scripts/dev/` (claim, local_ci, review desk), `scripts/infra/server_agents/`, `.github/workflows/factory-*.yml` | Present. Current model = GitHub issues + lane labels + `## WAVE` comments on #592. rx/OpenCode/`agent` label are the older model. |
| Lane bridge Mac→laptop | `scripts/ops/ci_box/agent_bridge`, `merge_gate`, `scripts/dev/hub_wave.sh`, `hub_reports.sh` | Bridge built (#1028), installed 2026-11-21. First read-only WAVE failed: `claude -p` on the box had Bash denied. Merge gate dry-run (#1029). `roxira-orch` (#1021) not built. |
| Smart Judge core | `output_apps/generated_modules/smartjudge/` | Live (FastAPI :8000). R18 rows T234-T258 mostly open. |
| Smart Judge RAG | `served_collection.py`, `legal_graph/`, Qdrant, TEI bge-m3 | Live on v6 (16 laws). v7b (60 laws) waits on T212 #926. Risk: `lightrag_engine.py` falls back to `iran_laws_v2` if `LIGHTRAG_QDRANT_COLLECTION` is unset. |
| Phone / LiveKit | `services/voice_phone_agent/`, `scripts/ops/ci_box/05_root_phone_stack.sh` | On the laptop, user `phone`. SIP trunk "Unregistered". Fixes #1040/#1042; diagnosis #1047. |
| Accounting / tax | `output_apps/enterprise_hub/modules/{accounting,tax_compliance,banking,treasury,cheques,currency}` | Present. L5 core ledger queued (T177-T185). |
| Country packs | `modules/country_packs/{ir,de,my,xx}` | `ir` live; `de` in progress (L6); `my` unstated; `xx` template; Gulf later. |
| HR / payroll | `modules/hr`, `docs/hr/` | Present. Money-math debt listed for L3. No research beyond payroll fragments. |
| CRM | `modules/crm`, `src/crm_agents`, `scripts/ops/crm/sync_to_twenty.py` | **Docs contradict on Twenty** (SYSTEM_MAP: retired; STATE: live). Verify on prod before relying on it. |
| ERP / inventory / invoicing | `modules/{inventory,invoicing,sales,report_builder,approvals,data_import}` | Present. |
| Ops / CI / backup | `scripts/ops/*`, `.github/workflows/` | Autodeploy, backups, monitors live. WAL-G built, off. CI on hosted runners until #947/#949/#1024 land. |

## 2. Keys (names only; values never in git)
Production `.env` via `scripts/ops/set_server_env.sh`; Mac `~/Secrets/roxira/roxira.env`; phone stack
`/srv/data/phone/agent/.env`; LiteLLM pool `config/key_pool.yaml`. Groups: LLM (OpenRouter, Gemini,
Groq, DeepSeek, Mistral, others), speech (AssemblyAI, Groq Whisper), payments, SMS/mail, auth, search,
backups/R2, Telegram.
Inconsistencies to fix: `CRYPTO_PAY_ENABLED` vs `PAYMENTS_CRYPTO_ENABLED`; `BRAVE_API_KEY` vs
`BRAVE_SEARCH_API_KEY`; GitHub Actions secrets referenced by workflows but absent (only
`OPENROUTER_AGENT_KEY` exists); daily LLM cap $2.00 (`models.yaml`) vs $3 (SYSTEM_MAP);
`models.yaml` `checked_at: 2026-10-17`; Python `>=3.13` vs `python:3.11-slim`.

## 3. Research index (R1-R21)

| id | topic | decision | who uses it | state |
|---|---|---|---|---|
| R1 | Product UX | 7 job hubs, citation chips, AI creates DRAFT only | L2, accounting, CRM, HR | T106 |
| R2 | Infra/security | RESTRICTIVE RLS, CI RLS audit | L3, L1 | #831; prod still superuser until T200 |
| R3 | Assistant | every number from a tool result, no tenant_id in args | Smart Judge, L4 | partly superseded by R18 |
| R4 | Country packs | per-request `CountryPackRegistry.resolve`, dual-amount ledger | L5, L6 | R8/R16 supersede parts |
| R5 | GTM/pricing | entitlements + metering | CRM | paused (product first) |
| R6 | Legal assistant | as-of retrieval, RRF, abstention gate | Smart Judge | superseded by R18 |
| R7 | Zero-hunting UX | command bar on FTS, NL report spec | L2 | unverified which rows shipped |
| R8 | Fact-check MY | MyInvois 4 modes, RM 3M exemption | L6 | date-sensitive; recheck |
| R9 | First customer | owner's MY retailer, tenant groups | CRM | paused |
| R10 | Own business | local gateways via Sdn Bhd | owner | paused |
| R11 | Growth | WhatsApp capture, partners | CRM | paused |
| R12 | Tech future-proof | voice models off retiring ids before 6 Jan 2027, Node 24 Q1 2027 | L1, L3 | **recheck before 1 Jan 2027** |
| R13 | Germany | build GoBD/DATEV/ELSTER, buy TSE + Peppol AP | L6 | T186-T191 |
| R14 | Gulf | 3-decimal currencies, clearance vs Peppol | L6, L5 | after DE |
| R15 | Factory | WIP limit, merge pass | L1 | repo assumptions stale (going private) |
| R16 | Global core | non-retrofittable primitives, 15 acceptance tests | L5 | T177-T185 |
| R17 | German structure | GmbH/UG owned by MY Sdn Bhd | owner | **digest file missing** (memory note only) |
| R18 | Smart Judge v2 | Option 2; first token 1.5 s p95, Recall@5 ≥ 0.95 | L4 | T234-T258 |
| R19 | Reuse map | hash chain on Postgres, own `money.ts` | L5, L6 | recheck dependency versions |
| R20 | Two machines | one dispatcher, private repo at $0, JIT runners | L1, L7 | claims partly unverified |
| R21 | Agent bridge | GitHub WAVE/REPORT bridge | hubs | built #1028 |

**No research exists for:** R22 (unattended `claude -p` / `agy -p` terms), CRM, ERP (purchasing,
stock, BOM, costing), HR, realtime RAG/graph updates, tenant-scoped RAG. Prompts:
`docs/research/prompts/R22_TO_R25_PROMPTS.md`.

## 4. Lane prompts: audit
All `docs/antigravity/prompts/L*.txt` last changed 2026-11-18 (WAVE 19b). Stale: inline issue queues
(many merged or superseded; R18 rows #973-#997, #1021-#1047 absent); L5-L7 say Antigravity on the
laptop but the box uses Gemini CLI/OpenCode; max-3-PR rule vs box brief (1 in progress, 2 in review);
no mention of the new push form (`LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<n> git push`) or gitleaks.
Fixed in this PR: `docs/antigravity/prompts/L1.txt`..`L7.txt` regenerated with no inline queues (they read the newest `## WAVE` on #592), agent id `antigravity-L<n>`, new push form, gitleaks hook, WIP 3 (Mac) / 2 (laptop). `LANE_PROMPTS.html` removed (stale copy); `ALL_LANES.txt` regenerated.

## 5. Open items for the hub
1. Answer the #965 ASK-HUB on phone corpus coverage (raise T257 #996 to prio 1 or keep last).
2. Fix the box bridge: `claude -p` Bash denied, so WAVEs return no data.
3. Resolve the Twenty contradiction (read-only check on prod).
4. Recreate the R17 digest from `docs/hub/memory/project-r17-germany-structure.md`.
5. Merge/triage the oldest blockers: #831, #850, #771, #868, #763, #728, #854, #955, #805.
