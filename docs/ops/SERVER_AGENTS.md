# Server-side agent runner (low-cost routine coding)

Routine coding tasks run **on the production server** with free or cheap models through OpenCode, instead of
spending Claude tokens. The hub dispatches over ssh, the agent works in an isolated git worktree and the result
is an `agent/*` branch that the hub reviews and turns into a PR. Agents never push to `main` and never touch
the live checkout `/opt/roxira_platform`.

Files: `scripts/infra/server_agents/setup.sh`, `scripts/infra/server_agents/run_task.sh`, model roles
`agent_runner` and `agent_runner_public` in `config/models.yaml`.

## 1. One-time setup (owner)

```bash
# a) Groq keys (3 keys, one account), from the Mac, hidden input, one at a time:
scripts/ops/set_server_env.sh GROQ_API_KEY
scripts/ops/set_server_env.sh GROQ_API_KEY_2
scripts/ops/set_server_env.sh GROQ_API_KEY_3
# b) get the scripts onto the server (after the PR is merged), then run setup. -t is needed for the hidden prompt:
ssh roxira-prod 'git -C /opt/roxira_platform pull --ff-only'
ssh -t roxira-prod '/opt/roxira_platform/scripts/infra/server_agents/setup.sh'          # add --dry-run first if you like
# c) verification (calls the model once, throwaway worktree, nothing pushed):
ssh roxira-prod '/opt/roxira_platform/scripts/infra/server_agents/run_task.sh --smoke'
```

Expected: `SMOKE PASS: groq-fast created exactly docs/agents/SMOKE.md (one line)` and a JSON line with `"smoke_ok": true`.

`setup.sh` is idempotent. It creates: user `roxira-agent` (no login, no ssh key), `/etc/roxira/opencode-agents.json`
and `/etc/roxira/agent-aliases.tsv` (rendered from `config/models.yaml`), `/var/lib/roxira-agents/{repo.git,worktrees,home,xdg,logs}`,
and optionally `/etc/roxira/agents.env` (0600) with `OPENROUTER_API_KEY_AGENTS` (hidden prompt, optional; use a
**separate** OpenRouter key with a spend limit, not the prod key). Groq keys are not asked for again: they are
read from `/opt/roxira_platform/.env` (names only, never printed). The global `/root/.config/opencode` is not read or changed.

## 2. How the hub dispatches a task

```bash
ssh roxira-prod 'cat > /tmp/task.md' < task.md        # or --task "text"
ssh roxira-prod '/opt/roxira_platform/scripts/infra/server_agents/run_task.sh \
    --model groq-strong --task-file /tmp/task.md --scope docs/ops/ --scope scripts/infra/ --push' | tail -n 1
```

Options: `--model groq-fast|groq-strong|ds-flash|free-public`, `--scope PATH` (repeatable; edits outside it are
refused and reported), `--public` (required for `:free`), `--push`, `--timeout SECS` (default 900), `--slug`,
`--cleanup`, `--no-fallback`, `--dry-run`, `--list`.

Flow: fetch `origin/main` into the agents' own bare clone -> worktree `/var/lib/roxira-agents/worktrees/<date>-<slug>`
on new branch `agent/<date>-<slug>` -> `opencode run` under `timeout` as `roxira-agent` -> **the runner** commits
(the agent may not) -> scope/secret check -> stat + diff (first 600 lines) -> with `--push`, push of that
`agent/*` branch only (never `main`, never force) -> one JSON line, always the last line of stdout:

```json
{"ok": true, "branch": "agent/20261013-0310-fix-docs", "files_changed": 2, "files": ["docs/x.md", "docs/y.md"],
 "exit_code": 0, "model": "groq/openai/gpt-oss-120b", "alias": "groq-strong", "duration_s": 41, "pushed": true,
 "violations": [], "rate_limited": false, "groq_key_index": 1, "events": [], "log": "/var/lib/roxira-agents/logs/....log"}
```

Results come back as the branch: the hub runs `git fetch origin agent/...`, reviews the diff (`/review-diff`, a
different model family than the author), opens a PR and merges only through the normal green-PR path. A run with no
changes leaves no worktree or branch. `results.jsonl` in the logs dir keeps every JSON line. Logs can echo prompts:
read them on the server, do not paste them around.

## 3. Cost policy and failover

1. **Groq free tier first** (`groq-fast` = `openai/gpt-oss-20b`, `groq-strong` = `openai/gpt-oss-120b`). Groq works from the server IP.
2. **DeepSeek V4.1 Flash second** (`ds-flash`, paid, standard data policy) through `OPENROUTER_API_KEY_AGENTS`.
3. **`:free` OpenRouter models only for public code** (`free-public`, needs `--public`): providers may log or train on prompts.
   Customer/case data never goes to them (AGENTS.md section 4).

Groq keys: key 1 is used; **only on an auth error (401/403, revoked or bad key) the next key is tried**.
Keys are never rotated to get around rate limits. On 429 the runner backs off once (30 s) on the same key, then falls
back to `ds-flash` (if an agents OpenRouter key exists and the task is not public-only), otherwise stops with
`"rate_limited": true`. Every failover/fallback is listed in `events` (key numbers only, never values).

