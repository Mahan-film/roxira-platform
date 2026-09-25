# W10 — Safe, Cheap Agent Workforce (design)

Status: **proposal, not yet implemented on the server.** This document is the design the
owner asked to see before any systemd unit, cron job, or firewall rule is touched. Nothing
here is wired up to run unattended yet.

## 1. Inventory: what actually runs today (verified 2026-09-24)

### Server-side automation (`ssh 5.75.200.67`, `/opt/roxira_platform`)

| Unit | Trigger | Script | What it does | Pushes to `main`? |
| --- | --- | --- | --- | --- |
| `roxira-dispatcher.service` | always-on (`systemctl enabled`) | `factory_dispatch_api.py` | Raw `http.server` on **`0.0.0.0:8005`**, no auth. `GET /factory` dashboard, `GET /api/v1/factory/status`, `POST /api/v1/factory/dispatch` appends `{prompt}` to `task_queue.json` and spawns `task_worker.py`. | indirectly (via worker) |
| `roxira-worker.timer` | every 5 min, and directly spawned by the dispatcher | `output_apps/ecosystem_core/src/factory/task_worker.py` | Pops one pending task, runs `roxira_factory_engine.py <id> <prompt>` as a subprocess **in the live checkout**, then `git add -A && git commit && git push origin main`. | **yes, every run** |
| `roxira-autodaemon.timer` | every 30 min | `autonomous_master_daemon.py` | Health/audit only (containers, `/judge/health`, damages calculator, Qdrant, TTS, Twenty CRM), `docker restart`s unhealthy containers, writes `autonomous_dashboard.json`, then `git add -A && git commit "chore(daemon): ... all green" && git push origin main`. | **yes, every run** — this is the commit whose 2026-09-23 run (`0ba8275`) deleted a function and took ~50 Smart Judge routes down until PR #7 |
| `roxira-radar.timer` | every 6 h | `tech_radar_sentinel.py` | Tech-radar scan, writes `tech_radar_report.json`. Not yet confirmed to push (no push/commit call found in the file). | no (needs re-check if the script changes) |
| — | manual, ad hoc | `master_swarm_orchestrator.py` | Has its own `agent_gitops_commit()` that commits and pushes to `main` directly. Not on a timer today, but a standing landmine if anyone runs it. | **yes** |
| — | manual only | `launch_agents.sh` | Interactive menu: run OpenCode TUI, run Aider, run `tsc`/`py_compile`, or commit+push+SSH-deploy. Human-driven, not a daemon. | yes, if the human picks option 4 |
| — | manual only | `run_opencode_repair.sh` | Despite the name, this is a **hardcoded heredoc** that overwrites one frontend component and restarts prod containers. Not agent-driven, no git step at all — a break-glass script, out of scope for this workstream. | no |

**Root cause of the ~48 commits/day noise (W3 in `docs/STRATEGY.md`):** the daemon and the worker both commit straight to `main` on every cycle, with no branch, no PR, and no CI gate — CI is explicitly configured to skip these paths (`.github/workflows/ci.yml` `paths-ignore`) rather than review them.

**Security finding (new, unrelated to the W10 ask but found while inventorying):** `roxira-dispatcher` listens on `0.0.0.0:8005` and is **not** in the `DOCKER-USER` firewall chain (which only blocks 4000/4001/3000/6432). Its `POST /api/v1/factory/dispatch` endpoint has no auth and, via the worker, ends in an unreviewed push to `main`. This is reachable from the public internet today. Recommend closing 8005 to loopback/VPN immediately regardless of what happens with W10 — flagged separately below.

### Agent runtimes installed on the server

| Tool | Version | Config | Model | Notes |
| --- | --- | --- | --- | --- |
| Goose | 1.50.0 | `~/.config/goose/config.yaml` | provider `openrouter`, model `deepseek/deepseek-chat` | Invoked only from `roxira_factory_engine.py`'s `auto_heal_with_goose()`: `goose run --text "fix <file>"` with a 60 s timeout, output discarded, **no git worktree — edits the live checkout in place**. Telemetry off. |
| OpenCode | 1.18.30 | `~/.config/opencode/opencode.json` | `openrouter/deepseek/deepseek-v4.1-flash` | **`"permission": "allow"`** — runs shell commands and edits with zero confirmation. Currently only reachable via the interactive `launch_agents.sh` menu; no daemon calls it today. |
| `gh` CLI | not installed | — | — | PR automation will need either `gh` or plain GitHub REST calls via `curl` + a token. |
| `llm_client.py` (repo) | — | reads `OPENROUTER_API_KEY` from env/`.env` | fallback pool: `deepseek/deepseek-chat` → `gemini-2.0-flash-001` → `llama-3.3-70b-instruct` | No per-day cost cap, no cost log — this predates and is separate from the product's own tiered router (`output_apps/generated_modules/smartjudge/llm_router.py`, W5). |

