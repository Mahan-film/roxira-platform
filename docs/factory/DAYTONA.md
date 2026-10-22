# Daytona backend for the workbench checks

The software factory runs per-run checks (tsc/eslint/jest/ruff/pytest) with
`scripts/infra/server_agents/workbench.sh`. By default they run in Docker on srv1, which is short on
RAM/disk. This backend runs the **same groups** in a disposable [Daytona](https://app.daytona.io)
sandbox instead, so heavy builds and tests do not compete with the live stack
(decision: `docs/strategy/SUITE_V2_COMPOSABLE_2026-10-22.md`).

Files:

- `scripts/infra/server_agents/daytona_runner.py` — remote plumbing (create sandbox, upload worktree,
  exec groups, delete sandbox). The check commands are **not** duplicated: it reads them from
  `workbench.sh --emit-groups`.
- `scripts/infra/server_agents/workbench.sh` — `WORKBENCH_BACKEND=local|daytona` (default `local`).
- `scripts/infra/server_agents/tests/test_daytona_runner.py` — unit tests with a mocked client (no network).

## How it works

1. `workbench.sh` selects the groups from the changed files (unchanged logic) and writes them with
   `--emit-groups` as JSON (`{groups:[{name,kind,dir,cmd,eslint_prefix,files,base_files}],error}`).
2. `daytona_runner.py` creates one sandbox from the default snapshot (Node 22 + Python 3.12), uploads the
   worktree as a gzipped tarball and extracts it under `/tmp/wb/work`.
3. Each group runs in the sandbox with the exact command string workbench uses; dependencies are installed
   once per package (`npm ci --ignore-scripts`; a Python venv from `ci/requirements-test.txt` + ruff).
4. The runner writes the **same JSON shape** workbench writes plus `"backend":"daytona"`:
   `{groups:[{name,cmd,status,seconds,tail}],ok,backend}`.
5. The sandbox is **always deleted** (`finally`); auto-stop is 15 min as a backstop.

Privacy: the tarball never contains `.env*` (asserted before upload), `.git/`, `data/`, `node_modules/`,
`*.sql` or `*.tar.gz`, and only `NODE_ENV`/`CI` may be forwarded from srv1 — no other environment
variable is sent.

Cost guard: at most `WORKBENCH_DAYTONA_MAX` (default **2**) sandboxes at once, each **1 vCPU / 2 GB RAM /
5 GB disk**, **15 min** auto-stop. When the sandbox cannot start (quota, API error, at capacity) the
runner exits `3`; workbench then runs the checks locally and records `"backend":"local-fallback"`.

## Switching the taskq service to daytona

The queue worker (`roxira-taskq.service`) launches `taskq.py run`, which calls `run_task.sh`, which calls
`workbench.sh`. So one environment variable on the service is enough to move every check to Daytona.

1. Put the Daytona key where the **service** can read it — the key lives in the srv1 `.env`, but the unit
   only loads `/etc/roxira/taskq.env` (0600, root). Add both lines there:

   ```bash
   install -m 0600 /dev/null /etc/roxira/taskq.env
   cat >> /etc/roxira/taskq.env <<'EOF'
   WORKBENCH_BACKEND=daytona
   DAYTONA_API_KEY=<the key from the srv1 .env>
   EOF
   ```

   (Prefer copying the value by hand; do not add `EnvironmentFile=/opt/roxira_platform/.env`, that would
   expose every prod secret to the worker.)

2. Restart the worker and watch one run:

   ```bash
   systemctl restart roxira-taskq
   systemctl --no-pager status roxira-taskq | head -n 8
   journalctl -u roxira-taskq -n 50 --no-pager | grep -i daytona
   ```

3. In `results.jsonl` the check record's `checks` file now has `"backend":"daytona"` (or
   `"local-fallback"` if a sandbox could not start). To force a single dispatch over Daytona without
   touching the service:

   ```bash
   WORKBENCH_BACKEND=daytona DAYTONA_API_KEY=... \
     /opt/roxira_platform/scripts/infra/server_agents/run_task.sh --task-file /tmp/t.md --scope docs/
   ```

## Back to local

Remove the two lines from `/etc/roxira/taskq.env` (or set `WORKBENCH_BACKEND=local`) and
`systemctl restart roxira-taskq`. Local mode is unchanged and is also the automatic fallback.

## Knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORKBENCH_BACKEND` | `local` | `daytona` runs the checks remotely |
| `DAYTONA_API_KEY` | — | required for the daytona backend (never printed) |
| `WORKBENCH_DAYTONA_MAX` | `2` | max concurrent sandboxes (cost guard) |
| `WORKBENCH_DAYTONA_CLIENT` | `auto` | `auto` prefers the `daytona` SDK, else REST; force `sdk`/`rest` |
| `WORKBENCH_DAYTONA_SNAPSHOT` | account default | snapshot to boot (should have Node 22 + Python 3.12) |
| `WORKBENCH_DAYTONA_RUNNER` | `…/daytona_runner.py` | override the runner path (tests) |
| `DAYTONA_API_URL` | `https://app.daytona.io/api` | REST base URL |
| `WB_GROUP_TIMEOUT` / `WB_TOTAL_TIMEOUT` | `480` / `900` | per-group / overall seconds |

Verify locally (no network, no sandbox): `bash scripts/infra/server_agents/tests/test_workbench.sh`,
`python3 -m pytest scripts/infra/server_agents/tests/test_daytona_runner.py`,
`python3 scripts/infra/server_agents/daytona_runner.py --help`.

## فارسی (خلاصه)

بک‌اند Daytona همان گروه‌های چک ورک‌بنچ (tsc/eslint/jest/ruff/pytest) را در یک سندباکس موقت اجرا می‌کند
تا RAM/دیسک srv1 درگیر نشود. فرمان‌ها تکرار نشده‌اند و با `workbench.sh --emit-groups` خوانده می‌شوند.
- برای فعال‌کردن سرویس صف: `WORKBENCH_BACKEND=daytona` و `DAYTONA_API_KEY` را در `/etc/roxira/taskq.env`
  بگذارید و `systemctl restart roxira-taskq` را بزنید.
- هیچ `.env*`ی آپلود نمی‌شود (assert)، فقط `NODE_ENV/CI` فرستاده می‌شود، حداکثر ۲ سندباکس همزمان با
  ۱ vCPU / ۲GB RAM / ۵GB دیسک و auto-stop ۱۵ دقیقه؛ سندباکس همیشه حذف می‌شود.
- اگر سندباکس بالا نیاید، به‌صورت خودکار به حالت محلی برمی‌گردد و `"backend":"local-fallback"` ثبت می‌شود.