## 4. Limits and safety

- Agent edits are limited to `--scope`; `.env*`, `data/`, `database_snapshots/`, `*.sql`, `*.pem`, `*.key`, `*.tar.gz`,
  `secrets/` are denied for read and edit in the OpenCode permission block, and are excluded from the worktree by sparse-checkout.
  The repo's own `opencode.json` and `.claude/` are excluded as well (project config would override ours).
- Bash is an allowlist (`ls`, `grep`, `git diff|status|log|show`, `py_compile`, `ruff check` ...); network tools, `git commit/push`, `rm`, `sudo`, reading `/etc`,`/opt`,`/root` are denied.
  This is best effort; the real boundary is the unprivileged `roxira-agent` user (setup warns if it can read `.env` or agents.env).
- The agent process does see its own LLM key in its environment (one key at a time, spare keys are never exported).
- Never run tests over `src/` or the repo root here. Allowed checks are the CI ones only.
- Groq free-tier daily token limits apply; a big task may need `ds-flash`. Default timeout 900 s, `--kill-after 15`.
- Ports: nothing listens; no new service is started.

## 4b. Workbench checks (automatic, per run)

After the runner has committed, `run_task.sh` calls `scripts/infra/server_agents/workbench.sh <worktree>` (skip with
`--no-checks`; never for `--smoke` or runs without changes). It picks check groups from the changed files only:
frontend -> `tsc --noEmit` + `eslint`; enterprise_hub -> `tsc` + `jest --findRelatedTests`; `*.py` -> `ruff` (only
F821/F822/F823/E9 block, the rest is reported) + `pytest` on changed test files or `tests/test_<module>.py` next to
changed modules (only `scripts/**/tests`, `smartjudge/tests`; never `src/` or the repo root); `*.sh` -> `bash -n`.

- Each group runs in a throwaway docker container (`node:20-bookworm-slim`, `python:3.12-slim`): worktree read-only at `/w`,
  `--network none --memory 2g --pids-limit 512 --cap-drop ALL --security-opt no-new-privileges`, uid 1000, read-only rootfs.
- Dependencies sit in named volumes keyed by lockfile hash: `rx-nm-<dir>-<hash12>` (`npm ci --ignore-scripts`) and
  `rx-py-<hash12>` (`ci/requirements-test.txt` + ruff). Only the one-time populate container has network. Old volumes are
  not pruned automatically: `docker volume ls -f name=rx-` and remove stale ones by hand.
- Timeouts: 8 min per group, 15 min total. Result: `<run log>.checks.json` (`{groups:[{name,cmd,status,seconds,tail}],ok}`);
  `results.jsonl` gets `checks_ok` and `checks`, and the owner-bot line gets `checks=ok(n)` or `checks=FAIL(group,...)`.
  Checks are advisory: they never change `run_task.sh`'s exit code or block the push.
- Manual: `workbench.sh <worktree> [--base origin/main] [--json out.json]`; `--dry-run` prints the groups without docker.
  Test of the selection logic (no docker): `bash scripts/infra/server_agents/tests/test_workbench.sh`.

## 5. Stopping it

- One run: `pkill -f 'opencode run'` (the `timeout` wrapper ends within 15 s anyway).
- Disable entirely: `chmod 000 /opt/roxira_platform/scripts/infra/server_agents/run_task.sh` or remove the Groq keys from `.env`; the hub simply stops dispatching.
- Clean up per branch (no bulk deletes): `git --git-dir=/var/lib/roxira-agents/repo.git worktree remove --force <path>` and
  `git --git-dir=/var/lib/roxira-agents/repo.git branch -D agent/<name>`. `run_task.sh --list` shows what exists.

## 6. Moving to the new server

Everything lives in `/etc/roxira` and `/var/lib/roxira-agents` and is rebuilt by the script: run
`scripts/infra/bootstrap_new_server.sh --agents` (calls `setup.sh --skip-keys`), put the Groq keys into the new
`.env`, re-run `setup.sh` for the OpenRouter agents key, then `run_task.sh --smoke`. No state needs copying.

## 7. OpenCode "UnknownError" on the server: diagnosis

Observed: `opencode run -m openrouter/qwen/qwen3.8-27b:free` -> `UnknownError`; the global config points to the dead LiteLLM pool (127.0.0.1:4000).
The server could not be inspected from the build sandbox (ssh blocked), so this is **reproduced locally, not yet confirmed on the server**:

- Reproduced with opencode 1.18.34: when the provider key env var (`OPENROUTER_API_KEY`) is empty/unset, `opencode run` prints
  `UnknownError / Unexpected server error` for **any** model id, even a nonexistent one. With a key present the real error appears
  (`AI_APICallError: ...`). So an opaque UnknownError most likely means the provider did not load: the key is not in the environment
  of a non-interactive `ssh host cmd` (the key sits in `/opt/roxira_platform/.env`, which a bare shell does not source) or the id is unknown.
