# Security review: production `roxira-worker` and `roxira-autodaemon` timers

Issue: #123 — *security review: server timers roxira-worker (every 5 min) and
roxira-autodaemon (every 30 min) run agent code on the production host (report only).*

Scope: read-only. This document reports what the two timers' scripts and their imports
actually do in the current tree. **Nothing here was run on the server, and no code was
changed.** Owner-facing commands are marked *owner-run*; they are for the owner to
execute after deciding.

Reviewed at (worktree): `/Users/mac/Developer/rx-wt/123`.

---

## 0. Executive summary

| Timer | Cadence | Script | Agent/LLM code? | Writes inside `/opt/roxira_platform`? | Can push to git? |
| --- | --- | --- | --- | --- | --- |
| `roxira-worker.timer` | every 5 min (+ spawned by the dispatcher) | `output_apps/ecosystem_core/src/factory/task_worker.py` | **No** — hard-coded `dry_run=True`, never invokes `opencode`, never calls GitHub | **Yes** — rewrites `task_queue.json` in the checkout | **No** (current code) |
| `roxira-autodaemon.timer` | every 30 min | `autonomous_master_daemon.py` | **No** — no LLM; runs fixed `docker inspect/restart/exec` + loopback HTTP checks | **No** by default (`/opt/roxira_platform_reports`), unless `ROXIRA_REPORT_DIR` is overridden | **No** (current code) |

Both scripts were previously destructive: the daemon and the worker committed straight to
`main` on every cycle, producing the `chore(daemon)` / factory commits the issue describes
(the issue reports 307 such commits up to 2026-09-24, and a 2026-09-23 run `0ba8275` that
deleted a function and took ~50 Smart Judge routes down until PR #7 — also recorded in
`docs/AGENTS_WORKFORCE.md` §1). **The current repository versions no longer push to git.**
The daemon's commit/push block was removed and its report now goes to
`/opt/roxira_platform_reports`; the worker was reduced to an unconditional dry run. The
issue's `2b605a1` "deleted 619 lines while reporting all green" claim is consistent with
that history but was **not independently re-verified here** (running `git` is out of scope
for this task).

The real remaining concern is not the two timers as written — it is that the **worker is
still reachable via an HTTP enqueue path** (`roxira-dispatcher.service`,
`factory_dispatch_api.py`), and that both timers execute on the production host. Per the
project rule ("model/agent-written code never runs on the production host"), the
recommendation is to **disable the worker timer** and **sandbox the autodaemon timer**,
after the owner verifies the deployed files match this no-push/no-LLM revision.

---

## 1. `roxira-worker.timer` → `task_worker.py`

Source: `output_apps/ecosystem_core/src/factory/task_worker.py` (79 lines).

### What it does
1. `sys.path.insert(0, "/opt/roxira_platform")`, then `import agent_runner`.
2. If `/opt/roxira_platform/task_queue.json` exists, loads it and pops the first
   `pending` task.
3. Builds a synthetic "issue" from the task (`number=id`, `title=prompt`, `body=""`) and
   calls `agent_runner.process_one_issue(issue, cfg, repo_dir, dry_run=True)`.
4. Records the result back into `task_queue.json` under `completed` and rewrites the file.

### Import resolution (important on the server)
`task_worker.py` runs from
`/opt/roxira_platform/output_apps/ecosystem_core/src/factory/`, so Python's
`sys.path[0]` is that `factory/` directory. The explicit
`sys.path.insert(0, "/opt/roxira_platform")` puts the repo root ahead of it, so:

- if `/opt/roxira_platform/agent_runner.py` exists, **that** file is imported (a root
  copy that is *not* tracked at the repo root in this tree), otherwise
- it falls back to the sibling `factory/agent_runner.py`.

Either way `repo_dir = Path(__file__).resolve().parents[4]` resolves to
`/opt/roxira_platform`. The owner should confirm which `agent_runner.py` the running unit
actually loads (a stale root copy could behave differently from the reviewed one).

### Does it call an LLM or execute generated code/shell?
**No.** `process_one_issue()` returns at its first `dry_run` branch *before* the
`AGENT_RUNTIME` check, before any worktree, before `opencode`, before `git`, and before
the GitHub API. In dry-run it only builds the prompt string and returns a plan
(branch name, model, prompt preview). No `opencode`, no `subprocess` agent, no generated
code, no shell beyond the interpreter itself.

Note the hard guarantee lives in the **caller**, not the engine: `process_one_issue()`
will do a real run if called with `dry_run=False` *and* `AGENT_RUNTIME=github-actions` is
set. `task_worker.py` is the only thing pinning `dry_run=True`; a future edit that drops
that argument would re-open the path. `agent_runner.py`'s own `is_github_actions_runtime()`
gate still refuses real work unless the prod `.env` sets `AGENT_RUNTIME=github-actions`,
which it must never do.

