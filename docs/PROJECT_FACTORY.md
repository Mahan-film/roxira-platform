# Roxira Project Factory (W11)

## راهنمای سریع برای مالک (فارسی)

Project Factory یک پروژه جدید را از یک بریف کوتاه شما تا کد قابل مرور، همه روی
**GitHub Actions** (نه سرور تولید)، پیش می‌برد:

1. **بریف بنویسید.** در تب Issues مخزن، «New issue» → «بریف پروژه جدید
   (Project Factory)» را انتخاب کنید و فرم را پر کنید (فارسی مشکلی ندارد).
   لیبل `brief` خودکار اضافه می‌شود.
2. **صبر کنید.** طی چند دقیقه یک تحقیق فناوری چندزبانه اجرا می‌شود
   (`factory-research.yml`) و یک **پیشنهاد فارسی** به‌عنوان کامنت روی همان
   ایشو می‌آید: ۲ تا ۳ گزینه برای هر بخش (بک‌اند، فرانت‌اند، داده، زیرساخت،
   هوش مصنوعی)، امتیاز هرکدام، برآورد هزینه ماهانه، ریسک‌ها و یک گزینه
   پیشنهادی. گزارش کامل هم به‌صورت artifact همان اجرا (تب Actions) پیوست
   می‌شود.
3. **تأیید کنید.** کامنت بگذارید `/approve` (پذیرش گزینه پیشنهادی) یا
   `/approve <نام گزینه>` (انتخاب گزینه دیگر)، یا لیبل `approved` را اضافه
   کنید. **پیش از این هیچ کدی ساخته نمی‌شود.**
4. **برنامه‌ریزی خودکار.** یک برنامه‌ساز حداکثر ۱۵ وظیفه کوچک و مستقل
   می‌سازد، هر کدام یک ایشوی فرزند (لیبل `agent`) با خلاصه فارسی، و روی همان
   ایشوی اصلی یک چک‌لیست فارسی از پیشرفت کار می‌گذارد.
5. **ساخت خودکار.** عامل‌های کدنویسی ارزان (همان زیرساخت W10) وظایف را یکی‌یکی
   می‌سازند؛ هر کدام یک PR با CI کامل. با ادغام هر PR، وظیفه بعدیِ آماده
   خودکار شروع می‌شود.
6. **هر وقت خواستید بپرسید:** کامنت `/status` روی ایشوی اصلی، وضعیت پیشرفت،
   PR های باز و هزینهٔ صرف‌شده تاکنون را فارسی جواب می‌دهد.

### راه‌اندازی یک‌بارهٔ مالک (پیش از اولین استفاده)

در تنظیمات مخزن (Settings → Secrets and variables → Actions):

- **Secrets** (کلیدهای OpenRouter و موتورهای جست‌وجو؛ کلیدهای `OPENROUTER_AGENT_KEY`
  اگر W10 را قبلاً راه‌اندازی کرده‌اید از قبل هست):
  `OPENROUTER_RESEARCH_KEY` (کلید مجزا برای تحقیق/برنامه‌ریزی، با سقف روزانه)،
  `BRAVE_API_KEY`، `EXA_API_KEY`، `FIRECRAWL_API_KEY`، `JINA_API_KEY`،
  `TAVILY_KEYS`.
- **Variables**: `FACTORY_ENABLED=true` (کلید خاموش/روشن کل این خط لوله؛
  پیش‌فرض خاموش است)، و اختیاری: `AGENT_ALLOWED_ACTORS`،
  `AGENT_MAX_CONCURRENT`، `AGENT_DAILY_BUDGET_USD` (این سه با W10 مشترک‌اند).
- **Labelها** را بسازید (یا بگذارید GitHub خودکار در اولین استفاده بسازد):
  `brief`، `proposal-ready`، `approved`، `plan-ready`، `agent`،
  `agent-dispatched` (این دو مورد آخر با W10 مشترک: `agent`، `agent-pr-open`).
- W10 باید از قبل راه‌اندازی شده باشد (`AGENT_ENABLED=true`، `OPENROUTER_AGENT_KEY`)
  چون مرحله ساخت واقعی همان `agent-task.yml` را صدا می‌زند.

### هزینه تقریبی هر پروژه

- تحقیق (مرحله ۲): هر بریف حداکثر «$۰.۵۰» (`--max-usd 0.50`؛ معمولاً کمتر).
- برنامه‌ریزی (مرحله ۴): یک فراخوانی مدل قوی، معمولاً چند سِنت.
- ساخت (مرحله ۵): هر وظیفه از طریق کلید `OPENROUTER_AGENT_KEY` با سقف روزانهٔ
  همان کلید (`limit`/`limit_reset: daily` در OpenRouter) هزینه می‌شود؛ همان
  کنترل هزینهٔ W10.

---

## English details

### What is built vs. designed for later

