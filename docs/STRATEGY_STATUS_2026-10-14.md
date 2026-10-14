# Strategy Status Audit — 2026-10-14

Honest status of every plan / strategy / workstream in the repo, checked against the code and
`git log --oneline -300` (head `caedb248`, PR #634). This supersedes the "done/partial" picture in
`docs/STRATEGY_GAP_2026-10-12.md` where the two disagree; disagreements are called out in the rows.

Status vocabulary (fixed, no others used): **done** · **partial** · **not started** · **dropped**.
Anything I could not confirm from a file or PR is marked **«نیازمند بررسی»**.

## خلاصهٔ فارسی برای مالک

قاضی هوشمند از نظر «محصول» جلوتر از هر چیز دیگری است: چت استریمی، پرامپت زمین‌دار، جست‌وجوی دقیق
ماده، استناد، آپلود پرونده، پیش‌نویس محاوره‌ای و ابزارهای کیفری/ارش همه ادغام شده‌اند (#533، #540، #554،
#557، #558). بزرگ‌ترین ریسک‌ها دیگر «فیچر» نیستند؛ سه چیز است: (۱) **وضعیت واقعی سرور تولید تأییدنشده**
(درخت گیتِ درگیری، دیسک، اشاره‌گر rollback قدیمی؛ استقرار #527 هم تأیید نشده)، (۲) **نبودِ دروازهٔ دقتِ
عینی** (مجموعه‌های طلایی هنوز پیش‌نویس/TO-VERIFY هستند و بازبین وکیل نشده‌اند)، و (۳) **دوگانگیِ منبع
حقوقی** (قبلاً «فقط اختبار»، الان اختبار + نظامت + قوانین؛ همه unofficial و منتظر امضای وکیل). در کنار
این‌ها، پرتال روکسیرا عمدتاً یک پوستهٔ فروش است: ماژول‌های حسابداری/انبار/CRM/HR واقعی‌اند، ولی
«مودیان» شبیه‌سازی‌شده است، ارجاع به سامانهٔ مؤدیان واقعی نیست، پلن‌ها بک‌اند پرداخت ندارند و «کارخانهٔ
نرم‌افزار» محصولِ واقعی نیست (فقط متن بازاریابی؛ #618/#620/#625 ادعاهای نادرست را حذف کرد). جداسازی
مستأجر فقط «موج صفر» را دارد (پایهٔ tenants + CRM؛ #627) و شش ماژول مالی همچنان بدون scope هستند —
این یک ریسکِ جداسازی داده است، نه فقط شکاف بازاریابی. کارخانهٔ نرم‌افزار داخلی (rx، نردبان اختیار،
دروازهٔ ادغام، dispatcher، سرویس تحقیق) واقعی است اما **task_caps داخل rx سیم‌کشی نشده** و اجرای واقعی
Factory هنوز کامل نیست. جمع‌بندی: ۴۰٪ کارها تمام، ۴۰٪ نیمه‌کاره، ۲۰٪ شروع‌نشده؛ اولویت فوری «تطبیق
تولید» و «دروازهٔ دقت» و «امضای وکیل» است، نه فیچر جدید.

---

## 0. Scope, method, confidence

- **Read:** `docs/STRATEGY.md`, `docs/STATE.md`, `docs/SYSTEM_MAP.md`, `docs/STRATEGY_GAP_2026-10-12.md`,
  `docs/research/*` (TECH_AUDIT, ROXIRA_PORTAL_AUDIT, MODEL_AND_COMPUTE_PLAN, AGENT_FACTORY_STACK,
  AUTONOMY_AND_SAFETY, LEGAL_CORPUS_GAP_AUDIT, LEGAL_SOURCES_PLAN, LEGAL_RAG_RESEARCH, NEXTGEN_ROADMAP,
  FULL_AUTONOMY_GAP_ANALYSIS, PLATFORM_CAPABILITY_ASSESSMENT, RAAS_AAAS_PLATFORMS, AGENT_LANES_CAPACITY,
  AUTONOMOUS_APP_BUILDERS_LANDSCAPE, AGENTIC_TOOLING_RESEARCH, AUTONOMY_OPS_RESEARCH, METHOD_VALIDATION),
  `docs/infra/*`, `docs/ops/*`, `docs/legal/*`, `docs/factory/*`, `config/autonomy_ladder.json`, and
  `git log --oneline -300`.
- **Verified in code this session:** dead open-web fallback is **gone** (`smartjudge_module.py` no longer
  defines `_fetch_live_legal_web_fallback` / `_execute_parallel_legal_discovery`; a test asserts their
  absence: `output_apps/generated_modules/smartjudge/tests/test_security_stubs.py:94-95`) — this **contradicts**
  `STRATEGY_GAP` L7 which still lists them as present; `task_caps` is **not** imported in `scripts/dev/**`;
  `EnterpriseRouteGuard` is applied to accounting/hr/inventory/crm/damages/invoicing/team; tenants foundation
  migration `1789140000000-AddTenantsFoundation.ts` exists; `guides/`, `laws/`, `precedents/`, `plans/`,
  `/team` routes exist.
- **Not contacted:** production server. Every server-side "done" is code-merged but **prod-unverified**
  (STATE.md head of 2026-10-12). Rows that depend on prod say so.

---

## 1. Smart Judge product

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| Auth-derived tier/phone, no client VIP, JWT-owned conversations | done | #533; `smartjudge_module.py` `Depends(get_current_user)` | none | — | agent |
| Streaming chat (SSE meta/delta/notice/done) | done | #533 | no schema-validated final JSON frame | add later only if UI renders risk cards | agent |
| Grounded prompt, placeholder stripping, show cited sources only | done | #528; `prompt_library.py` | accuracy still not gated | fixed by §2 eval gate | hub |
| Citation guard on chat + drafts | done | #540, #605; `source_filter.py` | report label still prints old collection name (cosmetic) | fix label string | agent |
| Exact-article lookup («ماده N قانون X») | done | `legal_graph/lightrag_engine.py:989-1118` | none | — | agent |
| Conversational drafting `/draft-assist` (6 types, slot filling) | done | #557; `draft_assistant.py` | none | — | agent |
| Ruling/indictment drafts without router flag; court catalog | done | #558, #494; `court_catalog.py`, `ruling_draft.py` | no lawyer-labelled eval (§2 L2) | grow eval set | owner/lawyer |
| Auto court suggestion in chat flow | partial | #581 (`/drafts/court-suggest`) | confirm chip inside `/draft-assist` | verify UI wiring | agent |
| Draft result card: DOCX + PDF, in-place edit, versions | partial | `draft-cards.tsx` (client DOCX + print-to-PDF) | server-side RTL PDF; edit/versioning | add server PDF when drafts are paid | agent |
| Async case-file upload (PDF/photo/DOCX) with progress | done | #554, #560; `case_files.py` | chunked/resumable; real 50-page E2E not evidenced | add resumable upload + one 50-page E2E | agent |
| Vision OCR fixed (reasoning cannot be disabled) | done | #559; `config/models.yaml` vision | single vendor (Gemini 3.8 Flash); no Tesseract/Surya fallback benchmarked | benchmark local fallback | agent |
| Page-level citations for uploaded documents | partial | #580; `case_files.py:613` (`[صفحه N]`) | answers return no structured page refs | return page refs with sources | agent |
| Chat history UI (recent chats, resume, per-user) | partial | #573 (recent-chats drawer); dead `chat-sidebar.tsx` | confirm resume + guest local storage; delete dead code | verify + tidy | agent |
| Voice: time-boxed STT, recorder fixes | done | #544; `voice_stt.py` (80 s budget) | `OpenRouter whisper` 429s | see next row | agent |
| Persian STT via Groq (server-IP only) | not started | none in `voice_stt.py` | data-policy decision (voice carries case data) | owner decides, then add primary/fallback | owner |
| Live voice (Gemini Live behind flag) | partial | #518; `models.yaml` `voice_realtime` | mobile reliability; owner Whisper decision pending | run real-recording dairy | owner |
| Quality-gated escalation cheap→strong | partial | #493; `escalation_helper.py` (off unless `SMARTJUDGE_ESCALATION=1`) | enable after eval gate exists | enable per endpoint post-gate | hub |
| Data-driven jurisdiction rules | partial | `config/jurisdiction_rules.yaml`; #581 | not imported by chat/drafting on main path; 2 rules `needs_lawyer` | wire loader; lawyer clears the 2 rules | agent/lawyer |
| PII scrubber before LLM call | partial | `security/pii_scrubber.py` (no importer) | wire into LLM/case-file path; decide scope | wire for case-file text | agent |
| Triage router (JSON) + lightweight modular prompts | partial | `prompt_library.py` multi-domain | no JSON triage stage | add rule-based triage first | agent |
| Red-team (opposing counsel) simulation | not started | none | one extra LLM call/answer | defer until eval gate | hub |
| Damages calculators | done | `smartjudge_module.py` | none | — | agent |
| Personas (citizen/lawyer/clerk) | not started | none | after history + analytics | defer | hub |
| Chat latency fixes (timing, fast path) | partial | `docs/ops/CHAT_LATENCY_2026-10-09.md` | `[CHAT-TIMING]` not deployed; reasoning-low untested | deploy + re-measure | owner |

---

## 2. Legal corpus & retrieval

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| Real per-article corpus (replace placeholders) | done | `data/legal/phase1_canonical.jsonl`; #540 | none | — | agent |
| `iran_laws_v3` (v2 + 247 fill + lease 1376 + 492 ekhtebar) | done | #555, #564, #566; `scripts/legal/build_v3_on_server.sh` | serving env not re-confirmed; `proposed` allowlist unsigned | confirm env + re-run `retrieval_golden_*`; lawyer signs | owner |
| Core-law checklist (20 laws; 7 missing at 10-11) | done | #564 (تعزیرات, دیوان عدالت اداری, بیمه شخص ثالث, قاچاق) | all unofficial tier; Book 5 article gaps | lawyer tier review | owner |
| Source-policy ADR (ekhtebar-only vs lawyer R-B) | partial | `docs/decisions/ADR-2026-10-12-ekhtebar-sole-source.md`; #570 | ADR status; superseded by nezamat+qavanin; tier not shown to user | show `source_tier` in answers; reconcile ADR | hub/owner |
| Remove open-web fallback code | **done** | test asserts functions absent: `tests/test_security_stubs.py:94-95` (was L7 "missing") | none | — | agent |
| Repealed articles removed, not kept inactive | partial | `corpus_fill.py` gates; 25 repealed rows set aside | v2 still holds inactive rows + 27 way2law cheque paraphrase points | drop in next build after lawyer OK | owner |
| Hybrid retrieval (dense + lexical RRF) | done | #540; `retrieval_boost.py:141` | bge-m3 sparse vectors unused | optional later | agent |
| Cross-encoder reranker behind flag | done | #582; `SMARTJUDGE_RERANK` | never A/B'd on eval set | run A/B after eval gate | agent |
| Embedder comparison (bge-m3 vs Hakim…) | not started | none | no throw-away-collection harness | `scripts/legal/embed_ab.py` after eval gate | agent |
| Law watch P0 (ekhtebar change feed → staged + email) | done | #567; `scripts/legal/law_watch.py` | P1 article versioning; runs on Mac only | Mac launchd job / Iranian VPS | owner |
| Law watch sources nezamat (+qavanin approved) | partial | #590; `docs/legal/COVERAGE_PLAN_2026-10-13.md` | qavanin behind JS challenge, not polled | ask qavanin for API/allowlist | owner |
| Unity rulings (آرای وحدت رویه) | partial | #586; `fetch_unity_rulings.py`, `rulings_retrieval.py` (`SMARTJUDGE_RULINGS_COLLECTION` off) | collection `iran_rulings_v1` built only on server; flag off; lawyer sample check | run build script, lawyer checks 20, enable flag | owner |
| Advisory opinions as authority | dropped | lawyer R-H rule | never cite | ensure not retrieved as law | hub |
| Judiciary circulars / CBI | partial | #614, #611; `regulations_retrieval.py`, `build_regulations_collection_on_server.sh` | currency check; flag off | lawyer check + enable | owner |
| Disciplinary law (lawyers/judges), admin offences | not started | none | not fetched | fetch via ekhtebar/nezamat if present | agent |
| Cabinet decrees / ministry instructions / tax | partial | #590 + `docs/legal/OWNER_BATCH_2026-10-13.md` (staged only) | nothing ingested; 3 qavanin PDFs blank | owner re-saves PDFs; human review | owner |
| Registration law 1403 (الزام به ثبت رسمی معاملات) | partial | nezamat/qavanin staged; #606 | not verified/in v2 | verify then fetch | agent |
| R1: is «لایحه اصلاحی قانون تجارت» in force | partial | `docs/legal/LEGAL_COVERAGE_ROADMAP.md` R1 | lawyer answer open | lawyer answers R1 | owner/lawyer |
| Coverage page from real manifest | done | #608; `app/coverage` | regenerate for v3 | regenerate manifest | agent |
| Official-source acquisition (rc.majlis/rrk/dotic) | dropped | `docs/W25_phase1_acquisition.md` | superseded by ekhtebar+nezamat+qavanin | — | hub |
| End-to-end faithfulness / citation precision | partial | #579 baseline retrieval@5 85.7% | not in a required gate | wire into `eval_gate.py` (§top-10) | agent |
| Lawyer gold loop (DSPy tuning) | not started | none | needs gold set first | defer | hub |
| Graph store (LightRAG on Postgres/Qdrant) | done | `legal_graph/lightrag_engine.py` | none | — | agent |
| **Objective eval gate (50 + 20 held-out, deterministic)** | partial | #575, #579; `scripts/eval/legal_gate.py`, `data/eval/chat_golden/*` (DRAFT) | sets are draft; not in deploy smoke; not lawyer-verified | grow to 50+20, add `eval_gate.py` to `deploy_local.sh` | agent/owner |
| Lawyer-labelled ruling-draft eval | partial | #459; `data/eval/ruling_drafts/cases.jsonl` (12 synthetic) | 50–100 real cases/court | lawyer-labelled cases | owner/lawyer |
| `iran_laws_v4` (dedupe + law-only) | partial | #605, #606; `docs/legal/BUILD_V4.md` | staged, not switched; `needs_review` rows still ingested | run build script; owner switch if `V4_BETTER` | owner |
| qavanin Direct-Taxes / customs / guild PDFs | not started (blocked) | `docs/legal/QAVANIN_CROSSCHECK_2026-10-13.md` | 3 PDFs have no body text | owner re-saves from TreeText view | owner |

---

## 3. SEO / GEO

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| Competitor + GEO research, 50 high-intent queries | done | #619; `docs/gemini_out/competitor_geo_report.md` | figures are UNREVIEWED | lawyer spot-check on publish | owner |
| 10 citation-checked legal guides at `/guides` | done | #624; `frontend/src/app/guides/[slug]/page.tsx`, `docs/gemini_out/seo_guides/*` | no lawyer sign-off per guide; no "بررسی‌شده" badge | lawyer review batch 1 | owner/lawyer |
| Round-2 guides (batch 2, 11 guides) | partial | #621, #631; `docs/gemini_out/round2/*` | staged in docs, not published | publish after citation check | agent |
| Real law/article pages + sitemaps + brand JSON-LD | done | #608; `laws/[law]/[article]/page.tsx` | verify Legislation schema completeness | audit JSON-LD per template | agent |
| Sitemap index/chunks + dynamic robots | done | #615, #616, #617 (#4d9d7819) | verify Google Search Console indexing | owner submits sitemap | owner |
| Public landing page at `ghazihoushmand.ir` root | done | #623; `frontend/src/app/home-ghazi/page.tsx` | `LandingPage.tsx` from Gemini not integrated | decide template | hub |
| `llms.txt` / `llms-full.txt` for AI answer engines | not started | competitor report action 4; `public/` | no file | add `public/llms.txt` | agent |
| FAQPage / Organization / WebSite SearchAction schema | partial | brand JSON-LD #608 | verify all four schema types present | audit + fill gaps | agent |
| GEO brand capture (قاضی هوشمند profiles, E-E-A-T) | not started | competitor report §4 (P1–P3) | brand profiles, backlinks, comparison blog | execute P1 items | owner |
| Guide → `/chat` CTA + internal linking | partial | guides pages | convert visit→signup; measure | add funnel analytics first | agent |
| Public read-only laws API for SEO pages | done | #605 | none | — | agent |

---

## 4. Roxira portal & enterprise modules

Reference: `docs/research/ROXIRA_PORTAL_AUDIT_2026-10-14.md` (#618).

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| Portal readiness audit | done | #618 | none | — | hub |
| Remove unbacked claims (Moadian accepted, 7+ currencies, 24/7, TLS1.3, cheque, 1-day reply) | done | #620 | re-verify all pages | spot audit | agent |
| Remove Roxira price tiers; persist enterprise inquiries | done | #625; migration `1789130000000-CreateEnterpriseInquiriesTable.ts` | subscription/billing still absent | wire real billing or manual contract | owner |
| Accounting module (double-entry ledger) | done | `modules/accounting/*` | client gate now present (#628); tenant scoping missing | §5 wave 2 | agent |
| Inventory module (FIFO) | done | `modules/inventory/*` | tenant scoping missing | §5 wave 4 | agent |
| CRM module | done | `modules/crm/*` (tenant-scoped) | email unique composite done in migration | onsell onboarding | agent |
| HR payroll module | partial | `modules/hr/*` | statutory payroll constants not verified; tenant scoping | verify with lawyer + §5 wave 3 | owner/lawyer |
| Damages module | partial | `modules/damages/*` | index source/Art.522 formula unverified; queue tenant gap | lawyer verify + §5 wave 5 | owner/lawyer |
| Invoicing + tax signing | partial | `modules/invoicing/*`, `modules/tax_compliance/*` | Moadian submission **simulated**; no real authority call | relabel honestly; integrate official web service | owner |
| Real Moadian integration | not started | `TaxComplianceService.submitSignature` (local reference) | taxpayer credentials + official API | L effort; only before claiming filing | owner |
| `/en` B2B hub trust stats + live FX | partial | #620 fixed "7+"→4 | no real FX feed; 24/7/TLS claims softened | real rate source or present as static | agent |
| `/plans` with visible prices, one quota source | done | #572; `frontend/src/app/plans/page.tsx` (data-driven via `pricing-matrix`) | ensure payment/entitlement works | end-to-end payment test | owner |
| Customer `/guide` + onboarding | done | #552 | none | — | agent |
| `/team` + members API + org name at login | done | #629 | tenant invite roles constrained | verify ADMIN provisioning | agent |
| Autonomous "Software Foundry" product | not started | home page copy; no module in `enterprise_hub` | sandbox provisioning/isolation/metering | do not sell until built (or keep as همکاری CTA) | hub/owner |

---

## 5. Tenant isolation

Reference: `docs/infra/TENANT_ISOLATION_PLAN.md` (#626) — **DESIGN**.

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| Wave 0: `tenants` foundation + `users.tenant_id` + CRM on tenantId | done | #627; migration `1789140000000-AddTenantsFoundation.ts` | `tenantId` not yet a JWT claim (uses `sub` fallback) | add explicit JWT `tenantId` claim | agent |
| CRM reconcile (email → `(tenant_id,email)`) | done | migration `1789140000000` updates index | — | — | agent |
| Members API + `/team` + org name | done | #629 | invite role constraints to verify | — | agent |
| Client-side enterprise route guard | done | #628; `components/auth/enterprise-route-guard.tsx` (7 pages) | defense-in-depth only; server authoritative | — | agent |
| Enterprise inquiries ownership column | done | migration `1789130000000` | — | — | agent |
| Invoicing tenant scoping | not started | `modules/invoicing/*` | `tenant_id`, composite `taxInvoiceNumber` unique, repo scoping | §5 wave 2 | agent |
| Accounting + HR tenant scoping (coupled) | not started | `modules/accounting/*`, `modules/hr/*` | shared with Python finance layer (risk R2); tenant-scoped payroll journal | §5 wave 3, one PR | agent/hub |
| Inventory tenant scoping | not started | `modules/inventory/*` | warehouses/stock/FIFO | §5 wave 4 | agent |
| Damages tenant scoping + queue tenant | not started | `modules/damages/*` | job payload carries trusted `tenantId`, fail-closed | §5 wave 5 | agent |
| Tax compliance per-tenant signing keys | not started | `modules/tax_compliance/*` | `onModuleInit` global key; `deactivateAllKeys` global | §5 wave 6 | agent |
| Repository-level CI asserts (no unscoped query) | not started | — | tests that every repo method takes tenantId | add tenant-isolation specs | agent |

**Risk callout:** until waves 2–6 land, the "multi-tenant enterprise SaaS" claim is **not enforced** for
financial data. Only CRM is isolated today. Do not sell multi-tenant before this.

---

## 6. Software factory (internal agents) & AI Software Factory product

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| `rx` worker pipeline (worktree, fallback, ruff, PR) | done | `scripts/dev/rx`; `docs/PROJECT_FACTORY.md` | none | — | agent |
| Task caps + ledger wired into `rx` | **not started** | `docs/ops/TASK_CAPS.md`; grep of `scripts/dev/**` finds no `task_caps` import | `CapTracker` not called by rx | opt-in `RX_CAPS=1` log-only, then enforce | agent |
| OpenCode headless dispatcher + spend script | done | #561; `scripts/dev/dispatch_opencode.sh`, `llm_spend.sh` | none | — | agent |
| Autonomy ladder L0–L4 + merge gate + reviewer family | done | #486, #487, #508; `config/autonomy_ladder.json`, `scripts/dev/merge_check.py` | `#423` skipped-check fix status | verify in `merge_gate.py` | agent/hub |
| Local integrator (sequential rebase + local_ci) | done | #486; `docs/ops/LOCAL_INTEGRATOR.md` | hold window not enforced | — | hub |
| Actions-based Project Factory (brief→PR) | dropped (dormant) | `.github/workflows/factory-*.yml`; Actions OFF per STATE | Actions off; only brief #236 reached build | re-home trigger locally or retire (decision) | hub/owner |
| Postgres run ledger + step claimers | partial | #487; `src/factory_pipeline/run_ledger.py` (JSONL) | not Postgres/DBOS; no step claimer | DBOS spike only if Factory revived | agent |
| Preview environments with TTL | partial | `scripts/ops/preview.sh`, `preview_gate.py` | never proven end-to-end | prove once | agent |
| Golden templates | partial | #295, #339, #433; `templates/roxira-*` | verify they build | build check | agent |
| Bake-off lab (N candidate stacks) | not started | `src/factory_pipeline/bakeoff.py` skeleton | full loop | after caps + previews | hub |
| codebase-memory MCP healthy | not started (broken) | `docs/factory/FACTORY_AUDIT_2026-10-12.md` 1.1 | stale lock; fails to connect | owner runs 3-command fix | owner |
| `opencode serve` warm sessions | not started | `docs/factory/FACTORY_AUDIT_2026-10-12.md` | spike open | 1-day spike | agent |
| Archive legacy root daemons/handover files | not started | #626 `docs/ops/REPO_TIDY_PLAN_2026-10-14.md` (dry-run) | owner approval; re-check autodaemon | selective per-file move | owner |
| Tech radar / weekly registry check | partial | #574; `scripts/radar/` | weekly workflow dead (Actions off) | run locally on timer | owner |
| SearXNG + Crawl4AI + deep-research service | partial | #610, #613, #634; `services/research/*` | `EMBEDDING` unconfigured → retrieval fails; image tag to verify | set embedding provider | owner |
| Agent operating model ADR 0003 | partial | `docs/decisions/0003-agent-operating-model.md` (status proposed) | not accepted | owner marks accepted | owner |
| Server-side cheap agent runner | done (code) | #591; `docs/ops/SERVER_AGENTS.md` | one-time setup + smoke not run | run `run_task.sh --smoke` | owner |
| Free-first LLM key-pool gateway | partial | #593, #595–#599; `config/key_pool.yaml` | server provider keys missing; image tag unverified | set keys, `install.sh --apply` | owner |
| Auto-merge (agent PRs) | partial | `docs/ops/AUTO_MERGE.md`, `docs/ops/RX_AUTOMERGE.md`; #362 | `AUTO_MERGE_ENABLED` off; PAT/Pro pending | enable after ruleset + one dry PR | owner |
| Self-improvement loop (hourly probe + daily report) | done (code) | #553; `docs/ops/SELF_IMPROVEMENT.md`; `scripts/ops/selfimprove/` | install state unverified on prod | install timers | owner |
| **AI Software Factory product (W11)** | partial | #442, #441, #433–#440 (brief #236); `docs/PROJECT_FACTORY.md` | separate-repo-per-project v2 not built; live end-to-end pending | run one real brief end-to-end | owner/hub |
| First real Factory run (W11 stage) | partial | brief #236 → plan + scaffold + 8 tasks merged | never completed delivery | re-run on current main | owner |

---

## 7. Infra / ops / security

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| W1 secrets to `.env` + loopback ports | done | #2 (deployed) | none | — | owner |
| W8 server hardening | done | #14, #22 | none | — | owner |
| Local deploy + smoke + auto-rollback | done | #502, #509, #534, #547, #568; `scripts/ops/deploy_local.sh` | `sleep 20` leftovers; eval gate never blocks | clean waits | agent |
| restic 3-2-1 + DR runbook + Mac pull | done (code) | #526; `docs/ops/DISASTER_RECOVERY.md` | **not rolled out**; Storage Box unconfirmed | execute rollout steps 1–11 | owner |
| Backup email + encrypted offsite parts | done | #565; `docs/ops/BACKUP_EMAIL.md` | age-key custody check | configure + test `FORCE_OFFSITE=1` | owner |
| Restore drill executed and logged | not started | `docs/ops/RESTORE_DRILL.md` | no result record | run once, record RPO/RTO | owner |
| Second copy of legal data | not started | STATE waiting-on-owner | single copy | copy `~/Backups/roxira-legal/phase1_20261004/` | owner |
| Synthetic monitoring + log-watch + daily summary | done (code) | #531; `docs/ops/MONITORING.md` | install on prod unverified | install timers | owner |
| Infra hardening (#527: socket proxy, CF-only firewall, catch-all) | partial | #527, #546, #549, #551; `docs/infra/ROLLOUT_527.md` | **rollout not executed**; backend was unhealthy pre-fix | owner runs ROLLOUT_527 steps | owner |
| Close unauthenticated stubs + OAuth state + HttpOnly cookie | done | #571 | verify all four stubs covered | spot audit | agent/hub |
| NestJS global JWT guard, roles, throttler, swagger gate | done | #525 | prod unverified | confirm on prod | owner |
| Minimal public `/health` | done | #475 | none | — | agent |
| Cloudflare-only origin firewall script | done (code) | `scripts/ops/firewall/cloudflare_only.sh` | not applied | apply after DNS | owner |
| Production reconciliation (git conflict, disk, stale prev_commit) | partial | STATE urgent 1–4; #524, #545 | never re-verified since 10-09 | read-only ssh audit, then fix | owner |
| Iran-path Cloudflare settings + Iranian probe | not started | `docs/ops/SITE_HEALTH_2026-10-09.md` | HTTP/3, challenge level, probe | owner clicks + add probe | owner |
| New server sizing/migration plan | done (design) | #576; `docs/infra/NEW_SERVER_PLAN_2026-10-12.md` | nothing executed | decide + execute later | owner |
| VPN (Xray VLESS+REALITY) | done | #600–#602; `docs/infra/VPN_FA.md` | port 8443 conflict with x-ui | choose tunnel path | owner |
| Image pinning + slim prod image | done | #604; `docker-compose.prod.yml` digests | `:latest` for pgbouncer/searxng/twenty (TECH_AUDIT P0) | pin remaining tags+digests | agent |
| Technology audit | done | #603; `docs/research/TECH_AUDIT_2026-10-14.md` | P0 pin actions not started | execute top-3 pins | agent |
| Twenty CRM hardening | not started | `docs/ops/TWENTY_HARDENING.md` (issue #397) | owner applies runbook | apply | owner |
| Stale worktrees (~230) / stale PRs | not started | STATE known-open; `docs/ops/HOUSEKEEPING.md` | selective cleanup | owner-approved pass | owner |
| Repo tidy (archive scripts/handovers) | not started (design) | #626; `docs/ops/REPO_TIDY_PLAN_2026-10-14.md` | dry-run only | execute safe `git mv` list | owner |
| Secrets in git history / rotation | partial | `docs/HISTORY_REWRITE.md` | owner chose not to rotate; plan not executed | confirm revocation; scan public export | owner |
| SOPS + age local secrets | partial | #342; `docs/ops/SECRETS_SOPS.md` | adoption not evidenced | generate key + encrypt | owner |
| Public sanitized export | done (code) | #504; `docs/ops/PUBLIC_EXPORT.md` | publish checklist | run export when needed | owner |

---

## 8. Cost & models

| Item | Status | Evidence (file / PR) | Missing | Next concrete step | Who |
| --- | --- | --- | --- | --- | --- |
| One model registry `config/models.yaml` | done | W12; #563; `model_registry.py` | LiteLLM/opencode.json keep own ids | reconcile ids | agent |
| Cheap-first, DeepSeek V4.1 Flash default, Gemini Pro banned | done | #532; `models.yaml` | Gemini 3.8 Flash still `strong` fallback + only vision | keep under eval gate | hub |
| `:free` never sees case data | done | `llm_router.py`; `dispatch_opencode.sh --public` | none | — | agent |
| Router cost log per tenant + Redis cache | partial | `llm_router.py:182` (`LLM_ROUTER_ENABLED` default off) | not enabled in prod | enable + confirm call sites | owner |
| Weekly cost report (Persian) including product calls | partial | #561; `scripts/cost_report.py` | agent ledger only, no product router log | merge product log | agent |
| Per-key OpenRouter budgets (DEV/EVAL/GOOSE/PROD) + top-up | not started | `docs/factory/FACTORY_AUDIT_2026-10-12.md` §5 | one shared key, ~$6 balance | owner creates keys + tops up | owner |
| STT cost (OpenRouter Whisper 429s) | partial | `models.yaml` `stt` | no Groq/local path | self-host faster-whisper or Groq | owner |
| RAG-augmented bake-off | partial | `docs/ops/BAKEOFF_2026-10-04.md`, `scripts/rag_augmented_benchmark.py` | not run on eval set | run post-gate | agent |
| OmniRoute/LiteLLM health | partial | `docs/research/OMNIROUTE_EVAL.md` | broken combos/DNS | owner restarts | owner |
| Prompt caching | partial | router cache; no prefix discipline | document stable-prefix rule | add to lane docs | hub |
| Model & compute plan (roles, local models, concurrency) | done (design) | #483; `docs/research/MODEL_AND_COMPUTE_PLAN_2026-10.md` | Ollama not installed; local benchmarks unmeasured | install Ollama, measure tok/s | owner |
| $10 one-time OpenRouter top-up (50→1,000 free req/day) | not started | plan action 2 | unspent | owner decision | owner |
| Weekly model-registry drift check | dropped (dormant) | `model-registry-check.yml`; Actions off | dead workflow | run locally | owner |

---

## 9. Top 10 next actions (ranked by value / effort)

Value = unblocks many things or removes a top risk; effort S < ½ day, M 1–2 days, L several days.

1. **Reconcile production state (S, owner).** Read-only ssh: `git status`, `git stash list`, `df -h /`,
   `docker system df`, `cat /root/deploy-state/prev_commit`, timers, `docker ps`; compare to `origin/main`.
   Then fix (owner yes): restore conflicted `docker-compose.prod.yml`, `docker builder prune -f`,
   `deploy_local.sh check`, record true `prev_commit`. Every deploy/backup/rollback depends on it.
2. **Execute PR #527 rollout + confirm #523–#568 are live (S, owner).** `docs/infra/ROLLOUT_527.md`: socket
   proxy, no `docker.sock`, CF-only firewall, selfimprove/monitor/backup timers. Also closes the backend
   `unhealthy` state.
3. **Iran-path Cloudflare settings + Iranian-vantage probe (S, owner).** HTTP/3 off, Security Level Medium/Low,
   Bot Fight off; add `scripts/ops/iran_probe.py`. If Iranians can't load the site, nothing else matters.
4. **Objective accuracy gate: grow to 50 + 20 held-out, lawyer-verified, wired into deploy smoke (M,
   agent+lawyer).** `scripts/eval_gate.py` prints recall@5/MRR/citation-validity/refusal and exits non-zero
   below `config/eval_thresholds.json`. Unblocks reranker, escalation, new laws, model swaps.
5. **Lawyer review gate + ingest v4 (M, owner+lawyer).** Answer the open 10 questions
   (`docs/legal/LAWYER_REVIEW_GATE_HUB_NOTES.md`), re-save the 3 blank qavanin PDFs, then run
   `build_v4_on_server.sh` and switch if `V4_BETTER`. Removes the "unofficial/unreviewed" credibility risk.
6. **Run and log one restore drill; second copy of legal data (S–M, owner).** Backups never restored are a
   hope. Record RPO/RTO in `docs/ops/RESTORE_DRILL_LOG.md`; copy the phase1 legal backup.
7. **Tenant-scoping waves 2–3: invoicing, then accounting+HR (M–L, agent/hub; L3 owner reads).** Without this,
   do not sell multi-tenant. Copy the CRM repository pattern; add tenant-isolation specs.
8. **Publish round-2 SEO guides + `llms.txt` (S, agent).** Guides are staged (#631); add
   `public/llms.txt` and internal links. Cheap organic + GEO lift on an already-built surface.
9. **Wire `task_caps` into `rx` + create per-key OpenRouter budgets (S, agent+owner).** Log-only first, then
   enforce (25 turns / $0.50 / 1800 s / 3 strikes). Cheap insurance against runaway spend.
10. **Reranker + embedder A/B behind flags, after action 4 (M, agent).** The main remaining retrieval lever:
    `SMARTJUDGE_RERANK` vs bge-m3, and `scripts/legal/embed_ab.py` on throw-away collections.

**Next after these:** Groq/self-hosted Whisper STT decision (voice carries case data → owner policy call);
Moadian honesty relabel + real integration decision; per-tenant tax signing keys; separate-repo Factory v2;
`opencode serve` warm-session spike; codebase-memory lock fix.

---

## 10. Things I am not sure about

- The exact merged-vs-running gap on prod is **«نیازمند بررسی»** for everything deployed (STATE head was
  2026-10-12; no prod contact this session).
- Whether CRM's `sub == tenantId` semantics still hold after the tenant-foundation migration, and whether the
  JWT now carries an explicit `tenantId` claim, is **«نیازمند بررسی»** (migration exists; guard code not
  re-read in full).
- `AUTO_MERGE_ENABLED` / ruleset / GitHub Pro state is **«نیازمند بررسی»** (docs say off; dashboard not checked).
- Whether any `iran_laws_v4` / `iran_rulings_v1` / regulations collection is actually built and switched on
  prod is **«نیازمند بررسی»** (all scripts print switch commands but do not execute them).
- `restic`/DR rollout and Storage Box existence on the host are **«نیازمند بررسی»**.
- The Gemini round-2 legal figures and the QR/PII claims are UNREVIEWED and **«نیازمند بررسی»** by a lawyer.
