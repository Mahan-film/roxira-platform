# W9 live run: the 3 bake-off briefs on the production server

Status: **not run yet**. This is the exact command sequence for the owner to
approve and (someone with server access to) execute. This sandbox has no
OpenRouter/search-provider keys and no network egress to run it here (same
constraint noted in docs/research/bakeoff.md §1 and the W9 row of
`docs/STRATEGY.md`).

Goal: run the 3 bake-off benchmark briefs (docs/research/bakeoff.md §3)
through the real `--project-brief` pipeline, using the server's already
configured `OPENROUTER_API_KEY` / `BRAVE_API_KEY` / `EXA_API_KEY` /
`FIRECRAWL_API_KEY` / `JINA_API_KEY`, **without touching `/opt/roxira_platform`
at all** — everything happens in an ephemeral copy, under a hard $1.50 total
cost cap, cleaned up afterwards.

## Why this shape

- **No modification of `/opt/roxira_platform`.** The commands below never
  `cd` into it, never write to it, and never `git pull`/`git commit` there.
  Verification step 6 confirms `git status` is still clean afterwards.
- **Python env with the deps.** Verified 2026-09-24 (read-only `ssh`
  inspection): the bare host `python3` (3.12.3) does **not** have `httpx`
  installed (`ModuleNotFoundError: No module named 'httpx'`), which
  `output_apps/generated_modules/smartjudge/llm_router.py` requires. The
  `roxira_app_prod` container's `python3` (3.11.16) does (`httpx==0.28.1`),
  and `docker exec roxira_app_prod` already runs with `OPENROUTER_API_KEY`,
  `BRAVE_API_KEY`, `TAVILY_KEYS`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`,
  `JINA_API_KEY` already set in its process environment (confirmed live via
  `docker exec roxira_app_prod printenv`, no `--env-file` needed, key names
  only — never values) — no secrets file exists inside the container
  (`/app/.env` does not exist there), so there is nothing to `cat` or leak;
  the keys are just already-loaded process env.
- **Key-name aliasing fixed in this PR.** The server's `.env` uses
  `BRAVE_API_KEY` and `TAVILY_KEYS`, not the names
  `src/automation/web_intelligence.py`'s clients were hardcoded to
  (`BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEYS`) — both providers were silently
  "not configured" on every prior run despite valid keys being present.
  `provider_base.get_env_var_any()` now checks both names for each; step 3
  below verifies all of them read as present.
- **Isolation via `/tmp/w9run` inside the container**, not the host. `/app`
  inside `roxira_app_prod` is bind-mounted from `/opt/roxira_platform`
  (confirmed: `docker exec roxira_app_prod python3 -c "import
  src.automation.tech_radar as t; print(t.__file__)"` → `/app/src/...`). A
  plain `cp -a /app /tmp/w9run` *inside the container* makes an independent,
  writable copy on the container's own overlay filesystem (150G total, 81G
  free — `/app` itself is 1.3G) that the pipeline's `--brief-out` and history
  files can write into freely, with zero risk of touching the bind-mounted
  `/opt/roxira_platform` on the host.
- **$1.50 total cap, enforced by the code, not just documented.** Each of
  the 3 briefs runs with `--max-usd 0.50` (src/automation/budget_guard.py,
  added in this PR): before the run and before every subsequent paid call it
  reads `GET https://openrouter.ai/api/v1/key` and aborts before the next
  completion call would push spend past the cap. `--max-usd` fails the run
  immediately (non-zero exit, no partial spend) if usage can't be verified at
  all (e.g. key revoked) rather than proceeding unmetered.

## Command sequence

Run from your own machine; only `ssh`/`docker exec` cross onto the server.
Nothing below prints a secret value.