### Task intake today

`task_queue.json` (flat file, committed to the repo) + `backlog_auto_feeder.py`, which refills the queue with 4 hardcoded prompts whenever it's empty, plus the unauthenticated dispatcher POST above. There is no GitHub issue integration and no budget/concurrency limit anywhere in this path.

## 2. Design: agents never push to `main`

Rule: **every cheap-agent task runs in its own git worktree on its own branch, commits there, and opens a PR. Nothing but a human or a Claude review session merges to `main`.**

```
GitHub issue (label: agent)  ─┐
task_queue.json (fallback)    ├─▶ dispatcher ─▶ worktree+branch ─▶ agent (OpenCode/Goose,
                               ┘                                    OpenRouter cheap tier)
                                                                        │
                                                                        ▼
                                                        commit in worktree, push branch,
                                                        `gh`/REST PR against main
                                                                        │
                                                                        ▼
                                                              CI runs on the PR (existing
                                                              .github/workflows/ci.yml)
                                                                        │
                                                                        ▼
                                                        human or Claude review → merge
```

Concretely:

1. **Worktree per task.** `git worktree add /opt/roxira_platform/.agent-worktrees/<task-id> -b agent/<task-id> origin/main`. The agent process runs with that directory as its cwd and its git identity scoped to that worktree — it physically cannot commit to the checkout other services use.
2. **OpenCode config for agent tasks** gets its own config (not the interactive one), pointed at the cheap tier (DeepSeek/Qwen via OpenRouter) and run non-interactively with a fixed permission set (edit + run tests, no arbitrary shell) rather than today's global `"permission": "allow"`. Goose's `auto_heal_with_goose()` call moves into the same worktree instead of patching the live checkout.
3. **PR, not push.** After the agent finishes, the wrapper does `git push origin agent/<task-id>` and opens a PR (`gh pr create` if we install `gh`, otherwise a `curl` call to the GitHub REST API with a repo-scoped PAT — no new binary needed). PR body includes the task id, the prompt, and the agent's own summary.
4. **CI must pass.** No change needed to `.github/workflows/ci.yml` — it already runs on every PR. We just stop the `paths-ignore` push-to-main path from bypassing it, because there's no push-to-main path anymore.
5. **Merge stays human or Claude.** No auto-merge is configured. The owner or a Claude review session merges.
6. **Daemon reports move off git.** `autonomous_master_daemon.py`'s dashboard JSON stops being committed at all — it's already written to a served static path (`output_apps/enterprise_hub/frontend/public/autonomous_dashboard.json`); write it there (or to a small non-git directory nginx also serves, e.g. `/opt/roxira_platform/.reports/`) and drop the `git add/commit/push` block entirely. Same for `tech_radar_sentinel.py` if it turns out to push. This alone removes the ~48 commits/day.

## 3. Task intake

- **Primary:** GitHub issues labelled `agent`. Dispatcher polls the GitHub REST API (`GET /repos/mahan-films/roxira-platform/issues?labels=agent&state=open`) instead of accepting anonymous POSTs.
- **Fallback / manual queue:** keep `task_queue.json` for tasks the owner queues locally, but the dispatcher becomes the only writer — the public `POST /api/v1/factory/dispatch` endpoint either gets removed or moved behind auth and loopback-only, closing the exposure in §1.
- **Per-day budget:** the router's cost log (W5, `output_apps/generated_modules/smartjudge/llm_router.py`) already tracks token cost; extend the same log (or a sibling one) to cover agent-task spend, and have the dispatcher refuse to start a new task once today's agent spend crosses a configurable `AGENT_DAILY_BUDGET_USD`.
- **Concurrency:** dispatcher tracks how many `agent/*` worktrees are currently active (i.e. have an open PR) and refuses new dispatches above `AGENT_MAX_CONCURRENT` (proposed default: 2, given the cheap-model/low-RAM box).

