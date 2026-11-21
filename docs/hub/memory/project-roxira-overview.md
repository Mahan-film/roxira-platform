---
name: project-roxira-overview
description: "Roxira OS / Smart Judge topology, prod server, and open security debt found 2026-09-24"
metadata:
  node_type: memory
  type: project
  originSessionId: c66c8cc7-64f2-4b84-9f43-43392df3e119
  modified: 2026-09-24T18:40:16.323Z
---

Roxira OS (roxira.net/.ir) enterprise SaaS + Smart Judge legal AI (ghazihoushmand.ir). Private repo mahan-films/roxira-platform. Prod: Hetzner <ip> (Ubuntu 24.04 aarch64), user reaches it via passwordless SSH. User prefers Persian (Farsi) for replies, English for technical reasoning.

Open debt as of 2026-09-24: SQL dumps + a .tar.gz backup tracked in git (postgres_full_dump.sql, database_snapshots/*.sql, production_bundle/enterprise_db_dump.sql); docker-compose.prod.yml binds postgres/redis/qdrant to 0.0.0.0 while the server runs them on 127.0.0.1 (repo/server drift); pgbouncer 6432, 3000, 3001, 4000, 4001 exposed on 0.0.0.0 (Docker bypasses UFW).

**Why:** user asked whether Claude "remembers" the project; nothing carried across sessions before this.
**How to apply:** verify against the live server before relying on these facts. First PR was #1 (root README).

Update 2026-09-24 (W5): LLM router is PR #5 (smartjudge/llm_router.py, flag LLM_ROUTER_ENABLED default off). PR #3 (STRATEGY.md) was still unmerged, so status rows get pushed to branch docs/strategy-and-token-hygiene. Server daemon pushes "automated audit pass" commits straight to main — always base work on origin/main, not local main. Commit 0ba8275 left smartjudge_module.py un-importable (NameError live_voice_endpoint). Sandbox blocks gh TLS and uv (need sandbox off); .claude/settings.json writes are denied.

Update 2026-09-24: this chat is the strategy hub; owner runs execution in separate Sonnet 5 chats per workstream (W0-W8 in docs/STRATEGY.md, PR #3). Owner declined key rotation. Goal: runtime LLM cost near zero via OpenRouter (free tier only for non-sensitive data). PR #2 (secrets to .env, loopback ports) needs scripts/ops/migrate_secrets_to_env.sh run on the server before deploy. SSH is now allowed via .claude/settings.local.json. On 2026-09-24 (owner approved) installed `roxira-docker-firewall.service` on the server: DOCKER-USER rules drop eth0 traffic to 6432/3000/4000/4001 (script /usr/local/sbin/roxira-docker-firewall.sh). The local clone was 380 commits stale that day, so always `git fetch` first: `autonomous_master_daemon.py` on the server pushes an audit commit to main every ~30 minutes, and venv/ is committed.

2026-09-24 evening: PRs #1-#9 merged; secrets now required from server .env (backups in /root/env-backups). Deploy runbook is in docs/STRATEGY.md §7 (PR #11): reload nginx after any container recreate, and the frontend is not compose-managed. Account is on the Claude Pro plan. The auto-mode classifier blocks PR merges without explicit user OK and blocks remote crontab edits, so ask the user or have them run those.

Update 2026-09-24 (W10, PR #12, design not yet implemented): owner wants a safe/cheap agent workforce via Goose+OpenCode on OpenRouter cheap models, with a hard rule that agents never push to main (worktree+branch+PR+CI, human/Claude merges). Inventory (see docs/AGENTS_WORKFORCE.md): `roxira-dispatcher.service` (factory_dispatch_api.py, port 8005) and `task_worker.py` (roxira-worker.timer, every 5 min) both push straight to main with no worktree isolation; `autonomous_master_daemon.py` (roxira-autodaemon.timer, 30 min) is the source of the ~48 daily "all green" commits and also pushes directly — this is what commit 0ba8275 came from. `master_swarm_orchestrator.py` has its own direct-push `agent_gitops_commit()`, dormant but not removed. Goose (1.50.0, OpenRouter/deepseek-chat) and OpenCode (1.18.30, OpenRouter/deepseek-v4.1-flash, **opencode.json has `"permission":"allow"`** — runs unattended with zero confirmation) are both installed but neither runs in an isolated worktree today. No `gh` CLI on the server. **New security finding, separate from W10:** port 8005 (the dispatcher) is bound to `0.0.0.0` and NOT in the DOCKER-USER firewall chain (which only blocks 6432/3000/4000/4001) — its unauthenticated POST endpoint is reachable from the public internet and ends in an unreviewed push to main. Flagged to owner, not yet fixed. gh CLI needs `dangerouslyDisableSandbox: true` on this server too (TLS x509 cert verify fails through the sandbox proxy), same as the note above about `gh`/`uv`.