### Where the task queue comes from / who can enqueue
- **Store:** a flat JSON file, `/opt/roxira_platform/task_queue.json` — **inside the git
  checkout**, not a DB table. Shape: `{"pending": [...], "completed": [...]}`.
- **Writers in the current tree:**
  - `task_worker.py` itself (pops pending, appends completed).
  - `factory_dispatch_api.py` `POST /api/v1/factory/dispatch` — appends a task and
    `subprocess.Popen`s `task_worker.py`. This endpoint now requires an
    `X-Factory-Token` header equal to `FACTORY_DISPATCH_TOKEN` from the environment;
    **unset (the default) returns 503 and the endpoint stays closed.** The server binds
    `127.0.0.1:8005` (loopback). nginx still fronts `/factory` and `/api/v1/factory/`
    to `172.18.0.1:8005` behind HTTP basic auth (`/etc/nginx/.factory_htpasswd`).
    So remote enqueue currently needs nginx basic auth **and**, if set, the factory
    token. Historically this endpoint was anonymous (see `docs/AGENTS_WORKFORCE.md` §1).
  - `backlog_auto_feeder.py` — refills `pending` with 4 hard-coded Persian prompts when
    empty. **Nothing in the current tree calls it** (no timer, no import); it is a
    dormant auto-feeder.
  - `roxira_factory_engine.py` (line 146) writes `completed`/`pending` too, but the
    current worker no longer calls that engine.
- **Bottom line:** the queue is a world-writable-by-host-root file plus a token-gated
  loopback HTTP endpoint. There is no tenant/ownership column and no per-caller authz.

### Env keys read
`task_worker.py` reads none directly. Via `agent_runner.RunnerConfig.from_env()` and
module import it reads: `AGENT_ENABLED`, `AGENT_RUNTIME`, `AGENT_USE_WORKTREE`,
`AGENT_DAILY_BUDGET_USD`, `AGENT_MAX_CONCURRENT`, `AGENT_TASK_TIMEOUT_SECS`,
`AGENT_LEDGER_PATH`, `AGENT_LOCK_DIR`, `AGENT_WORKTREES_ROOT`, `AGENT_OPENCODE_MODEL`,
`GITHUB_REPO`, `GITHUB_AGENT_TOKEN`, `OPENROUTER_API_KEY`. On import,
`agent_runner._default_model()` reads `config/models.yaml` (via
`model_registry.role_models("executor")`) and may add the repo root to `sys.path`. In the
dry-run path, `GITHUB_AGENT_TOKEN`/`OPENROUTER_API_KEY` are read into config but never
sent anywhere.

### Can it write inside `/opt/roxira_platform` / push to git?
- **Writes inside the checkout: yes** — it rewrites `task_queue.json` (a tracked file in
  the repo). This is the only write, and it happens even in dry-run.
- **Push to git: no** in the current code. No `git add/commit/push` exists in
  `task_worker.py` or in `agent_runner.py`'s dry-run path. The only push function,
  `agent_runner.push_branch()`, refuses any branch not starting with `agent/` and is
  unreachable from the dry-run path.

---

## 2. `roxira-autodaemon.timer` → `autonomous_master_daemon.py`

Source: `autonomous_master_daemon.py` (170 lines). Imports are stdlib only
(`os, sys, json, time, asyncio, subprocess, urllib`).

### What it does
`SystemAuditor` runs a fixed battery:
- `docker inspect -f {{.State.Status}}` on 9 named containers.
- `run_self_healing_if_needed()`: `docker restart <name>` for every container whose
  status is not exactly `running`.
- Loopback HTTP probes: FastAPI `/api/v1/apps/judge/health`,
  `POST .../calculators/damages` (hard-coded payload), Qdrant
  `http://127.0.0.1:6333/collections/iran_laws_bge_m3`, Twenty CRM `http://127.0.0.1:3002`.
- `test_voice_tts_engine()`: `docker exec roxira_app_prod python3 -c "<embedded
  edge_tts script>"` — an **inline Python snippet hard-coded in this source file**, not
  generated at runtime.
- Reads an optional tech-radar JSON (`ROXIRA_RADAR_REPORT_JSON` or
  `/opt/roxira_platform/var/tech_radar/tech_radar_report.json`, then a committed
  frontend placeholder) and writes `autonomous_dashboard.json` to `ROXIRA_REPORT_DIR`
  (default `/opt/roxira_platform_reports`).

