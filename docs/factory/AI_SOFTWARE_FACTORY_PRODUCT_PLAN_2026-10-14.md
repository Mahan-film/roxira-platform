# کارخانه نرم‌افزار هوش مصنوعی روکسیرا — برنامه محصول (2026-10-14)

Status: **PLAN / NO CODE CHANGES**. Owner decides pricing (not in this document).
Scope: turning the internal agent factory into a sellable product where a
customer describes a business app and agents build + host it.

---

## ۰. خلاصهٔ فارسی برای مالک

- هدف محصول: مشتری کسب‌وکارش را توصیف می‌کند؛ ایجنت‌ها یک اپ CRUD (فرم‌ها + گزارش‌ها) می‌سازند و روی زیردامنهٔ خودش هاست می‌شود. اسم پیشنهادی: «کارخانه نرم‌افزار هوش مصنوعی».
- بخش بزرگی از کار **قبلاً نوشته شده** ولی دو تکه از هم جدا افتاده‌اند: (۱) «Foundry» واقعی که اپ را داخل کانتینر می‌سازد و روی زیردامنه سرو می‌کند (`ephemeral_runner.py` + `factorysynthesis_module.py` + صفحهٔ `/admin/mission-control`)، و (۲) کارخانهٔ داخلی/ایجنت‌های کدزن (`run_task.sh` و `agent_runner.py`). اینها امروز به‌هم وصل نیستند.
- گلوگاه اصلی محصول **نیست** هوش مصنوعی؛ **مستأجر (tenant)**، **مترکردن هزینه به‌ازای هر مشتری**، **دروازهٔ تأیید پیش از ساخت/انتشار** و **قرنطینهٔ امن کانتینر** است. هیچ‌کدام از این چهار مورد امروز وجود ندارد.
- میان‌راه‌ها موجودند: `config/key_pool.yaml` گروه `private` را دارد (ممنوعیت مدل رایگان برای داده مشتری) و پروفایل autonomy ladder و merge gate هم آماده‌اند.
- MVP پیشنهادی بسیار باریک: فقط «اپ‌های CRUD کسب‌وکاری از قالب، با فرم و گزارش تولیدشده»، به‌ازای هر مشتری روی یک زیردامنه، با سنجهٔ هزینه و دروازهٔ تأیید. چند هفته کار، نه چند ماه.
- مواردی که هنوز روی سرور زنده تأیید نشده‌اند با «نیازمند بررسی» علامت خورده‌اند (وضعیت اجرای فعلی Foundry، Redis Streams، سهمیهٔ GitHub Actions، دسترسی مدل swarm از ایران).
- بدون قیمت‌گذاری: تصمیم با مالک است.

---

## 1. Inventory: what exists today (file paths)

Live/dead verdicts below are read from code, tests and docs in this worktree.
Runtime liveness (is the process actually up on the host?) is **not** verifiable
from here — every such claim is marked **نیازمند بررسی**.

### 1.1 The real Software Foundry (host + build) — the strongest asset