```bash
# 0. Sanity check: confirm the server's checkout matches origin/main and is
#    clean BEFORE starting (docs/STRATEGY.md "Before starting work" rule).
ssh 5.75.200.67 'cd /opt/roxira_platform && git fetch -q && git status --porcelain && git rev-parse HEAD && git rev-parse origin/main'
# Expect: no porcelain output (clean tree) and both rev-parse lines equal.

# 1. Make an ephemeral, container-local copy of /app — NOT of anything on
#    the host filesystem. Nothing under /opt/roxira_platform is written.
ssh 5.75.200.67 "docker exec roxira_app_prod bash -c '
  set -euo pipefail
  rm -rf /tmp/w9run
  cp -a /app /tmp/w9run
  mkdir -p /tmp/w9run/out
  echo copied \$(du -sh /tmp/w9run | cut -f1)
'"

# 2. Confirm the python env has the deps (httpx is the one llm_router.py needs).
ssh 5.75.200.67 "docker exec roxira_app_prod python3 -c 'import httpx; print(\"httpx\", httpx.__version__)'"

# 3. Confirm the required keys are present WITHOUT printing them.
ssh 5.75.200.67 "docker exec roxira_app_prod bash -c '
  for k in OPENROUTER_API_KEY BRAVE_API_KEY TAVILY_KEYS EXA_API_KEY FIRECRAWL_API_KEY JINA_API_KEY; do
    if [ -z \"\${!k:-}\" ]; then echo \"MISSING: \$k\"; else echo \"present: \$k\"; fi
  done
'"
# Expect all 6 lines to say "present:". docs/STRATEGY.md §6's key inventory
# predates this PR and should be refreshed to include TAVILY_KEYS/BRAVE_API_KEY
# by whoever next edits it (not this PR — see the instruction not to touch
# docs/STRATEGY.md here).

# 4. Run the 3 bake-off briefs (docs/research/bakeoff.md §3), report in
#    Persian by default (--report-lang fa), $0.50 cap each = $1.50 total,
#    everything under /tmp/w9run so /app / /opt/roxira_platform is never
#    touched. --report-lang stays independent of query sourcing, which is
#    always multilingual (en + zh/ja/de/ko/ru) unless --no-multilingual is
#    passed (it is not, here).
ssh 5.75.200.67 "docker exec -w /tmp/w9run roxira_app_prod bash -c '
  set -uo pipefail
  briefs=(
    \"Persian real-time voice legal assistant: STT, LLM, TTS, RAG, vector DB\"
    \"multilingual SEO-heavy web app with an admin panel\"
    \"best open-source OCR/layout parsing for Persian and Arabic PDFs\"
  )
  slugs=(voice-legal-assistant seo-web-app ocr-persian-arabic)
  for i in 0 1 2; do
    idea=\"\${briefs[\$i]}\"; slug=\"\${slugs[\$i]}\"
    echo \"=== [\$slug] \$idea ===\"
    python3 -m src.automation.tech_radar \
      --project-brief \"\$idea\" \
      --report-lang fa \
      --max-usd 0.50 \
      --brief-out \"/tmp/w9run/out/\${slug}.md\" \
      --json > \"/tmp/w9run/out/\${slug}.result.json\" 2> \"/tmp/w9run/out/\${slug}.log\"
    echo \"[\$slug] exit code: \$?\"
  done
'"

# 5. Pull the reports back — only markdown/json/log files leave the server,
#    never an env var or key.
mkdir -p ~/roxira_w9_live_run_out
scp -r 5.75.200.67:/tmp/w9run/out/. ~/roxira_w9_live_run_out/

# 6. Verify /opt/roxira_platform is untouched, then clean up the ephemeral
#    copy inside the container.
ssh 5.75.200.67 'cd /opt/roxira_platform && git status --porcelain'
# Expect: empty output.
ssh 5.75.200.67 'docker exec roxira_app_prod rm -rf /tmp/w9run'
```

Each brief writes `<slug>.md` + `<slug>.json` under `/tmp/w9run/out/`
(docs/research/briefs/README.md's normal `--project-brief` output shape);
`<slug>.result.json` is the same payload the CLI also printed to stdout via
`--json`, and `<slug>.log` has the run's log lines (queries, per-layer
status, budget-guard checks) for debugging a `DEGRADED`/`FAILED` exit code.
A run's process exit code is 0 only if `status == "SUCCESS"`
(src/automation/tech_radar.py `main()`); `DEGRADED`/`FAILED` still write
whatever partial evidence they gathered, matching
docs/research/briefs/README.md's existing contract.

## Estimating cost before committing to the $1.50 cap

The Phase A baseline (docs/research/bakeoff.md §1) measured ~$0.02 for one
flat `--topic` run. A `--project-brief` run does 9 per-layer `cheap`-tier
calls plus 1 `strong`-tier final reconciliation call
(src/automation/project_brief.py `LAYERS` / `PROJECT_BRIEF_FINAL_TIER`), so
expect noticeably more than $0.02 and noticeably less than $0.50 per brief in
the common case — `--max-usd 0.50` is a hard ceiling, not the expected spend.
If a brief hits the cap, its `<slug>.log` will show `BudgetExceeded` and
exactly which layer it stopped before.

## Switching the timer (owner action, after this live run is reviewed)

`roxira-radar.timer` currently still runs
`output_apps/ecosystem_core/src/factory/tech_radar_sentinel.py` (the old
canned-output sentinel that writes inside the repo — see
`docs/ops/roxira-radar.service` for the full comparison). The proposed
replacement units are `docs/ops/roxira-radar.service` and
`docs/ops/roxira-radar.timer`; they run the real pipeline via
`scripts/ops/roxira_radar_scheduled.py`, writing outside the repo to
`/opt/roxira_platform_reports/tech_radar/`. **Not installed by this PR.**
Once the owner has reviewed the live-run output above and approved switching:

```bash
ssh 5.75.200.67
cd /opt/roxira_platform && git pull --ff-only origin main   # picks up this PR after merge
cp docs/ops/roxira-radar.service /etc/systemd/system/roxira-radar.service
cp docs/ops/roxira-radar.timer   /etc/systemd/system/roxira-radar.timer
systemctl daemon-reload
systemctl restart roxira-radar.timer
systemctl start roxira-radar.service   # optional: trigger one run immediately
journalctl -u roxira-radar.service -f  # watch it; a DEGRADED/FAILED run now shows as failed, not silent
```

This step touches the server and restarts a unit, so per `CLAUDE.md` /
`AGENTS.md` it should be a separate, explicitly owner-approved action — not
bundled into this PR's local-only changes.