- `OPENCODE_CONFIG` does **not replace** the global config; configs are merged (global -> OPENCODE_CONFIG -> project `opencode.json` -> `OPENCODE_CONFIG_CONTENT`).
  So the dead `pool` provider and the repo's `opencode.json` (`enabled_providers` without groq) stay in effect. The runner therefore gives opencode
  its own `HOME` and `XDG_*` dirs, excludes the repo's `opencode.json` from the worktree, sets `OPENCODE_DISABLE_PROJECT_CONFIG=1` and passes the final config via `OPENCODE_CONFIG_CONTENT`.
- `Failed to fetch models.dev` appears in the log but is non-fatal (bundled snapshot). Runner sets `OPENCODE_DISABLE_MODELS_FETCH=1` and lists models explicitly.
- OpenCode also makes a small "title" call with a default small model; the runner sets `small_model` to the task model so no second provider is used.
- Free OpenRouter models can additionally fail with "No endpoints found that support tool use" (opencode issue 1002): treat `free-public` as best effort.

To confirm on the server (read-only, owner/hub): `env -u OPENROUTER_API_KEY opencode run -m openrouter/x/y hi` should give the same UnknownError; then
`set -a; . /opt/roxira_platform/.env; set +a; opencode run --print-logs --log-level DEBUG -m openrouter/deepseek/deepseek-v4.1-flash hi 2>&1 | grep -i error` shows the real cause (and `~/.local/share/opencode/log/` holds the full log).
Do not use the global config for agents; use `run_task.sh`.

## فارسی (خلاصه)

این ابزار کارهای کدنویسی روتین را روی خود سرور و با مدل‌های رایگان/ارزان (اول Groq، بعد DeepSeek Flash، و مدل‌های `:free` فقط برای کد عمومی) اجرا می‌کند تا توکن Claude خرج نشود.
- یک بار: سه کلید Groq را با `scripts/ops/set_server_env.sh` (ورودی مخفی) در `.env` سرور بگذارید، سپس `setup.sh` و بعد `run_task.sh --smoke` را اجرا کنید (دستورها در بخش ۱).
- هاب با ssh تسک می‌فرستد؛ نتیجه یک شاخه `agent/*` است که هاب بازبینی می‌کند و به PR تبدیل می‌شود. ایجنت هرگز به `main` پوش نمی‌کند و به `.env`، `data/` و فایل‌های مشتری دسترسی ندارد.
- فیل‌اور کلید Groq فقط هنگام خطای احراز هویت (401/403) به کلید بعدی می‌رود، نه برای دور زدن محدودیت نرخ. در خطای 429 یک بار صبر می‌کند و بعد به DeepSeek Flash می‌رود.
- توقف: `pkill -f 'opencode run'` یا برداشتن کلیدها. روی سرور جدید با `bootstrap_new_server.sh --agents` همان‌طور منتقل می‌شود.
- علت احتمالی `UnknownError`: کلید ارائه‌دهنده در محیط ssh غیرتعاملی نیست (محلی بازتولید شد، روی سرور هنوز تأیید نشده)، و تنظیمات سراسری `pool` با تنظیمات دیگر ادغام می‌شود نه جایگزین. ران‌نر خودش HOME/XDG جدا دارد.
## 8. Task queue (F2)

`scripts/infra/server_agents/taskq.py` queues tasks in SQLite (`/var/lib/roxira-agents/taskq.db`) and runs them through
`run_task.sh` with an escalation ladder, so the hub no longer launches, retries and collects by hand.

```bash
T=/opt/roxira_platform/scripts/infra/server_agents
python3 $T/taskq.py add --slug fix-docs --task-file /tmp/task.md --scope docs/ops/ --public --priority 5 \
    --accept 'bash -n scripts/x.sh'            # --accept is stored for the hub only, never run by the queue
python3 $T/taskq.py list --status queued       # also: show <id>, cancel <id>, retry <id>
python3 $T/taskq.py run --once --stagger 15    # one-shot drain; the service runs `run --max-parallel 5`
bash $T/taskq_install.sh                       # dry-run; add --apply to install systemd unit roxira-taskq
```

Ladder (default `free,ds-flash,strong`, set per task with `--ladder`): `free` = `--gateway --public` (skipped unless the
task is `--public`), `ds-flash` = `--model ds-flash`, `strong` = `--model $TASKQ_STRONG_ALIAS` (skipped when unset;
put it in `/etc/roxira/taskq.env`). Each attempt uses slug `<slug>-aN`. Success = result `ok` and `checks_ok` true (or
missing) and files non-empty. On failure the next step runs on a copy of the task file with a
"previous attempt failed: ..." note (failing check names + output tail). Ladder exhausted -> `failed`.
On success the patch is written to `/var/lib/roxira-agents/patches/<id>-<slug>.patch` and `show <id>` has the branch,
worktree and files. Every state change is sent to the owner bot (best effort). `TASKQ_MAX_ATTEMPTS_PER_DAY`
(default 30, rolling 24 h) stops new attempts. After a restart, `running` tasks whose process is gone return to `queued`.