| Component | Path | State | Notes |
| --- | --- | --- | --- |
| Foundry build worker | `output_apps/ecosystem_core/src/factory/ephemeral_runner.py` (3,528 lines) | **LIVE (code)** | The genuine build+host engine: consumes `BuildRequest`, materialises a per-app docker-compose project under `data/sandboxes/{app_id}` (line ~1632), builds and runs it, allocates a host port from `4000–4999` (`PORT_RANGE_START/END`, lines 167-168), binds it to `127.0.0.1:{host_port}` (line ~1990), registers an nginx subdomain vhost, and garbage-collects expired sandboxes (`SANDBOX_RETENTION_SECONDS`, `GARBAGE_COLLECT_ENABLED`, lines 410-414). Also supports remote worker nodes via `ROXIRA_FACTORY_HOSTS` (`remote_dispatcher.py`). |
| Foundry HTTP API | `output_apps/generated_modules/factorysynthesis/factorysynthesis_module.py` → `create_factory_router()` | **LIVE (code, auto-mounted)** | `run_unified_server.py:259-293` walks `output_apps/generated_modules/**` and mounts every `router`. Endpoints: `POST /api/v1/factory/synthesize-app`, `POST /synthesize`, `GET /synthesize-app/{app_id}`, `GET /nodes`, `GET /sandboxes`, `GET /metrics`, `POST /gc`, `DELETE /sandboxes/{app_id}` (`ephemeral_runner.py:3205-3509`). |
| Scaffold templates | `output_apps/ecosystem_core/src/factory/templates.py` | **LIVE (code)** | Two real templates: `fastapi-microservice` and `nextjs-tailwind-landing`; `select_template()` maps framework → template. |
| Swarm generator | `output_apps/ecosystem_core/src/factory/swarm_orchestrator.py` (1,851 lines) | **LIVE (code)** | Tier `AUTONOMOUS_SWARM`: architect → OpenAPI 3.1 contract → schema/backend/frontend workers emit FastAPI routers + Next.js pages from the contract, with deterministic fallback when the LLM is unavailable. This is the closest thing to "generate a CRUD app". Default model `anthropic/claude-sonnet-5` (line 63) — see risk R4. |
| MCP tool server | `output_apps/ecosystem_core/src/factory/mcp_server.py` | **LIVE (mounted)** | Mounted at `/mcp` by `run_unified_server.py:321-324`; exposes `synthesize_app`, build-status, legal retrieval. |
| Mission-control UI | `output_apps/enterprise_hub/frontend/src/app/admin/mission-control/page.tsx` (2,074 lines) | **LIVE (frontend)** | Spec intake textarea (line ~1433), tier picker `FRONTIER`/`AUTONOMOUS_SWARM` (lines 99-104), deployment target, live stage pipeline (`QUEUED → PORT_ALLOCATED → PROJECT_GENERATED → BUILDING → CONTAINER_STARTED → ROUTE_REGISTERED → RUNNING`), sandbox list, teardown. It is the existing product-shaped UI. |
| Docker helpers | `output_apps/ecosystem_core/src/factory/docker_engine.py` | LIVE (code) | Resolves docker/compose binaries and socket across host layouts. |

> **نیازمند بررسی:** whether the production host currently has `factorysynthesis`
> mounted and healthy, whether `REDIS_URL` is set (Redis Streams queue + separate
> worker) or the API advances builds in-process, and whether `ROXIRA_FACTORY_HOSTS`
> is configured. None of that is visible from this checkout.

### 1.2 The internal builder / agent factory