### Does it call an LLM or execute generated code/shell?
- **No LLM call.** No model id, no HTTP to any LLM provider.
- **Executes subprocesses:** `docker inspect`, `docker restart`, and a `docker exec`
  running a fixed Python snippet. Arguments are constants, not derived from user input,
  network responses, or the queue file, so there is no injection path from the task
  queue into these commands. Still, this is code executing on the production host with
  the daemon unit's privileges (effectively root if run as root, since it drives the
  Docker socket) — the same class of capability the project rule is wary of.

### Where the task queue comes from / who can enqueue
**Not applicable.** The daemon does not read `task_queue.json` and has no intake. It is a
periodic health probe plus self-heal.

### Env keys read
`ROXIRA_REPORT_DIR` (default `/opt/roxira_platform_reports`) and
`ROXIRA_RADAR_REPORT_JSON` (optional path override). No secrets are read or logged.

### Can it write inside `/opt/roxira_platform` / push to git?
- **Writes inside the checkout: only if `ROXIRA_REPORT_DIR` is overridden to point
  there.** By default the report is written *outside* the repo, matching the issue #78
  fix referenced in the source comments.
- **Push to git: no.** The current file contains no `git` call at all (verified by
  reading the file and grepping it). The historical `git add -A && git commit ... && git
  push origin main` block that produced the `chore(daemon)` commits is gone.

---

## 3. Recommendations

The rule is: *model/agent-written code never runs on the production host.* Neither
script runs model/agent-written code **as currently written**. The residual risk is
(a) the worker's enqueue → dry-run → (if a future edit regresses) real-run path, and
(b) both units running with broad host privileges on a schedule. Recommendations:

### `roxira-worker.timer` → **disable**
Its only remaining effect is to rewrite `task_queue.json` in the live checkout with a
dry-run plan — no value, and it keeps a path that only a one-line regression separates
from running an agent on prod. Real agent work already runs on GitHub Actions
(`.github/workflows/agent-task.yml`). Disable the timer; leave `roxira-dispatcher.service`
handling the (token-gated) manual endpoint only if the owner still wants it.

```bash
# owner-run, on the server
sudo systemctl disable --now roxira-worker.timer
sudo systemctl status roxira-worker.timer   # expect: disabled, inactive
```

### `roxira-autodaemon.timer` → **sandbox (keep the health signal)**
The daemon provides useful uptime/health visibility and self-heal, but it drives the
Docker socket. Keep the function, tighten the blast radius: run it as a dedicated
unprivileged user that is only in the `docker` group, make the filesystem read-only
except its report directory, and pin the report path outside the checkout. If the owner
prefers minimal surface over the health dashboard, disable it instead (same commands as
above with `roxira-autodaemon.timer`) and rely on the existing `uptime.yml`/backup timers.

```bash
# owner-run, on the server — inspect current unit first
sudo systemctl cat roxira-autodaemon.service

# 1) confirm the deployed file is the no-git version (read-only check)
grep -n "git" /opt/roxira_platform/autonomous_master_daemon.py   # expect no matches
grep -n "dry_run" /opt/roxira_platform/output_apps/ecosystem_core/src/factory/task_worker.py

# 2) add a hardening drop-in
sudo systemctl edit roxira-autodaemon.service
```

Drop-in content (adjust `User=` to a real unprivileged account that is in the `docker`
group):

```ini
[Service]
User=roxira-audit
Group=roxira-audit
Environment=ROXIRA_REPORT_DIR=/opt/roxira_platform_reports
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/roxira_platform_reports
RestrictSUIDSGID=true
LockPersonality=true
```

```bash
# owner-run, after editing
sudo systemctl daemon-reload
sudo systemctl restart roxira-autodaemon.timer
```

### Both timers — one-time verification before/after
Because the issue concerns a deploy that diverged from `origin/main`, the owner should
confirm the **deployed** files match this reviewed revision (no git push, worker dry-run
only) before re-enabling anything:

```bash
# owner-run, on the server (read-only)
cd /opt/roxira_platform
git rev-parse HEAD
grep -nE "git (add|commit|push)|opencode|subprocess" autonomous_master_daemon.py
grep -nE "dry_run|git |opencode" output_apps/ecosystem_core/src/factory/task_worker.py
```

### Enqueue path (adjacent, flagged)
`roxira-dispatcher.service` (`factory_dispatch_api.py`) is the only network enqueue
vector for the worker. Confirm it is loopback-only and that `FACTORY_DISPATCH_TOKEN` is
either set (and rotated) or intentionally unset:

```bash
# owner-run, on the server (read-only)
ss -ltnp | grep 8005                       # expect 127.0.0.1:8005
grep -n "FACTORY_DISPATCH_TOKEN" /opt/roxira_platform/.env   # names only, do not print value
```

