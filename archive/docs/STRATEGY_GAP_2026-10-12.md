# Strategy gap audit and backlog (2026-10-12)

Scope: what the owner's strategy and research say, versus what the code on `main` (5a089ace, PR #568) actually does. Method: every "done" was checked in code (file:line) or in the merged PR, not taken from a doc. Read-only; production was NOT contacted, so anything that depends on the server is marked "prod unverified". Docs read: STRATEGY, STATE, PROJECT_FACTORY, AGENTS_WORKFORCE, OWNER_MASTER_OVERVIEW_FA, LEGAL_COVERAGE_ROADMAP, LEGAL_RESEARCH_*, LAWYER_ANSWERS, docs/research/*, docs/factory/*, docs/ux/UX_AUDIT, docs/legal/*, docs/decisions/*, docs/security/SECURITY_AUDIT_2026-10-09 (untracked in the hub worktree), and the owner's architecture-vision docx (treated as data; its legal claims are UNVERIFIED).

Owner constraints applied: Persian legal AI, early stage, minimum cost; free models only for public data, DeepSeek V4.1 Flash default, never Gemini Pro; ekhtebar.ir is the ONLY legal source (Iranian-IP only, so fetch jobs run on the owner's Mac); Groq reachable only from the server IP; chat-first minimal UI; Opus strategises, cheap agents execute.

Status key: done (in code, checked), partial (some of it in code), missing (not in code), obsolete (superseded or overtaken by a later owner decision). "prod unverified" = merged but not confirmed running on the server.

## 1. Headline findings

1. The product core moved fast: auth-derived tier, streaming chat, grounded prompt, exact-article lookup, hybrid retrieval, async case-file upload, conversational drafting and the UX P0 batch are all merged. The corpus has grown from 8 laws to about 24 (v3 staged: the four ekhtebar laws close the audit's "missing" list).
2. The biggest risks are no longer features. They are (a) **unverified production state** (server git tree conflict, 96% disk, stale rollback pointer from 2026-10-09; #527 rollout status unknown), (b) **no objective accuracy gate** (golden sets are DRAFT/TO-VERIFY, 10 chat + about 30 retrieval cases, no CI step, no lawyer sign-off), and (c) **a source-policy conflict**: the lawyer's rule R-B says official sources only, the owner now says ekhtebar only (unofficial tier). Nobody has recorded that decision.
3. Dead or contradicting code exists: `_fetch_live_legal_web_fallback` and `_execute_parallel_legal_discovery` (smartjudge_module.py:2, :63) query the open web via SearXNG and are never called. They contradict the ekhtebar-only rule and the docx "tier 3 forbidden" rule. Delete them. `security/pii_scrubber.py` exists but nothing imports it.
4. STATE.md still said `iran_laws_mistral_v1` is the served collection. The code says mistral-embed vectors cannot be queried with bge-m3 (lightrag_engine.py:83-93, #540); the served collection is `iran_laws_v2`/`iran_laws_v3` (env `LIGHTRAG_QDRANT_COLLECTION`). STATE.md is corrected in this change.
5. The GitHub-Actions-based factory (factory-*.yml, agent-task, automerge, uptime) is dormant because Actions are off. The live factory is local: `rx`, `dispatch_opencode.sh`, `local_ci.sh`, autonomy ladder. Task caps are still not wired into `rx`.

## 2. Item table

Evidence is `file:line` or PR number. "Remains" is what is left to do.

### 2.1 Product: chat, answers, drafting, upload, voice

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| P1 | Auth-derived tier/phone; no client-controlled VIP; conversations owned by JWT | CHAT_QA B3/B4 | done | #533; smartjudge_module.py:1436-1500 (Depends(get_current_user)), chat-shell.tsx:646 | none |
| P2 | Streaming chat (SSE: meta, delta, notice, done) | CHAT_QA B7 | done | smartjudge_module.py:4066-4135; #533 | no structured final frame (see section 5) |
| P3 | Grounded text prompt, placeholder stripping, show only cited sources | CHAT_QA B5/B6 | done | #528; source_filter.py; prompt_library.py:136 (default ON) | accuracy still unmeasured by a gate (L1) |
| P4 | Citation guard on chat and drafts | W6 | done | smartjudge_module.py:2058, :5492; looks up served collection via `_lightrag_qdrant_retrieve` (:5472) | report label still says `iran_laws_bge_m3` (:4895); cosmetic |
| P5 | Exact-article lookup (ماده N قانون X) | Roadmap W25-1 | done | lightrag_engine.py:989-1118 | none |
| P6 | Conversational drafting `/draft-assist` (slot filling, 6 types) | UX P1-1 | done | #557; smartjudge_module.py:6515; draft_assistant.py; draft-cards.tsx | none |
| P7 | Ruling/indictment drafts without LLM_ROUTER flag; 14-court catalog | #558, #494 | done | court_catalog.py; ruling_draft.py | ruling drafts still advisory only; no lawyer-labelled eval (L2) |
| P8 | Auto court suggestion inside the chat flow | UX P1-2 | partial | `/drafts/court-suggest` at :6164 exists | confirm chip in `/draft-assist` flow unverified |
| P9 | Draft result card: DOCX + PDF, in-place edit, versions | UX P1-3, docx s3 | partial | draft-cards.tsx:234 client-built DOCX, :280 print-to-PDF | server-side RTL PDF (WeasyPrint/Typst) missing; no edit/versioning |
| P10 | Async case-file upload (PDF/photo/DOCX) with progress | UPLOAD_PIPELINE | done | #554, #560; smartjudge_module.py:2790, :2836 | chunked/resumable upload; real 50-page E2E not evidenced |
| P11 | Vision OCR fixed (reasoning cannot be disabled) | #559 | done | models.yaml:190-199 | single vision vendor (Gemini 3.8 Flash); Tesseract `fas` / Surya fallback not benchmarked |
| P12 | Page-level citations for uploaded documents | docx | partial | case_files.py:613 tags `[صفحه N]` in text | answers return no structured page refs |
| P13 | Chat history UI (recent chats, resume, per-user) | UX P1-4 | partial | backend :1436-1500; client smart-judge-client.ts:418-461; chat-sidebar.tsx is dead code | wire a recent-chats list into the account sheet |
| P14 | Voice: time-boxed STT, recorder fixes | #544, VOICE_DIAGNOSIS | done | voice_stt.py (80 s budget) | Persian STT quality; `OpenRouter whisper` 429s |
| P15 | Persian STT from the server via Groq (reachable only from server IP) | owner constraint | missing | no Groq path in voice_stt.py | decide data policy (voice carries case data), then add as primary or fallback |
| P16 | Live voice (Gemini Live behind a flag) | W20 | partial | models.yaml `voice_realtime` | reliability on mobile; owner has a real-recording Whisper decision pending |
| P17 | Quality-gated escalation cheap to strong | #493 | partial | escalation_helper.py:15 (off unless `SMARTJUDGE_ESCALATION=1`) | enable after the eval gate exists |
| P18 | Data-driven jurisdiction rules (peace court limit etc.) | Roadmap R4, lawyer R-G | partial | config/jurisdiction_rules.yaml; jurisdiction_rules.py | not imported by smartjudge_module.py or draft_assistant.py; 2 rules `needs_lawyer` |
| P19 | PII scrubber before any LLM call | docx s7 | partial | security/pii_scrubber.py (no importer) | wire into the LLM call path; decide scope |
| P20 | Triage router (JSON) + lightweight modular prompts | docx s5 | partial | prompt_library.py (multi-domain, competence boost) | no JSON triage stage; see section 5 |
| P21 | Red-team (opposing counsel) simulation | docx s6 | missing | none | defer (section 5) |
| P22 | Damages calculators | STRATEGY s1 | done | smartjudge_module.py:2989, :3158 | none |
| P23 | Personas (citizen / lawyer / clerk) | UX P2-1 | missing | none | after history and analytics |

### 2.2 Legal corpus and accuracy

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| L1 | Objective eval gate: 50 Persian questions, deterministic checks (gold-article recall, citation validity, refusal) | STATE next step 4, BEST_PRACTICE s5 | partial | data/eval/chat_golden: 10 chat + 11/11/8 retrieval cases, all DRAFT; selfimprove hourly/daily (#553) | grow to 50 + 20 held-out, lawyer-verified; add to `deploy_local.sh` smoke; Promptfoo not present (not required) |
| L2 | Lawyer-labelled ruling-draft eval | PLATFORM_CAPABILITY s3 | partial | data/eval/ruling_drafts/cases.jsonl (12 synthetic) | 50-100 real cases per court type |
| L3 | Real per-article corpus replacing placeholders | W6 | done | phase1_canonical.jsonl 1444 articles; v2 5083 points | none |
| L4 | `iran_laws_v3` (v2 + 247 fill rows + 1376 lease replace + 492 ekhtebar rows) | #555, #564, #566 | done | scripts/legal/build_v3_on_server.sh; owner reports serving | confirm env + run `retrieval_golden_*` on v3 and record; lawyer signs `proposed` allowlist entries |
| L5 | Core-law checklist (20 laws; 7 missing at 10-11) | CORPUS_AUDIT | done | 4 ekhtebar laws (تعزیرات, دیوان عدالت اداری, بیمه شخص ثالث, قاچاق) staged in #564 | still unofficial tier; Book 5 article gaps to check |
| L6 | Source policy decision: ekhtebar-only (unofficial) vs lawyer R-B (official only) | LAWYER_ANSWERS R-B, owner 2026-10-12 | partial | allowlist `proposed`; `source_tier` in scripts/legal/*.py only | write the ADR; show tier to the user in answers; lawyer acknowledgement |
| L7 | Remove open-web fallback code | ekhtebar-only rule | missing | smartjudge_module.py:2-60, :63-100 (dead, never called) | delete both functions |
| L8 | Repealed articles removed, not kept inactive | R-A | partial | corpus_fill.py gates; 25 repealed rows set aside | v2 still holds 18 inactive rows and 27 way2law paraphrase points (cheque law); drop in next build after lawyer OK |
| L9 | Hybrid retrieval (dense + lexical, RRF) | LEGAL_RAG_RESEARCH | done | retrieval_boost.py:141; lightrag_engine.py:479; #540 | bge-m3 sparse vectors not used |
| L10 | Cross-encoder reranker (bge-reranker-v2-m3) behind a flag | TOOLS_ADOPTION | missing | only in src/automation (radar) | implement + A/B on L1 |
| L11 | Embedder comparison (bge-m3 vs Hakim vs others) | BEST_PRACTICE 5c | missing | none | run into throw-away collections after L1 |
| L12 | Law watch P0 (ekhtebar change feed to staged JSONL + email) | LAW_WATCH_DESIGN | done | #567; scripts/legal/law_watch.py | P1/P2: article versions (VALID/AMENDED/REPEALED), diff to proposed actions; runs on the Mac only |
| L13 | Unity rulings (آرای وحدت رویه) in corpus | lawyer R-I, Roadmap Phase 4, docx | missing | watch category 247 tracked; prod `judicial_precedents` is tiny | separate collection, number+date+subject schema, lawyer sample check |
| L14 | Advisory opinions as authority | lawyer R-H | obsolete | rule says non-authoritative | never cite; ensure `legal_advisory_opinions` collection is not retrieved as law |
| L15 | Judiciary circulars | Roadmap Phase 4 | partial | prod `judiciary_circulars` (250 rows per 10-03) | use unknown; no currency check |
| L16 | Disciplinary law (lawyers, judges), admin-offence law | Roadmap Phase 2 | missing | none | fetch via ekhtebar if present |
| L17 | Cabinet decrees, ministry instructions, tax laws | Roadmap Phase 3 | missing | law watch categorises only | after L12 P1 |
| L18 | Laws named in the docx (الزام به ثبت رسمی معاملات اموال غیرمنقول 1403) | docx s4 | missing | not in v2 inventory | verify on ekhtebar, then fetch |
| L19 | R1: is «لایحه اصلاحی قانون تجارت» in force | LEGAL_COVERAGE R1 | partial | 281 rows served | lawyer answer still open |
| L20 | Coverage page generated from the real manifest | UX P0-7, R3 | partial | app/coverage; data/legal/coverage_manifest.json | regenerate for v3 |
| L21 | Official-source acquisition (rc.majlis, rrk, dotic) | W25 | obsolete | W25 doc, 0 laws fetched | superseded by ekhtebar-only |
| L22 | End-to-end faithfulness / citation-precision measure | docx s7 | partial | citation guard is mechanical; baseline 63.3% (09-24) | measure on L1 each deploy |
| L23 | Lawyer gold-standard loop (DSPy tuning) | docx s7 | missing | none | defer until L1 exists |
| L24 | Graph store (LightRAG on Postgres/Qdrant) | docx s2 | done | legal_graph/lightrag_engine.py | Neo4j/Memgraph: skip |

### 2.3 Security

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| S1 | Master OTP backdoor and duplicate OTP handlers removed | AUDIT #1/#11 | done | #523 | none |
| S2 | OTP per-phone/IP limits, resend cooldown | AUDIT #2 | done | smartjudge_module.py:5800-5860 | none |
| S3 | NestJS global JWT guard, roles, throttler, swagger gate | AUDIT #4/#7 | done | #525 | prod unverified |
| S4 | Docker socket proxy, backend non-root and read-only | AUDIT #5 | partial | #527 compose changes | prod rollout unverified (docs/infra/ROLLOUT_527.md) |
| S5 | Cloudflare-only origin firewall | AUDIT #6 | partial | scripts/ops/firewall/cloudflare_only.sh | owner must apply; unverified |
| S6 | HSTS 6 months, nginx catch-all 444, auth zones | AUDIT #8 | done | #527 | CSP still report-only (security_headers.conf:13) |
| S7 | OAuth `state` required; HttpOnly session cookie; no JWT in localStorage | AUDIT #9/#10 | missing | unifiedauth_module.py:659-670 (state optional), :701 `httponly=False` | fix or remove Google login (SITE_HEALTH says the app does not use it) |
| S8 | Tenant/owner column on all non-CRM tables | AGENTS s4, AUDIT #12 | missing | only crm entities have tenant | L3 migrations via reviewed PR |
| S9 | Unauthenticated stub endpoints | AUDIT #14 | missing | smartjudge_module.py:5906 `/crm/sync-case`, :2907 `/legal-graph/ingest`, :2638 `/telephony-session`, :5944 `/admin/export-dataset` | require auth or delete |
| S10 | `:free` model lists in non-live code | AUDIT #15 | partial | live_legal_engine.py, ai_router.py (per audit) | delete or guard |
| S11 | Secrets: keys in git history | STRATEGY s6 | partial | OWNER_MASTER says revoked; HISTORY_REWRITE.md plan not executed | confirm revocation of every key; scan public export |
| S12 | SOPS+age for local secrets | SECRETS_AND_SAFE_DEPLOY | partial | docs/ops/SECRETS_SOPS.md | adoption not evidenced |
| S13 | Provider-key scan and gitleaks in local CI | memory | done | local_ci.sh step_provider_keys | none |
| S14 | x-ui panel (2053/2096) and 8443 exposure | AUDIT #16 | missing | UFW only | owner decision |
| S15 | Prompt-injection handling for uploaded docs | PLATFORM s3 | partial | case_files.py:1102 nonce-delimited user document | red-team test set |

### 2.4 Ops, backup, monitoring

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| O1 | Local deploy with smoke test and auto-rollback | #502, #509, #534, #547, #568 | done | scripts/ops/deploy_local.sh (`wait_ready` :129) | `sleep 20` still at :321 |
| O2 | Production reconciliation: server git conflict, 96% disk, stale `prev_commit` | STATE 10-09 | partial | #524 slim image, #545, housekeeping.sh | re-verify read-only, then fix with owner approval; prod unverified |
| O3 | restic 3-2-1 backups, DR runbook, Mac pull | #526 | done | deploy/systemd/roxira-backup*.timer; docs/ops/DISASTER_RECOVERY.md | install state unverified |
| O4 | Backup email report plus encrypted offsite parts | #565 | done | docs/ops/BACKUP_EMAIL.md | needs age key custody check |
| O5 | Restore drill actually executed and logged | RESTORE_DRILL.md | missing | runbook only; no result record | run once, record RPO/RTO |
| O6 | Second copy of `~/Backups/roxira-legal/phase1_20261004/` | STATE | missing | owner action | owner |
| O7 | Synthetic monitoring, log-watch, daily summary | #531 | done | scripts/ops/monitor; deploy/systemd/roxira-monitor-*.timer | prod unverified |
| O8 | Self-improvement loop (hourly retrieval probe, daily report) | #553 | done | scripts/ops/selfimprove | prod unverified |
| O9 | Iran-path reachability: Cloudflare HTTP/3 off, challenge level, probes from Iranian nodes | SITE_HEALTH | missing | dashboard-only settings | owner clicks; add Iranian-vantage probe |
| O10 | Decision D1: users inside Iran vs abroad; domestic mirror | HOME_SERVER_VOIP s0, BEST_PRACTICE s7 | missing | none | owner decision first |
| O11 | Images pinned; slim prod image | #524, #527 | done | docker-compose.prod.yml digests | none |
| O12 | Self-host fonts and scripts | BEST_PRACTICE s7 | partial | app/fonts | public/factory/index.html:8 still loads Google Fonts |
| O13 | Twenty CRM hardening | TWENTY_HARDENING | missing | owner step | owner (low priority) |
| O14 | Stale worktrees (~230) and stale PRs | STATE | missing | cleanup rules in AGENTS s6 | selective per-branch cleanup, owner approval |
| O15 | GitHub Actions uptime/e2e/deploy workflows | W14, W16 | obsolete | Actions off | replaced by monitor timers and `local_ci` |
| O16 | Reachability matrix | NEXTGEN | partial | scripts/ops/reachability_matrix.py | run it on a schedule |

### 2.5 Cost and model routing

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| C1 | One model registry (`config/models.yaml`) read by router, scripts and rx | STRATEGY W12 | done | model_registry.py; #563 (`model_for.py`) | LiteLLM and opencode.json keep their own ids |
| C2 | Cheap-first, DeepSeek V4.1 Flash default, Gemini Pro banned | owner, #532 | done | models.yaml `cheap`, `reviewer` | Gemini 3.8 Flash is still `strong` fallback and the only `vision` model |
| C3 | `:free` never sees case data | AGENTS s4 | done | llm_router.py (enforced for `free`); dispatch_opencode.sh refuses without `--public` | none |
| C4 | Router cost log per tenant, Redis cache | STRATEGY W5/W13 | partial | llm_router.py:182 (`LLM_ROUTER_ENABLED` default off) | enable in prod; confirm which call sites use it |
| C5 | Weekly cost report (Persian) including product calls | W13 | partial | scripts/cost_report.py (agent ledger) | add product router log |
| C6 | Per-key OpenRouter budgets (DEV/EVAL/GOOSE/PROD) and top-up | FACTORY_AUDIT s5 | missing | balance about 6.19 USD, one shared key | owner dashboard clicks |
| C7 | STT cost: OpenRouter whisper rate-limited | W15 | partial | models.yaml `stt` | see P15 |
| C8 | RAG-augmented bake-off (0.23 was without RAG) | BAKEOFF_2026-10-04 | partial | scripts/rag_augmented_benchmark.py | run on L1 set |
| C9 | OmniRoute/LiteLLM health (broken combos, DNS) | FACTORY_AUDIT | partial | audit only | owner restarts containers |
| C10 | Prompt caching | STRATEGY s3b | partial | router cache; no prefix discipline in builder lane | document stable-prefix rule |

### 2.6 Software factory

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| F1 | `rx` worker pipeline: worktree, fallback chain, ruff gate, PR | PROJECT_FACTORY | done | scripts/dev/rx | none |
| F2 | Task caps and ledger wired into rx | W13, BEST_PRACTICE s6 | missing | docs/ops/TASK_CAPS.md ("nothing is wired into rx yet") | wire `CapTracker` |
| F3 | OpenCode headless dispatcher and spend script | #561 | done | scripts/dev/dispatch_opencode.sh, llm_spend.sh | none |
| F4 | Autonomy ladder L0-L4, merge gate, reviewer-family check | AGENTS | done | config/autonomy_ladder.json; scripts/dev/merge_check.py; check_reviewer_family.py | none |
| F5 | Actions-based Project Factory (brief to PRs) | W11 | obsolete | factory-*.yml, Actions off; only brief #236 reached build | re-home to local trigger or retire |
| F6 | Postgres run ledger and step claimers | NEXTGEN wave 1 | partial | src/factory_pipeline/run_ledger.py:92 (JSONL files) | Postgres/DBOS spike only if Factory is revived |
| F7 | Preview environments with TTL | FULL_AUTONOMY | partial | scripts/ops/preview.sh; preview_gate.py | never proven end to end |
| F8 | Golden templates | NEXTGEN wave 2 | partial | templates/roxira-fullstack, roxira-static-rtl | verify they build |
| F9 | Bake-off lab (N candidate stacks per brief) | OWNER vision | missing | src/factory_pipeline/bakeoff.py is a skeleton | after F2, F7 |
| F10 | codebase-memory MCP healthy | FACTORY_AUDIT 1.1 | missing | stale lock; failed to connect again in this session | owner runs the 3-command fix |
| F11 | `opencode serve` warm sessions | STATE | missing | none | spike |
| F12 | Archive legacy root daemons and handover files | FACTORY_AUDIT 7 | missing | autonomous_*.py, factory_engine.py, TECH_RADAR_* in repo root | owner approval, selective move |
| F13 | Tech radar / weekly registry check | W9, W12 | partial | scripts/radar; check_models.py | weekly workflow dead (Actions); run locally |
| F14 | SearXNG + Crawl4AI for research | TOOLS_ADOPTION | partial | scripts/legal/corpus_crawl4ai.py; SearXNG container referenced | not used by product (and must not be, see L7) |
| F15 | Agent operating model and ladder | ADR 0003 | partial | docs/decisions/0003 status "proposed" | owner to mark accepted |

### 2.7 Sales, payments, growth

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| G1 | Real Zibal payment, idempotent verify, server-side pricing | W17 | done | router_payment.py; smartjudge_module.py:2535, :2602 | `PAYMENTS_LIVE` in prod unverified; pending DB fixes (order 4815502353, SINGLE_DRAFT #101) |
| G2 | Visible prices and one quota source (`/plans`) | UX P1-5 | missing | no app/plans; /services hides prices | build |
| G3 | Crypto payments | W17 | obsolete | returns 503 behind flag | leave off |
| G4 | Lawyer program with verification | UX P2-2 | missing | smartjudge_module.py:3344 self-declared licence grants VIP | verification queue or remove |
| G5 | Funnel analytics (no content) | UX P2-6 | missing | none | build; needed to judge every UX change |
| G6 | Public coverage page as trust asset | R3 | done | app/coverage | see L20 |
| G7 | SEO law pages (`/laws`, `/precedents`) | UX P2-8 | partial | pages exist | natural sort, search, true totals |
| G8 | Support channels (WhatsApp/Bale/Telegram/Eitaa) | UX P2-5 | missing | none | after analytics |
| G9 | Roxira OS (CRM/accounting) as revenue | OWNER_MASTER | partial | skeletons; CRM tables empty | defer; Smart Judge first (STRATEGY s1) |
| G10 | Brand bleed and public `/admin` links removed | UX P0-8/9 | done | middleware.ts:126 matcher extended; no public mission-control links | roxira.ir mobile menu unverified |

### 2.8 UX (UX_AUDIT_2026-10-11)

| # | Item | Source | Status | Evidence | Remains |
|---|---|---|---|---|---|
| U1 | P0 batch (composer, dock, menu, naming, draft chips, VIP gate, honest copy, contact, placeholders) | UX s6 P0 | done | #556; chat-shell.tsx textarea :222, `isComposing`; vip-gate.tsx; no "hallucination"/"5,184" strings; hard-coded token line gone | P0-12 text-size/contrast not individually verified |
| U2 | Lazy-load voice/subscription modals, skip link | P1-10/11 | done | #562 | `role="log"`/aria-live on message list not found |
| U3 | `/help` merging `/guide` | P1-6 | missing | only app/guide | build |
| U4 | One design system on ghazi (about/privacy/terms/modals) | P1-7 | partial | unverified | audit |
| U5 | Privacy/terms wording vs real data flow | P1-8 | missing | needs owner + lawyer | rewrite |
| U6 | Per-answer provenance chips | P1-9 | partial | source_filter.select_displayed; chat-shell statutory_basis | explicit "no source" state |
| U7 | Dead code deletion (`/judge` workbench, chat-sidebar, judge/*, default SVGs, public JSON leaks) | P1-12 | missing | components/judge/* still present; public/tech_radar_report.json, next.svg | delete |
| U8 | PWA/installable, low-bandwidth mode | P2-4 | missing | no manifest | after analytics |
| U9 | Design token consolidation, visual regression | P2-7 | missing | none | defer |

## 3. Counts (122 items)

| Group | done | partial | missing | obsolete | total |
|---|---|---|---|---|---|
| Product | 11 | 9 | 3 | 0 | 23 |
| Legal corpus and accuracy | 6 | 8 | 8 | 2 | 24 |
| Security | 5 | 6 | 4 | 0 | 15 |
| Ops, backup, monitoring | 6 | 3 | 6 | 1 | 16 |
| Cost and model routing | 3 | 6 | 1 | 0 | 10 |
| Software factory | 3 | 6 | 5 | 1 | 15 |
| Sales, payments, growth | 3 | 2 | 4 | 1 | 10 |
| UX | 2 | 2 | 5 | 0 | 9 |
| **Total** | **39** | **42** | **36** | **5** | **122** |

## 4. Top 12 next actions (impact / effort)

Effort: S under half a day, M one to two days, L several days. "Parallel" means it can run alongside the others with no shared files. Owner-action items need the owner (server writes, dashboards, lawyer).

**1. Reconcile production state (S, parallel, owner action).** Impact: every deploy, rollback and backup depends on it. Spec: read-only first. Over ssh run `git status --short`, `git stash list`, `df -h /`, `docker system df`, `cat /root/deploy-state/prev_commit`, `systemctl list-timers 'roxira-*'`, `docker ps`, and compare running commit to `origin/main`. Report differences against STATE items 1-4 of 2026-10-09 and docs/infra/ROLLOUT_527.md. Then, with owner yes, fix in this order: restore the conflicted `docker-compose.prod.yml` from HEAD, `docker builder prune -f`, run `deploy_local.sh check`, record the true `prev_commit`. Never prune volumes. Confirm which of #523-#568 are actually running (docker socket proxy, CF firewall, selfimprove and monitor timers, backup timers). Output: a verified "LIVE" block for STATE.md.

**2. Iran-path fixes in Cloudflare plus an Iranian-vantage probe (S, parallel, owner action).** Impact: if Iranian users cannot load the site, nothing else matters. Spec: the owner turns HTTP/3 off, sets Security Level to Medium or Low, disables Bot Fight Mode and Browser Integrity Check for the three zones, and checks Security Events filtered to country IR (SITE_HEALTH hypotheses 1-2). An implementer adds `scripts/ops/iran_probe.py` that calls the check-host.net HTTP API with Iran nodes for the three domains and `/api/v1/apps/judge/health`, writes pass/fail into the existing monitor alert path, and runs from the Mac or the server. No bypass attempts, no secrets.

**3. Record the legal-source policy and surface it to users; delete the open-web fallback (S, parallel, owner plus lawyer).** Impact: legal credibility and a policy contradiction in code. Spec: write `docs/decisions/0004-legal-sources-ekhtebar-only.md` stating ekhtebar.ir is the only source, that served text is `unofficial` tier, the lawyer's R-B conflict, and the mitigations (disclaimer, tier shown, lawyer review list). Delete `_fetch_live_legal_web_fallback`, `_execute_parallel_legal_discovery` and the unused `_fetch_searxng` branch from smartjudge_module.py (confirm no caller with rg first). Add a one-line "source: ekhtebar.ir (unofficial)" to the sources block in `source_filter.select_displayed` output and the coverage page. Owner and lawyer acknowledge the ADR; ADR status stays "proposed" until they do.

**4. Objective accuracy gate: 50 plus 20 held-out questions (M, parallel, needs lawyer for gold).** Impact: lets every later change (reranker, escalation, new laws, model swap) be judged. Spec: extend `data/eval/chat_golden/` to 50 questions across civil, criminal, family, lease, cheque, labour, execution, with gold article ids (law_any and articles) and refusal cases; keep a separate 20-question held-out file never used for prompt tuning. Add `scripts/eval_gate.py` (offline-safe; retrieval-only on the server via docker exec, as `selfimprove/hourly.py` does) that prints recall@5, MRR, citation validity (every cited article exists and is active), refusal rate, and exits non-zero below thresholds stored in `config/eval_thresholds.json`. Call it from `deploy_local.sh` after the smoke test (L4 path, owner merges). Mark every case `verify: TO-VERIFY` until the lawyer signs. No LLM judge; no case data in prompts.

**5. Run and record one restore drill; second copy of legal data (S-M, parallel, owner action).** Impact: backups that were never restored are a hope, not a control. Spec: follow docs/ops/RESTORE_DRILL.md on the Mac with throwaway containers, restore the latest Postgres dump and Qdrant snapshot, run the row-count and one vector query checks on `iran_laws_v2` and `iran_laws_v3`, and write the result (date, backup id, durations, row counts, pass/fail) into `docs/ops/RESTORE_DRILL_LOG.md`. Owner also copies `~/Backups/roxira-legal/phase1_20261004/` to a second location and confirms where the age private key lives. Never touch production.

**6. Close the unauthenticated stub endpoints and OAuth/cookie gaps (M, parallel, L3: owner reads).** Impact: integrity and takeover risk. Spec: in smartjudge_module.py require `Depends(get_current_user)` plus an admin role on `/legal-graph/ingest`, `/admin/export-dataset` (replace the `admin_key` query param), `/telephony-session`; delete `/crm/sync-case` or put it behind auth with tenant from the token. In unifiedauth_module.py reject a missing or unknown OAuth `state` and set the session cookie `httponly=True, secure=True, samesite=lax`; if Google login is unused (SITE_HEALTH), remove the route instead. Add unit tests that call each route without a token (no pytest over `src/`; put tests under a collected path as CI does). Do not touch migrations.

**7. Revive chat history in the UI (M, parallel, frontend only).** Impact: retention; backend is done. Spec: use `smart-judge-client.ts:418-461` (`GET /conversations`, `GET /conversations/{id}/messages`, `POST /conversations`). In the account sheet add a "recent chats" list (30 items), open one to resume, create a conversation on first message for logged-in users, keep guests on local storage. Warn before leaving an unsaved draft. Reuse the dead `chat-sidebar.tsx` only for markup. No new endpoints, no change to auth.

**8. `/plans` with visible prices and one quota source (M, parallel, no owner action beyond price confirmation).** Impact: revenue conversion; prices (100,000 toman single draft, 490,000 toman VIP monthly) are currently hidden behind a modal. Spec: new `app/plans/page.tsx` rendering `GET /pricing/plans` and `/pricing/matrix` server-side (ISR), one comparison table, no emoji, CTA opens the existing subscription modal; redirect `/services` to `/plans`; remove contradictions about live-voice quota; keep disclaimers. Reuse `ap-*` tokens.

**9. Privacy-preserving funnel analytics (S-M, parallel).** Impact: cannot judge UX or growth without it. Spec: add `POST /api/v1/apps/judge/events` accepting only an allowlist of event names (first_message, login_started, login_done, draft_started, draft_done, lock_card_seen, checkout_started, paid) and a random session id; no text, no phone, no IP stored; rate-limited; table `analytics_events(id, ts, session_id, event, plan)` created like `payment_orders` (idempotent DDL, owner reads as it is a schema change); a small `scripts/ops/funnel_report.py` prints daily counts into the existing daily email.

**10. Unity rulings (آرای وحدت رویه) as a separate collection (M-L, parallel, lawyer sample check).** Impact: highest-value secondary source per the lawyer (R-I). Spec: using the law-watch category 247 feed (ekhtebar only), add `scripts/legal/fetch_unity_rulings.py` producing JSONL with `ruling_no`, `date`, `court`, `subject`, `text`, `source_url`, `source_tier: unofficial`, `status`; stage under `data/legal/staged/`; ingest through `ingest_pipeline.py` into a NEW collection `iran_unity_rulings_v1` with a flag `SMARTJUDGE_UNITY_RULINGS=1` for retrieval; the citation guard learns `رأی وحدت رویه شماره N`. Treat docx numbers 865, 866, 881, 882 as leads to verify, not facts. Lawyer checks a 20-ruling sample before the flag is turned on.

**11. Reranker and embedder A/B behind flags (M, depends on 4).** Impact: the main lever left for retrieval quality. Spec: add `rerank_candidates()` using `BAAI/bge-reranker-v2-m3` (CPU, top 20 to top 5) behind `SMARTJUDGE_RERANK=1`, cached per query; add `scripts/legal/embed_ab.py` that builds throw-away collections for bge-m3 and one challenger (Hakim if licence allows) from the v3 JSONL and prints recall@5/MRR on the eval set, with and without the reranker. Report only; no production re-index.

**12. Factory hygiene (S-M, parallel, partly owner clicks).** Impact: cost safety for all cheap-agent work. Spec: wire `CapTracker` from `src/factory_pipeline/task_caps.py` into `scripts/dev/rx` (25 turns, 0.50 USD, 1800 s, 3 identical errors; park the task and log to the ledger); drop `codex` from the default chain; owner creates the DEV/EVAL/GOOSE/PROD OpenRouter keys with daily limits and tops up the balance; owner runs the codebase-memory lock fix from FACTORY_AUDIT 1.1; archive legacy root daemons only after owner approval (selective, per file, no bulk delete).

### Next after the top 12 (not ranked)

Delete dead frontend code and public leaks (U7); server-side RTL PDF export (P9); page-level citations for uploads (P12); `/help` page (U3); wire jurisdiction rules into drafting (P18) after the lawyer clears the two `needs_lawyer` rows; Groq STT decision (P15); law watch P1 article versioning (L12); lawyer-program verification (G4); tenant columns (S8); disciplinary and tax laws (L16, L17); sync the OpenRouter/LiteLLM/OmniRoute fixes (C9).

## 5. Owner's architecture-vision docx: adopt / defer / skip

The docx proposes a "Themis Pro v4" architecture. Its legal facts (unity rulings 881/882/865/866, the 1403 registration law, the peace-court limit) come from web sources and are UNVERIFIED here; the peace-court limit (1,000,000,000 rial) does match `config/jurisdiction_rules.yaml`. Its source tiers list rrk.ir/dotic/qavanin as tier 1; that conflicts with the owner's ekhtebar-only rule, so the tiering is not adopted as written.

| Docx idea | Decision | Reason |
|---|---|---|
| PostgreSQL + pgvector for chunks | skip | Qdrant already serves 5k+ points with bge-m3; moving adds migration risk and no measured gain. Revisit only if Qdrant RAM becomes the constraint |
| Neo4j/Memgraph graph database | skip | LightRAG graph already runs on Postgres/Qdrant; extra service on a 15 GB host |
| LightRAG dual-level retrieval | adopt (already) | in code (legal_graph/lightrag_engine.py) |
| Hybrid lexical + dense with RRF | adopt (already) | retrieval_boost.py:141 |
| Reranker | adopt | cheap, flag-gated; action 11 |
| Dual-stream SSE (structured events, then markdown tokens, then a JSON object) | defer | today's SSE already streams (`meta`, `delta`, `done`). A final schema-validated JSON frame (success range, checklist, parties) is useful only when the UI renders risk and timeline cards; build after funnel analytics show people use drafting. Keep markdown as the answer |
| Structured outputs / JSON schema for case metadata | adopt (narrow) | already used in `/draft-assist`; extend only where the UI consumes it |
| Page-level citations from uploaded documents | adopt (small) | OCR already tags `[صفحه N]` (case_files.py:613); return page refs with sources. S-M, after top 12 |
| Multi-agent state machine (triage, validity, red team, formality) | defer | cost and latency on a minimum-cost product; first measure single-pass quality with the eval gate. Cheap pieces worth taking now: a rule-based triage that fills `competent_forum` using `jurisdiction_rules.yaml`, and the existing mechanical citation validity check. LangGraph supervisor code exists (agentic_core/langgraph_supervisor.py) but is not on the main path |
| Red-team (opposing counsel) agent | defer | one extra LLM call per answer; add as an optional "stress-test my case" button after the eval gate |
| Modular lightweight prompts (triage under 350 tokens + core under 550) | adopt (incremental) | prompt_library.py is already modular; measure tokens per turn before rewriting |
| English digits only in output | adopt (already) | chat_safety.to_latin_digits |
| Source tiers: tier 3 (open web, AI overviews) forbidden | adopt | and enforce by deleting the dead SearXNG fallback (action 3) |
| Tier 1 = rrk.ir/dotic/qavanin | skip | owner rule: ekhtebar.ir only; unreachable anyway |
| WeasyPrint / Typst for RTL PDF, python-docx for DOCX | defer | client DOCX and print-to-PDF exist; server PDF needs Pango in the image (Dockerfile.prod is L4). Pick WeasyPrint when drafts become a paid feature people print |
| Legal Faithfulness / Citation Precision / Subsumption metrics | adopt (first two) | citation precision and faithfulness map to the deterministic checks in action 4; subsumption needs lawyer labels, defer |
| DSPy/GEPA prompt optimisation with lawyer gold set | defer | needs the gold set first; one prompt only, later |
| Lawyer steering committee reviewing samples | adopt | the lawyer already answers questions; formalise a weekly 20-answer review once the eval exists |
| Anonymisation before sending to models | adopt | `security/pii_scrubber.py` exists unused; wire it for case-file text (P19) |
| Daily crawl of Official Gazette and Supreme Court portal | skip (replace) | replaced by the ekhtebar law watch (#567) |
| Competitive analysis of Harvey/CoCounsel/Lexis | skip | context only |