| Component | Path | State | Notes |
| --- | --- | --- | --- |
| Server agent runner | `scripts/infra/server_agents/run_task.sh`, `setup.sh` | **LIVE** | Runs OpenCode in an isolated git worktree as user `roxira-agent`; the *runner* commits, scope/secret checks, pushes only `agent/*`. `--public` gate refuses `:free` models for non-public work. Documented in `docs/ops/SERVER_AGENTS.md`. |
| W10 agent engine | `output_apps/ecosystem_core/src/factory/agent_runner.py` (891 lines) | **LIVE (logic), GitHub-Actions-only** | Turns one `agent`-labelled issue into a PR via worktree + OpenCode + denylist + `py_compile`/`ruff`. Refuses any real run unless `AGENT_RUNTIME=github-actions`, and `AGENT_ENABLED` is a default-off kill switch. Unit-tested (`src/factory/test_agent_runner.py`). |
| Project Factory pipeline | `output_apps/ecosystem_core/src/factory/factory_{plan,status,post_proposal,approval_gate,dispatch_next}.py`, pure logic in `src/factory_pipeline/*` | **LIVE (logic, Actions-dependent)** | Brief → research → `/approve` → plan (≤15 tasks) → build → status. Approval gate + run ledger + budget exist (`src/factory_pipeline/{commands,plan_parsing,budget,run_ledger}.py`). |
| Cost ledger | `output_apps/ecosystem_core/src/factory/cost_ledger.py`, `src/factory_pipeline/budget.py`, `scripts/cost_report.py` | **LIVE (logic)** | Generic JSONL rows `{ts, source, model, cost_usd}` + Persian/English report; daily budget via OpenRouter key limits. Not tenant-aware. |
| Review / merge gates | `output_apps/ecosystem_core/src/factory/{review_gate,automerge_gate}.py`, `scripts/ci/merge_gate.py`, `config/autonomy_ladder.json` | **LIVE** | L0–L4 autonomy ladder, sensitive-path rules, test-tamper checks, reviewer-family rule. Governs the *repo*, not customer app builds. |
| Key pool → LiteLLM gateway | `config/key_pool.yaml`, `scripts/infra/key_pool/render_litellm.py`, `docs/infra/KEY_POOL.md` | **LIVE (design)** | One OpenAI-compatible gateway (127.0.0.1:4000). Groups `agent-free` and `private`; `private` has `require: {data_policy: no_train, forbid_free: true}` (lines 147-156). |
| Deep research service | `services/research/app.py`, `docs/infra/RESEARCH_SERVICE.md` | **LIVE (design)** | FastAPI wrapper over GPTResearcher, explicitly public-questions-only. |
| Auto-deploy | `scripts/ops/autodeploy/{autodeploy.sh,install.sh,*.service,*.timer}`, `docs/ops/AUTODEPLOY.md` | **LIVE** | systemd timer deploys `origin/main` every 5 min with freeze file, pg_dump before migrations, smoke + rollback. |
| Autonomy policy | `config/autonomy_ladder.json`, `docs/research/AUTONOMY_AND_SAFETY_2026-10.md`, `docs/factory/FACTORY_AUDIT_2026-10-12.md`, `docs/research/AGENT_FACTORY_STACK_2026-10.md` | **LIVE (docs/config)** | Ladder L0–L4, hard caps, failure-mode catalogue, local-first stack research. |

### 1.3 Legacy / dead code (do not build the product on these)

| Component | Path | Verdict | Why |
| --- | --- | --- | --- |
| Root module generator | `factory_engine.py` | **DEAD/legacy** | Hardcodes `/opt/roxira_platform`, reads `.env` directly, runs the whole pipeline at import (no `__main__` guard), ships hardcoded `fallback_code` stubs, and appends a loader snippet into `run_unified_server.py`. `docs/factory/FACTORY_AUDIT_2026-10-12.md:99` already classifies it as a server-side legacy artifact. |
| Dispatch HTTP API (port 8005) | `factory_dispatch_api.py` | **DEAD/legacy (closed)** | Imports `transcribe_audio_blob` *before* its own shebang (line 1) — a sign of abandonment. Its anonymous `POST /dispatch` path was hardened in W10 phase 2 to require `FACTORY_DISPATCH_TOKEN` and it now only triggers the dry-run legacy worker. Still consumes the reserved port 8005 (`AGENTS.md` §7). |
| Legacy queue worker | `output_apps/ecosystem_core/src/factory/task_worker.py` | **DEAD/legacy (by design)** | Its own docstring: "Legacy task_queue.json worker… always calls `agent_runner.process_one_issue()` with `dry_run=True`." |
| Legacy queue data | `task_queue.json` | **DEAD/legacy** | Seed rows from 2026-09-18, all `SUCCESS`, no real GitHub issue behind them. |
| Backlog feeder | `output_apps/ecosystem_core/src/factory/backlog_auto_feeder.py` | **DEAD/legacy** | Hardcoded `ROADMAP_PIPELINE` writing `task_queue.json`. |
| Architect+Goose generator | `output_apps/ecosystem_core/src/factory/roxira_factory_engine.py` (+ `sandbox_runner.py`) | **DEAD/legacy** | Hardcodes `/opt/roxira_platform`; "sandbox" is a subprocess import in the shared venv, not isolation; relies on `/usr/bin/goose`. Superseded by `ephemeral_runner.py`. |
| Demo generator | `output_apps/ecosystem_core/src/factory/software_factory_engine.py` | **DEAD/legacy / mock** | Returns a hardcoded `file_tree` + preview HTML; does not build anything. |
| Root daemons | `autonomous_master_daemon.py`, `chaos_swarm_orchestrator.py`, `autonomous_agent_factory.py`, `master_swarm_orchestrator.py`, `autonomous_agent_watcher.py` | **DEAD/legacy (per audit)** | `FACTORY_AUDIT_2026-10-12.md:228` classifies them as vapour/legacy, hardcoding server paths and predating the current model. |