---

## 4. خلاصه فارسی (Persian summary)

**دامنه:** بررسی فقط‌خواندنی. هیچ چیزی روی سرور اجرا نشد و هیچ کدی تغییر نکرد.

- **`roxira-worker.timer` (هر ۵ دقیقه) → `task_worker.py`:** صف را از فایل
  `/opt/roxira_platform/task_queue.json` می‌خواند (جدول دیتابیس نیست؛ فایل داخل خود
  checkout است). هر تسک را با `dry_run=True` به `agent_runner.process_one_issue()`
  می‌دهد؛ یعنی فقط پیش‌نمایش می‌سازد و **هیچ LLM، `opencode`، کد تولیدشده یا شل اجرا
  نمی‌کند** و **به git پوش نمی‌کند**. تنها نوشتنش، بازنویسی همان `task_queue.json` داخل
  `/opt/roxira_platform` است. مسیر ثبت تسک: فایل + اندپوینت
  `POST /api/v1/factory/dispatch` در `factory_dispatch_api.py` که اکنون توکن
  `X-Factory-Token` می‌خواهد (اگر `FACTORY_DISPATCH_TOKEN` تنظیم نشده باشد، غیرفعال است)
  و روی `127.0.0.1:8005` گوش می‌دهد (از طریق nginx با basic auth قابل دسترس است).
  `backlog_auto_feeder.py` هم می‌تواند صف را پر کند ولی در درخت فعلی هیچ‌کس آن را صدا
  نمی‌زند. کلیدهای محیطی: `AGENT_ENABLED`, `AGENT_RUNTIME`, `AGENT_USE_WORKTREE`,
  `AGENT_DAILY_BUDGET_USD`, `AGENT_MAX_CONCURRENT`, `AGENT_TASK_TIMEOUT_SECS`,
  `AGENT_LEDGER_PATH`, `AGENT_LOCK_DIR`, `AGENT_WORKTREES_ROOT`, `AGENT_OPENCODE_MODEL`,
  `GITHUB_REPO`, `GITHUB_AGENT_TOKEN`, `OPENROUTER_API_KEY` (در مسیر dry-run هیچ‌کدام ارسال
  نمی‌شوند).
- **`roxira-autodaemon.timer` (هر ۳۰ دقیقه) → `autonomous_master_daemon.py`:** فقط پایش
  سلامت است؛ ۹ کانتینر را با `docker inspect` می‌خواند، کانتینرهای ناسالم را
  `docker restart` می‌کند، چند اندپوینت لوکال (FastAPI/Qdrant/Twenty) را تست می‌کند و یک
  اسنیپت پایتون **ثابت و هاردکد** را با `docker exec` اجرا می‌کند. **هیچ LLM یا کد
  تولیدشده‌ای اجرا نمی‌کند** و **به git پوش نمی‌کند**. گزارش را به‌طور پیش‌فرض بیرون از
  مخزن (`/opt/roxira_platform_reports`) می‌نویسد، مگر اینکه `ROXIRA_REPORT_DIR` به داخل
  checkout تغییر داده شود. کلیدهای محیطی: `ROXIRA_REPORT_DIR` و
  `ROXIRA_RADAR_REPORT_JSON`.
- **تاریخچه:** قبلاً هر دو اسکریپت مستقیم روی `main` کامیت/پوش می‌کردند (همان کامیت‌های
  `chore(daemon)` و حادثهٔ `0ba8275`). نسخهٔ فعلی مخزن دیگر پوش نمی‌کند؛ اما چون سرور
  ممکن است از مخزن جلو/عقب افتاده باشد، مالک باید تطابق فایل مستقرشده را تأیید کند.
- **توصیه:**
  - `roxira-worker.timer` → **غیرفعال شود** (`sudo systemctl disable --now
    roxira-worker.timer`): تنها اثر باقی‌مانده‌اش بازنویسی فایل صف داخل checkout است و
    فقط یک خط تا اجرای واقعی عامل روی سرور فاصله دارد.
  - `roxira-autodaemon.timer` → **سندباکس شود** (یا در صورت بی‌نیازی به داشبورد، غیرفعال):
    اجرا با کاربر غیرروت عضو گروه `docker`، `ProtectSystem=strict` و
    `ReadWritePaths=/opt/roxira_platform_reports`. دستورات کامل در بخش ۳.
  - **قاعده:** کد نوشته‌شده توسط مدل/عامل هرگز نباید روی هاست تولید اجرا شود؛ وظایف
    واقعی عامل از قبل در GitHub Actions اجرا می‌شوند.