Everything in the pipeline below runs on **GitHub Actions**, never on the
production server (`docs/STRATEGY.md` section 8's design decision). v1 builds
a new project **inside this repo**, under `projects/<slug>/`. Building it in
its own separate repo needs a GitHub App (to create repos and grant the
coding agent scoped access there) -- that is **v2, documented only** (see
[v2](#v2-separate-repo-per-project-documented-only) below); nothing in this
PR creates or touches another repository.

### Pipeline stages

| # | Stage | Workflow | What it does |
| - | --- | --- | --- |
| 1 | Brief | `.github/ISSUE_TEMPLATE/project-brief.yml` | Owner fills a Persian form (goal, users, must-have features, constraints/budget, preferred stack, deadline). Applies label `brief`. |
| 2 | Research | `.github/workflows/factory-research.yml` | Triggered by the `brief` label or `workflow_dispatch`. Runs `python3 -m src.automation.tech_radar --project-brief "<idea>" --report-lang fa --max-usd 0.50` (W9), then `factory_post_proposal.py` posts a Persian proposal comment (2-3 options per layer, scores, monthly cost, risks, a recommendation) and uploads the full report as a workflow artifact. Adds label `proposal-ready`. |
| 3 | Approval | `.github/workflows/factory-plan.yml` (gate step) | An allowlisted actor comments `/approve` or `/approve <option>`, or adds the `approved` label. Parsed by the pure `src.factory_pipeline.commands.parse_approval_comment`. Nothing is built before this. |
| 4 | Plan | `.github/workflows/factory-plan.yml` (plan step) → `factory_plan.py` | A `strong`-tier planner call (`src.automation.llm_router_bridge.call_llm`, key `OPENROUTER_RESEARCH_KEY`) turns the approved brief+option into <= 15 small, dependency-ordered tasks (`src.factory_pipeline.plan_parsing`). Opens a PR writing `projects/<slug>/PLAN.md` + `plan.json`, opens one child issue per task (label `agent`, English body + one-line Persian summary, linked to the parent and to the real issue numbers of tasks it depends on), posts a Persian progress checklist on the parent issue, and dispatches the first ready task(s) (up to `AGENT_MAX_CONCURRENT`). |
| 5 | Build | `.github/workflows/agent-task.yml` (W10, reused unchanged) + `.github/workflows/factory-build.yml` → `factory_dispatch_next.py` | Each dispatched child issue runs through W10's existing cheap-agent pipeline (worktree, OpenCode, denylist, checks, PR). When that PR merges (`pull_request: closed` on `agent/**`, `merged == true`), `factory-build.yml` finds the task's `plan.json`, recomputes which tasks are now unblocked, and dispatches them via `workflow_dispatch` (a GITHUB_TOKEN-authored merge/label never triggers another workflow on its own -- see `docs/AGENTS_WORKFORCE.md` #6). Updates the parent issue's Persian progress checklist. |
| 6 | Status | `.github/workflows/factory-status.yml` → `factory_status.py` | `/status` on the parent issue replies in Persian with per-task progress, open PR links, and OpenRouter spend so far (`GET /api/v1/key` via `agent_runner.openrouter_key_usage`, same helper W10 uses). |

### Design decisions this PR follows (set by the hub, not re-litigated here)

- GitHub Actions only, never the prod server.
- v1 builds in-repo (`projects/<slug>/`); separate-repo-per-project is v2.
- GITHUB_TOKEN-authored events (a label add, an issue create, a merge done
  by the token) never trigger other workflows, so every hand-off between
  stages that needs one uses an explicit `workflow_dispatch` REST call
  (`dispatch_workflow()` in `factory_plan.py` / `factory_dispatch_next.py`),
  the same pattern `agent-task.yml` already uses to trigger `ci.yml`.
- Every workflow has: an actor allowlist (`AGENT_ALLOWED_ACTORS`, default
  `mahan-films`), a kill switch (`FACTORY_ENABLED` for this pipeline,
  independent of W10's own `AGENT_ENABLED`), `timeout-minutes`, and cost caps
  (`--max-usd` for research, the `OPENROUTER_RESEARCH_KEY`'s own daily limit
  for planning, `OPENROUTER_AGENT_KEY`'s daily limit for building).
- No issue/comment/PR body is ever spliced into a `run:` script via `${{ }}`;
  untrusted text always goes through `env:` or a file, then a `$VAR`
  reference in the shell -- checked file by file below and with `actionlint`.
- `actions/checkout` always uses `persist-credentials: false`; every push
  goes over an explicit `https://x-access-token:<token>@github.com/...` URL
  instead (`push_plan_branch()` in `factory_plan.py`, mirroring
  `agent_runner.push_branch()`).

### Code layout

- **Pure logic** (`src/factory_pipeline/`, unit tested under `pytest -m "not
  integration"`, per `pyproject.toml`'s `testpaths = ["src"]`):
  - `commands.py` -- parse `/approve`, `/approve <option>`, `/status`.
  - `allowlist.py` -- the same comma-padded actor check as `agent-task.yml`'s
    `AGENT_ALLOWED_ACTORS` guard, as a testable function.
  - `slugs.py` -- `projects/<slug>/` slug generation + collision avoidance.
  - `plan_parsing.py` -- planner JSON validation, the task dependency graph
    (topological order, "what's ready now"), PLAN.md rendering, and the
    exact child-issue title/body shape.
  - `proposal.py` -- the Persian stack-proposal comment (from
    `run_project_brief()`'s result payload), capped under GitHub's
    65536-char comment limit.
  - `status_report.py` -- the Persian progress checklist / `/status` reply.
- **Orchestration scripts** (`output_apps/ecosystem_core/src/factory/`,
  alongside W10's `agent_runner.py`, reusing its GitHub REST/git helpers via
  a sibling import rather than duplicating them):
  - `factory_post_proposal.py` (stage 2), `factory_approval_gate.py` (stage
    3), `factory_plan.py` (stage 4), `factory_dispatch_next.py` (stage 5),
    `factory_status.py` (stage 6).
  - Tests for these live in `src/factory/test_factory_*.py`, loaded by file
    path inside a fixture (same technique `src/factory/test_agent_runner.py`
    already uses) because these modules live outside `testpaths = ["src"]`
    and `src/test_ci_quarantine_guard.py` forbids import-time side effects in
    any `src/test_*.py`.

### Labels used

| Label | Applied by | Meaning |
| --- | --- | --- |
| `brief` | the issue template | A new project brief, ready for research. |
| `proposal-ready` | `factory_post_proposal.py` | The Persian proposal comment has been posted. |
| `approved` | the owner (or `/approve` comment, no label needed) | Triggers planning. |
| `plan-ready` | `factory_plan.py` | PLAN.md PR opened and child issues created. |
| `agent` | `factory_plan.py` (child issues) | Same label W10's `agent-task.yml` already watches. |
| `agent-dispatched` | `factory_plan.py` / `factory_dispatch_next.py` | This child task has been dispatched to `agent-task.yml`; do not dispatch it again. |
| `agent-pr-open` | `agent_runner.py` (W10, unchanged) | The child task's agent PR is open. |

### Owner setup checklist

1. Secrets (Settings -> Secrets and variables -> Actions -> Secrets):
   `OPENROUTER_RESEARCH_KEY` (new, dedicated, its own daily `limit`),
   `OPENROUTER_AGENT_KEY` (already required by W10),
   `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `JINA_API_KEY`,
   `TAVILY_KEYS`.
2. Variables (Settings -> Secrets and variables -> Actions -> Variables):
   `FACTORY_ENABLED=true` (this pipeline's own kill switch); optionally
   override `AGENT_ALLOWED_ACTORS`, `AGENT_MAX_CONCURRENT`,
   `AGENT_DAILY_BUDGET_USD` (shared with W10).
3. Create the labels above (GitHub creates `brief` automatically from the
   issue template on first use; the rest are created on first use by the
   scripts too, but creating them up front avoids a transient 404 on a very
   first run).
4. W10 phase 2 must already be live (`AGENT_ENABLED=true`,
   `OPENROUTER_AGENT_KEY` set, branch protection on `main`) -- stage 5 reuses
   `agent-task.yml` unchanged.
5. Open one real brief end to end before relying on this for anything else.

### Costs

- Research (stage 2): capped at `--max-usd 0.50` per brief (usually less;
  `docs/research/LIVE_RUN.md` measured ~$0.02 for a flat topic scan and
  estimated noticeably less than $0.50 for a full 9-layer project brief in
  the common case).
- Planning (stage 4): one `strong`-tier call: typically a few cents.
- Building (stage 5): unchanged from W10 -- each task's real cap is
  `OPENROUTER_AGENT_KEY`'s own `limit`/`limit_reset: daily`.
- `/status` (stage 6): a `GET /api/v1/key` call, which OpenRouter does not
  bill for.

### v2: separate repo per project (documented only)

Not built in this PR. v1 deliberately builds everything under
`projects/<slug>/` in this repo because a separate repo per project needs a
**GitHub App** (or an org-level PAT with `repo` scope), for two reasons the
built-in `GITHUB_TOKEN` cannot cover:

1. **Creating a new repository.** `GITHUB_TOKEN` is scoped to the repo the
   workflow runs in; it cannot call `POST /orgs/{org}/repos` or
   `POST /user/repos` to create a sibling repository.
2. **Installing CI/agent workflows there.** The new repo would need its own
   `.github/workflows/ci.yml` / `agent-task.yml` copies (or a reusable
   workflow reference back to this repo) and its own secrets/variables --
   either provisioned by the GitHub App at repo-creation time, or by a
   one-time manual step the owner runs per new project.

Sketch for when this is picked up: `factory_plan.py` would, instead of
`projects/<slug>/`, call the GitHub App's installation token to create
`mahan-films/<slug>`, push an initial commit seeding `ci.yml`/`agent-task.yml`
(templated from this repo's copies) plus `PLAN.md`, and open child issues
there instead of in this repo. `factory_dispatch_next.py` would need the
target repo as an explicit field in `plan.json` (already structured to carry
one -- see `load_plan()`) instead of assuming `GITHUB_REPO`. None of this is
implemented; `plan.json`'s shape was kept simple on purpose so this extension
does not require re-designing it.