**Inventory takeaway:** the sellable product already has a real build-and-host
engine (1.1) and a real agent-builder lane (1.2). What is missing is the layer
that makes them *customer-facing*: tenancy, metering, gating and hardened
sandboxing — plus a non-admin intake surface.

---

## 2. Gap analysis for a customer-facing MVP

The synthesis below compares what exists (§1) with what the product needs.

### 2.1 Tenant isolation

- `docs/infra/TENANT_ISOLATION_PLAN.md` is the canonical plan (status: **DESIGN /
  NO CODE**). It adds a `tenants` table, `users.tenant_id`, a `tenantId` JWT
  claim, repository-layer scoping and per-tenant unique keys.
- **But it covers only the NestJS enterprise modules** (`invoicing`,
  `accounting`, `inventory`, `hr`, `damages`, `tax_compliance`) and the CRM
  reference. It does **not** mention the Foundry, `synthesize-app`, sandboxes,
  builder tasks, artifacts or the cost ledger.
- Confirmed by grep: **zero mentions of `tenant`/`owner`/`org_id` anywhere under
  `output_apps/ecosystem_core/src/factory/`.** Foundry sandboxes are keyed only
  by client-supplied `app_id`, and `data/sandboxes/{app_id}` has no owner.
- Gaps to close:
  1. `tenants` + `users.tenant_id` + `tenantId` JWT claim (foundation, as in
     the plan's §5.1/§6) — must land first.
  2. New `apps` (or `foundry_builds`) table: `(tenant_id, app_id, spec, stage,
     host_port, subdomain, created_at)`, with a composite unique on
     `(tenant_id, app_id)` and tenant-scoped reads in the API.
  3. Every Foundry endpoint takes the tenant from the verified token, never the
     body; `GET /sandboxes` and `DELETE /sandboxes/{id}` return/filter by tenant.
  4. Reserve subdomains per tenant (`{app}.{tenant}.apps.roxira.ir` or a
     per-tenant subdomain set) so two tenants cannot collide on an app name.
  5. Builder tasks: tag each dispatch and each artifact directory with
     `tenant_id`; never let one tenant's worker read another's worktree.

### 2.2 Sandboxed build + run per customer app

- **Already done well:** one docker-compose project per app
  (`data/sandboxes/{app_id}`), host port from `4000–4999`, bind to
  `127.0.0.1:{port}` only, nginx subdomain vhost + `nginx -s reload`, health
  probes, TTL garbage collection, remote worker nodes — see
  `ephemeral_runner.py` §1.1.
- **Gaps (the hard part):**
  1. **No container hardening.** The generated compose project has no
     `mem_limit`, `pids_limit`, `read_only` rootfs, dropped capabilities or
     no-new-privileges. Customer-generated code must run under resource caps
     (the audit already recommends this for previews; see
     `docs/research/nextgen/C_execution_delivery_substrate.md`).
  2. **Docker socket is a trust boundary.** The API/worker process can reach
     `/var/run/docker.sock`. Untrusted generated code or a prompt-injected spec
     must never reach a privileged context; keep the build runner unprivileged
     and never mount the socket into a customer container.
  3. **Build-time network egress.** Templates `pip install` / `npm install` at
     image build time; a malicious spec could try dependency confusion. This is
     the slopsquatting risk already catalogued in
     `docs/research/AUTONOMY_AND_SAFETY_2026-10.md:62`. Pin/lock and build
     behind a cache or a mirror; gate new dependencies.
  4. **Ports must stay on `127.0.0.1`.** Satisfied today in the compose
     generator, but must be asserted as a regression test so a future change
     cannot publish `0.0.0.0`.
  5. **Per-tenant network isolation.** Today all sandboxes share the host
     docker network. Decide/verify whether app containers may reach each other
     or host services; a per-tenant compose network is the target.
  6. **Runner resource caps / fairness.** A shared host with unbounded concurrent
     builds can starve production (the reserved-port map in `AGENTS.md` §7
     already protects live services). Cap concurrent builds per tenant and
     globally.

### 2.3 Spec intake UI

- Exists: `mission-control/page.tsx` has a free-text spec textarea, a tier
  picker (`FRONTIER` / `AUTONOMOUS_SWARM`), a deployment target and a live
  stage view. **Gaps:**
  1. It lives under `/admin` and is owner-facing (no customer auth or tenant
     scoping in the page).
  2. Free text only — no structured spec (entities, fields, forms, reports,
     roles), which is exactly what CRUD generation needs.
  3. No preview-before-build, no spec review/approval step.
  4. No customer signup/organisation onboarding (which blocks §2.1).

### 2.4 Cost metering per tenant

- Exists: `cost_ledger.py` (generic JSONL) + `src/factory_pipeline/budget.py` +
  `scripts/cost_report.py` + per-model prices in `config/models.yaml` +
  `scripts/dev/llm_spend.sh`. **Gaps:**
  1. No `tenant_id` on any ledger row or build record — cannot bill or budget
     per customer.
  2. Builder spend (`agent_runner`) and swarm spend (`swarm_orchestrator`) are
     not recorded in the same ledger shape.
  3. No per-tenant quota or hard stop; the only real cap today is the shared
     OpenRouter key's daily limit — a single bad loop affects all tenants.

### 2.5 Review / approval gates

- Exists (for the repo): L0–L4 autonomy ladder, `merge_gate.py`,
  `factory_approval_gate.py`, `review_gate.py`, `automerge_gate.py`,
  `autonomy_ladder.json`. **Gap:** the customer build path has **no gate** —
  `POST /synthesize-app` builds immediately. The product needs at least:
  1. **Spec approval** ("this is what I want built").
  2. **Build acceptance** before a preview URL is public.
  3. **Deploy-to-prod approval** for the tenant's real subdomain.
  These should reuse the existing ladder vocabulary (owner-gated L3/L4) rather
  than invent a new one.

### 2.6 Security (AGENTS.md §4)

- Rule: *customer/case data never goes to a `:free`-tier model* (`AGENTS.md:30`).
- Exists: `config/key_pool.yaml` group `private` (`require: no_train`,
  `forbid_free`); `run_task.sh` `--public` gate refuses `:free` without an
  explicit flag; `services/research/app.py` documents public-only.
- **Gaps:**
  1. `swarm_orchestrator.py` defaults to `anthropic/claude-sonnet-5` (a paid,
     no-train model, OK for data — but it is Anthropic, and Iran is
     unsupported per `docs/research/AGENT_FACTORY_STACK_2026-10.md:8`). Route the
     swarm through the gateway `private` group and a supported provider.
  2. The Foundry does not route its LLM calls through the `private` group at
     all; a customer spec could be sent to a free model. Enforce group selection
     per tenant tier at the code path.
  3. No secret lease for sandboxes: generated apps must get no repo secrets,
     no `.env`, no host socket.
  4. The tenant spec itself is customer data — storage and retention must follow
     the same rules (never in prompt packs, never in `:free` calls).

---

## 3. MVP scope (smallest sellable thing)

**One sentence:** a customer signs up as a tenant, fills a structured spec for
a *CRUD business app* (entities + fields + basic reports), reviews and approves
it, and receives a hosted app on a tenant subdomain — with per-tenant cost shown
and build/deploy gated.

Explicitly **out of MVP scope**: arbitrary custom code, integrations, mobile,
payments inside generated apps, self-service teardown, SLA. Those are post-MVP.

### 3.1 Reuse map (build nothing new that already exists)

| MVP need | Reuse | New work |
| --- | --- | --- |
| Build + host per app | `ephemeral_runner.py` (compose per app, 127.0.0.1 ports, nginx subdomain, GC) | Container hardening + tenant ownership |
| Generate CRUD | `swarm_orchestrator.py` contract → FastAPI + Next.js | Constrain to a CRUD schema subset; pin a data-safe `private`-group model |
| Templates | `templates.py` (`fastapi-microservice`, `nextjs-tailwind-landing`) | Add a CRUD/admin template with forms + reports |
| API surface | `factorysynthesis_module.py` | Tenant-scoped variants of `/synthesize-app`, `/sandboxes` |
| UI | `mission-control/page.tsx` | Customer-facing intake + tenant scoping + approval buttons |
| Cost | `cost_ledger.py` + `models.yaml` prices | `tenant_id` on rows + per-tenant report/quota |
| Gates | `autonomy_ladder.json`, `factory_approval_gate.py` | Wire spec/build/deploy gates into the Foundry path |
| Auth/tenancy | TENANT_ISOLATION_PLAN foundation | Extend to Foundry + builder |

### 3.2 Architecture (text diagram)

```
                       ┌──────────────────────────────────────────────┐
  Customer (browser)   │  Customer portal / intake (Next.js, tenant-  │
        │              │  authed)  — structured spec form: entities,  │
        ▼              │  fields, forms, reports, roles               │
  ┌───────────────┐    └──────────────────────────────────────────────┘
  │  roxira.ir /   │                    │ POST spec (JWT tenantId)
  │  portal        │                    ▼
  └───────────────┘    ┌──────────────────────────────────────────────┐
                       │ Spec API  /api/v1/factory/synthesize-app      │
                       │  • tenant from verified JWT only              │
                       │  • writes apps(tenant_id, app_id, spec, …)    │
                       │  • GATE 1: spec approval                      │
                       └──────────────┬───────────────────────────────┘
                                      │ enqueue BuildRequest(tenant_id)
                                      ▼
                       ┌──────────────────────────────────────────────┐
                       │ Build queue  (Redis Streams; in-process      │
                       │ fallback)                                     │
                       └──────────────┬───────────────────────────────┘
                                      ▼
      ┌───────────────────────────────────────────────────────────────┐
      │ EphemeralRunner (Foundry)                                      │
      │  • swarm_orchestrator → OpenAPI contract → FastAPI + Next.js   │
      │      (LLM via key_pool `private` group, no :free, no_train)    │
      │  • materialise compose project  data/sandboxes/{tenant}/{app}  │
      │  • host port 4000-4999  →  bind 127.0.0.1:{port} only          │
      │  • container caps (mem/pids/read-only/no-new-privileges)       │
      │  • GATE 2: build acceptance before public URL                  │
      └──────────────┬─────────────────────────────────┬──────────────┘
                     │ nginx vhost                     │ ledger row
                     ▼                                 ▼
      ┌───────────────────────────┐      ┌───────────────────────────┐
      │ tenant subdomain          │      │ cost_ledger (tenant_id)   │
      │ {app}.{tenant}.apps.…     │      │ per-tenant report + quota │
      └───────────────────────────┘      └───────────────────────────┘

  Builder lane (internal, optional for MVP): run_task.sh / agent_runner.py
      → OpenCode worktree → agent/* branch → PR → merge gate (L0-L4)
```

### 3.3 Milestones (effort in working days, one developer, order matters)

| # | Milestone | Deliverable | Est. |
| --- | --- | --- | --- |
| M0 | **Foundation tenancy** | `tenants`, `users.tenant_id`, `tenantId` JWT claim, onboarding; per TENANT_ISOLATION_PLAN §5.1/§6 | 3–5 |
| M1 | **Foundry tenancy** | `apps` table + tenant-scoped `synthesize-app`/`sandboxes`/`metrics`; per-tenant artifact paths + subdomains; tests | 4–6 |
| M2 | **CRUD template + constrained swarm** | A CRUD/admin template (forms + reports) and a swarm mode limited to entities/fields/reports; pin the `private`-group model | 5–8 |
| M3 | **Hardened sandbox** | Compose hardening (mem/pids/read-only/caps), per-tenant network, port-binding regression test, build-time egress/lock policy | 4–6 |
| M4 | **Intake UI + gates** | Customer intake form + spec approval + build-acceptance + deploy-decision; tenant scoping in UI | 4–6 |
| M5 | **Per-tenant metering** | `tenant_id` on ledger rows + per-tenant report/quota/hard stop; surface in UI | 3–4 |
| M6 | **Security sign-off + dry run** | Free-tier ban enforced end-to-end, secret lease denied to sandboxes, one real customer app end to end | 3–5 |

Total ≈ **26–40 working days**. M0–M1 are the critical path; M2–M3 can overlap
with M4–M5 once the contract shape is fixed. **نیازمند بررسی:** whether the host
has spare capacity for several concurrent tenant apps (memory/ports), which
changes M3/M5 sizing.

### 3.4 Risks and mitigations

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R1 | Container escape / docker-socket exposure via untrusted generated code | Critical | Keep the build runner unprivileged; never mount the socket or host paths into customer containers; container caps (M3); run builds on an isolated worker node. |
| R2 | Customer data sent to a `:free`/logging model (AGENTS.md §4) | Critical | Route all swarm/foundry LLM calls through the `private` group; per-tenant enforcement in code, not prompt; test that a free provider can never be selected. |
| R3 | Cross-tenant data leak (shared sandboxes, ports, subdomains, ledger) | High | M1 tenant scoping + composite uniques; repository-level scoping per the isolation plan §4.2; negative cross-tenant tests. |
| R4 | Default swarm model `anthropic/claude-sonnet-5` unreachable/unsupported from Iran | High | Route via the gateway to a supported, data-safe paid model; verify reachability before M2 (**نیازمند بررسی**). |
| R5 | Runaway cost from a bad spec / loop | High | Per-tenant quota + hard stop (M5); daily caps; per-task step/token/time caps per `AUTONOMY_AND_SAFETY` §4. |
| R6 | Template ceiling: real business apps need more than CRUD | Medium | Keep MVP strictly CRUD; expose "needs human" handoff to the builder lane for anything outside the template. |
| R7 | Build-time supply chain (pip/npm from a malicious spec) | High | Lock, pin, build behind cache/mirror; gate new dependencies (M3). |
| R8 | Dependency on GitHub Actions / exhausted minutes for the builder lane | Medium | Foundry MVP build path does not require Actions; the internal builder lane is optional. **نیازمند بررسی:** current Actions availability. |
| R9 | Host capacity: many concurrent containers exhaust RAM/ports | Medium | Concurrent-build caps, TTL/GC (already present), a dedicated worker node when needed. |
| R10 | Untrusted spec text as prompt injection in the build model | High | Treat specs as data, never spliced into shell; minimal env for builders (as `agent_runner`/`run_task.sh` already do); no secrets in scope. |
| R11 | Data residency / legal constraints for hosting customer apps in Iran | Medium | Owner/legal decision. **نیازمند بررسی.** |

### 3.5 What the owner must decide (outside this document)

- Pricing and packaging (explicitly out of scope here).
- Whether the MVP should generate a **new app per customer** or tenant-scoped
  rows inside one shared app-shell (affects M1/M2 massively).
- Which providers are acceptable for customer data, given Iran reachability.
- Host budget for concurrent tenant containers / a second worker node.

---

## 4. Recommendation

Ship the **customer-facing Foundry**, not the internal agent factory, as the
first sellable thing. The Foundry already builds and hosts per-app in an
isolated container on a localhost port behind a subdomain — the customer-visible
"describe it and it appears" experience is mostly a tenancy + metering + gating
wrapper around code that already exists. The internal agent builder
(`run_task.sh`, `agent_runner.py`) stays as the escape hatch for requests the
CRUD template cannot satisfy. The two legacy paths named in the task
(`factory_engine.py`, `factory_dispatch_api.py`) and their queue
(`task_queue.json`, `task_worker.py`) should be treated as archived, per
`FACTORY_AUDIT_2026-10-12.md` §7.
