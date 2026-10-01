# Operations runbook (how things are actually done)

Complements `docs/SYSTEM_MAP.md` (what exists) and `docs/STATE.md` (current state). This file is **how**: commands that were tested, and the traps found while testing them. Updated 2026-10-01. Secrets are referred to by name only.

## 1. Deploying to prod (`5.75.200.67`, repo `/opt/roxira_platform`)
- Prod is a git checkout. `scripts/ops/deploy.sh <service>` requires a **clean working tree**, fast-forwards `main`, builds and recreates only the named service, waits for health, then refreshes nginx. It rolls back automatically on failure.
- Services: `enterprise_app` (Python AI core, `roxira_app_prod`), `roxira_enterprise_frontend` (Next.js), `roxira_enterprise_backend` (NestJS). `output_apps/` is bind-mounted into `roxira_app_prod`, so a `git pull` alone puts new Python on disk while the old process keeps running: always run `deploy.sh`.
- **Long builds: run detached.** The frontend image build takes minutes and an interactive ssh session was dropped by the remote host twice. Use:
  `ssh 5.75.200.67 'cd /opt/roxira_platform && nohup scripts/ops/deploy.sh roxira_enterprise_frontend > /root/deploy-frontend.log 2>&1 &'`
  then read `tail /root/deploy-frontend.log` until `deploy OK`.
- Untracked files (for example `.env.bak.*`) block the deploy. Move them to `/root/env-backups/`.
- Verify after every deploy: container `healthy`, `https://ghazihoushmand.ir/health` 200, the changed page (for example `/coverage`) 200, and an exact lookup such as «ماده ۱۰ قانون مدنی».
- Assistant limits: read-only ssh works; the app's permission classifier refuses ssh writes and docker/secret-store writes even with the owner's approval in chat. The owner runs write commands, or adds the allow rules himself in an interactive `claude` terminal (`/permissions`).

## 2. Workers and models
- Ladder (ADR 0003): `rx <issue>` (Codex CLI, no Claude quota) → Sonnet subagent that only edits files → separate Sonnet chat → Opus for ADRs.
- `rx` runs one worker per worktree under `~/Developer/rx-wt/<n>`, logs in `~/rx-logs/<n>.log`. **Do not start two `rx` at the same moment**: both lock `.git/config` while creating worktrees; start the second one a minute later.
- Web research lane: `codex --search exec --sandbox workspace-write "<brief>" < /dev/null` inside a prepared worktree, one output file per brief.
- Models live only in `config/models.yaml`. LiteLLM pool: `127.0.0.1:4000` (provider `pool` in OpenCode). OmniRoute: `127.0.0.1:20128` (provider `omniroute`, model `team-coding`).

## 3. OmniRoute (Mac, Docker container `omniroute`)
- Start command (data volume `omniroute-data` holds the database **and** `server.env` with the auto-generated storage encryption key; the database is already encrypted at rest):
  `docker run -d --name omniroute --restart unless-stopped -p 127.0.0.1:20128:20128 --memory 3g -e OMNIROUTE_MEMORY_MB=2048 -e OMNIROUTE_MITM_ENABLED=false -e NODE_OPTIONS=--max-old-space-size=1024 -e REQUIRE_API_KEY=true -v omniroute-data:/app/data diegosouzapw/omniroute:latest`
- **Never set a new `STORAGE_ENCRYPTION_KEY`**: stored provider keys then fail to decrypt. Back up `server.env` and the volume (`~/omniroute-backups/`, mode 600).
- Never run `docker rm -f omniroute` again after a restore; it deletes the container that is serving.
- Combo `team-coding` (strategy Priority): `mistral/codestral-latest`, then `groq/openai/gpt-oss-120b`. Direct providers only: no `g4f`, no OpenRouter, no subscription-account bridges (`agy/`, `kr/`, `if/` models answer 401 anyway). Never route customer or case data through g4f or `:free` models.
- Groq answers 403 from some VPN exits; turn the VPN off or change exit if the combo test shows 403.
- Client key: env var `OMNIROUTE_OPENCODE_KEY` in `~/.config/omniroute.env`. OpenCode reads it through `{env:OMNIROUTE_OPENCODE_KEY}`; load it with `set -a; . ~/.config/omniroute.env; set +a` in the shell that launches the worker.
- Dashboard setting to check once: Cloud OmniRoute must be disabled (owner did).

## 4. Network traps on the Mac
- GitHub, OpenRouter and Iranian sites drop often: wrap `git`/`gh` in retry loops, use `git -c http.version=HTTP/1.1`, set `SSL_CERT_FILE` from `python3 -c 'import certifi;print(certifi.where())'`. `gh` needs the sandbox disabled to reach `api.github.com`.
- `rc.majlis.ir` answers intermittently (SSL EOF); retry later instead of changing source.
- Creating git worktrees needs the sandbox disabled (writes `.git/config`).

## 5. Tests and CI
- Never run `pytest` over `src/` or the repo root. Run only the file you changed: `rtk proxy python3 -m pytest <file>`.
- New tests must run no code at import time (a CI guard rejects it).
- Required checks: Detect changes, Secret scan, Pytest (unit), Frontend gate. Merge reviewed PRs with `gh pr merge <n> --auto --squash`.

## 6. Prod notes
- `roxira_app_prod` logs `Updating package: openai` at startup (LightRAG's pipmaster installing at runtime). Issue #181 pins `lightrag-hku` 1.5.7 and `openai` 3.22.1; verify on prod after the next deploy.
- Old generated `TEST-*`/`USER-*` router modules print `LOAD-FAIL` at startup; harmless.