## 4. Which work goes where

| Goes to cheap agents (OpenCode/Goose, DeepSeek/Qwen via OpenRouter) | Stays with Claude |
| --- | --- |
| Mechanical refactors (rename, extract function, dedupe) | Architecture and system design |
| Adding/expanding unit tests for existing behavior | Security review, secrets handling, anything touching auth/payments (Zibal) |
| Docs, docstrings, changelog entries | Anything that touches `docker-compose.prod.yml`, nginx, or systemd units |
| Bulk mechanical edits (e.g. the ~55-file DB-password-in-DSN cleanup pattern from W2) | CI/workflow changes |
| Formatting/lint fixes flagged by CI | Reviewing and merging agent PRs |
| Filling in generated-module boilerplate (`output_apps/generated_modules/**`) once the shape is approved | Anything the factory pipeline currently free-hands into `main` without review (legal-drafting logic, damages calculations — customer-facing legal correctness) |

Rule of thumb: if a wrong answer is embarrassing or expensive (money, legal correctness, security, prod infra), it's Claude's. If a wrong answer is just a revert away, it can go to a cheap agent — but always through a PR and CI, never straight to `main`.

## 5. Open decisions for the owner

1. Install `gh` on the server, or use `curl` + a fine-grained PAT for PR creation? (No functional difference; `gh` is one more package to keep updated.)
2. `AGENT_DAILY_BUDGET_USD` and `AGENT_MAX_CONCURRENT` defaults — proposing $2/day and 2 concurrent to start, tunable in `.env`.
3. Close `roxira-dispatcher`'s port 8005 to loopback now, independent of the rest of W10 — recommended regardless of timing on the rest of this workstream.
4. Whether `roxira-worker.timer` / `roxira-autodaemon.timer` should be disabled/reworked in the same change, or done as a follow-up once the worktree+PR wrapper is proven on one task end-to-end.

**Nothing above has been enabled.** No systemd unit, cron entry, or firewall rule has been changed. Once the owner signs off on this design (and specifically on which pieces should run unattended), the next step is a PR implementing the worktree+PR wrapper and the daemon's git-push removal, tested against one real task before any timer is pointed at it.

## 6. Phase 2 implementation

`output_apps/ecosystem_core/src/factory/agent_runner.py` is the execution engine described in
§2-3, implemented as code (not yet deployed — see the owner steps below). It is local-code-only:
it never touches the live `/opt/roxira_platform` checkout, never pushes to `main`, and the only
server action this PR itself performs is a read-only `opencode --version` / `opencode run --help`
check.

### What it does, per invocation

1. Refuses to run unless `AGENT_ENABLED` is a truthy value (kill switch, **default off**).
2. Refuses to run if today's spend (summed from the JSONL ledger) is already at or above
   `AGENT_DAILY_BUDGET_USD`.
3. Lists open GitHub issues labelled `agent` (excluding ones already labelled `agent-pr-open`)
   via the GitHub REST API, using `GITHUB_AGENT_TOKEN`.
4. Takes one issue, acquires a lock file under `AGENT_LOCK_DIR` (refusing if
   `AGENT_MAX_CONCURRENT` tasks are already running, or this issue already has one — stale
   locks older than 3 hours are reclaimed automatically), and creates a git worktree
   **outside the repo**, under `AGENT_WORKTREES_ROOT`, on branch `agent/<issue>-<slug>` cut
   from `origin/main`.
5. Builds a prompt from the issue title/body plus this repo's `AGENTS.md` and an explicit
   "never push to main / no secrets / denylist" rule block, then runs
   `opencode run <prompt> --model <AGENT_OPENCODE_MODEL> --format json` in that worktree with a
   `AGENT_TASK_TIMEOUT_SECS` timeout.
6. If nothing changed, or the diff touches the denylist (`docker-compose*.yml`, `.github/**`,
   nginx confs, `*.service` systemd units, `.env*`, or anything that looks like an auth/payment/
   Zibal module), or `py_compile`/`ruff` (if installed) fails on the changed Python files: it
   comments on the issue explaining why and stops. No push, no PR.
7. Otherwise: commits in the worktree, pushes `agent/<issue>-<slug>` over HTTPS using
   `GITHUB_AGENT_TOKEN` (never printed — scrubbed from any error text), opens a PR against
   `main` via the REST API, comments the PR link on the issue, and labels the issue
   `agent-pr-open`.
8. Records the spend delta (OpenRouter `GET /api/v1/key` usage, read before and after the
   `opencode run` call) as one line in the ledger, removes the worktree, and releases the lock —
   in a `finally`, so this happens even if an earlier step raised.

`factory_dispatch_api.py`'s `POST /api/v1/factory/dispatch` (already loopback-only since phase 1)
now also requires a `X-Factory-Token` header matching `FACTORY_DISPATCH_TOKEN` from the
environment; with that variable unset (the default) the endpoint returns 503 and does nothing.
`task_worker.py` (the `task_queue.json` fallback path) no longer runs `roxira_factory_engine.py`
in the live checkout at all — it calls `agent_runner.process_one_issue()` instead, but always with
`dry_run=True`, since a queued `task_queue.json` entry has no real GitHub issue to comment on, push
a branch for, or open a PR against. It only previews the plan (worktree branch name, prompt) into
the queue file. The real, actionable path is the GitHub-issue `agent` label, run directly through
`agent_runner.py`'s own `main()`.

### Env vars

| Var | Default | Notes |
| --- | --- | --- |
| `AGENT_ENABLED` | off | `1`/`true`/`yes`/`on` to allow real runs |
| `AGENT_DAILY_BUDGET_USD` | `2` | |
| `AGENT_MAX_CONCURRENT` | `2` | |
| `AGENT_LEDGER_PATH` | `/opt/roxira_platform_reports/agent_ledger.jsonl` | JSONL, outside the repo |
| `AGENT_LOCK_DIR` | `<ledger dir>/locks` | |
| `AGENT_WORKTREES_ROOT` | `/opt/roxira_platform_agent_worktrees` | outside the repo |
| `AGENT_TASK_TIMEOUT_SECS` | `900` | |
| `AGENT_OPENCODE_MODEL` | `openrouter/deepseek/deepseek-v4.1-flash` | |
| `GITHUB_AGENT_TOKEN` | — (required, no default) | fine-grained PAT: contents + pull requests + issues, read/write, this repo only |
| `GITHUB_REPO` | `mahan-films/roxira-platform` | |
| `OPENROUTER_API_KEY` | — (required, no default) | used by `opencode run` itself and to measure spend |
| `FACTORY_DISPATCH_TOKEN` | — (unset = dispatch endpoint disabled) | shared secret for the legacy manual-dispatch HTTP endpoint |

### Verified against the server (read-only)

`ssh 5.75.200.67 'opencode --version; opencode run --help'` on 2026-09-25 confirms OpenCode
1.18.30 and the flags this code relies on: `run [message..] --model <provider/model> --format
{default,json}`, no separate cost flag (spend is measured via OpenRouter's key-usage endpoint
instead, as this section's env table implies).

### Manual one-task run (owner, before enabling any timer)

```bash
cd /opt/roxira_platform
export GITHUB_AGENT_TOKEN=...     # fine-grained PAT, added to .env
export OPENROUTER_API_KEY=...     # already in .env
export AGENT_ENABLED=1
python3 output_apps/ecosystem_core/src/factory/agent_runner.py --issue <N>
```

Or, to see the plan without a token or any push:

```bash
python3 output_apps/ecosystem_core/src/factory/agent_runner.py --dry-run --issue <N>
```

### Owner steps to go live

1. Add `GITHUB_AGENT_TOKEN` (fine-grained PAT: contents, pull requests, issues — read/write,
   this repo only) to the server's `.env`.
2. Create the `agent` and `agent-pr-open` labels on the GitHub repo (`gh label create agent`,
   `gh label create agent-pr-open` if `gh` gets installed, or via the GitHub UI/REST).
3. Restart `roxira-dispatcher` so it picks up the `FACTORY_DISPATCH_TOKEN` gate on
   `/api/v1/factory/dispatch` (only if that endpoint is still wanted at all — it is redundant
   with the GitHub-issue intake).
4. Open one real issue labelled `agent` describing a small, low-risk task (per §4's table) and
   run `agent_runner.py` by hand (above) to watch one task go end-to-end into a reviewable PR
   before pointing any timer at this.
5. Only after that one task is reviewed and merged: decide whether to put `agent_runner.py` on
   its own timer (separate from `roxira-worker.timer`/`roxira-autodaemon.timer`, per open
   decision 4 in §5).
