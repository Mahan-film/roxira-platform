---
name: project-migration-srv1-2026-10-13
description: "Prod migration in progress — new server srv1.roxira.net <ip> (Ubuntu 26.04 arm64, 4c/8G/80G); steps done and next"
metadata:
  node_type: memory
  type: project
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-13T18:58:18.393Z
---

New server (XZN/Hetzner): <ip>, hostname srv1.roxira.net, Ubuntu 26.04 aarch64. Root login works with my Mac key (passwords disabled; the owner holds the new root password). Old prod <ip> stays live until cutover.

Done 2026-10-13:
- bootstrap (ufw 22/80/443, fail2ban, Docker 29 + compose v5, swap, user roxira with sudo, key-only sshd)
- repo cloned via read-only deploy key "srv1"; checked out branch `migrate` = feat/llm-key-pool, which holds restore.sh `--from-set` and migrate_pull_set.sh
- latest local DR set copied to /var/lib/roxira/incoming-set/20261013T150831Z; drill restore to /var/tmp/restore-1 OK
- .env, research-stack .env, /etc/roxira and data/ copied
- compose build started (/root/build.log)

Also done 2026-10-13 16:25 UTC:
- images built; full restore OK (Twenty needed TWENTY_* values copied from the old containers' env into the new .env; the old .env lacks TWENTY_DB_PASSWORD)
- all 12 Qdrant counts equal
- roxira timers and x-ui stopped; cron inactive
- --resolve smoke passed (health ONLINE, 45 routers; chat 200; consult SUCCESS with art. 12 citation)
- outbound OK: Groq, OpenRouter, SambaNova, Mistral, ekhtebar

CUTOVER DONE 2026-10-13 ~17:40 UTC:
- the owner switched the Cloudflare A records for all 7 domains; aratai.ir www is a CNAME to a tunnel id
- old server frozen (app containers, cron and timers stopped; DBs still up)
- new server: cloudflare_only firewall plus 8443, cron applied, 9 timers on, first backup OK
- PRs #593, #594 and #595 merged; key pool live on 127.0.0.1:4000 (Groq ok; agent-free -> agent-paid DeepSeek fallback)
- OpenCode 1.18.30 installed via npm

Fixed later on 2026-10-13:
- server agents work through the gateway (#598, enabled_providers)
- ds-flash enabled: OPENROUTER_API_KEY_AGENTS in agents.env is a copy of the prod OpenRouter key; owner approved using all keys
- Cerebras dropped (#596)
- Gemini ids gemini-flash-latest and 3.7-flash (#597); Google returned 503 at the time
- research-stack searxng and valkey up; crawl4ai stopped (it was not running on old)
- sandboxes stopped because port 4001 was public (Docker bypasses ufw); the sandbox ports in data/ need a 127.0.0.1 bind before re-enabling
- x-ui disabled on new
- legal gate retrieval@5 = 0.857, equal to the baseline
- OpenRouter :free models are blocked by the account privacy setting (the owner must allow it in openrouter.ai settings)

Open issues (older):
- run_task --gateway gives UnknownError before any log (custom provider npm @ai-sdk/openai-compatible?)
- the 3 Groq keys share one org rate limit (no extra quota)
- Gemini model id and OpenRouter free ids are stale
- the Mac's CEREBRAS key is empty
- install.sh must restart the container when the config changes
- PR #592 is unreviewed (relay timeouts)

Old next steps (mostly done):
1. full restore with `--from-set --full` (PG, Qdrant, Twenty)
2. compare Qdrant point counts
3. smoke test with `--resolve`
4. cutover window: stop old, take a fresh set, delta restore
5. owner switches the Cloudflare A records
6. cloudflare_only firewall
7. enable timers and held cron
8. key pool install
9. server agents setup with `--agents`

The PR on chore/prod-host-alias replaces the hardcoded IP with ssh alias `roxira-prod`; merge it at cutover. Backups are local-only sets + email; Hetzner backups disabled.

**Why:** the next session must continue the migration without redoing steps. **How to apply:** never run cron on both servers at once; keep the old server for 48 h of rollback. Related: [[project-server-agents-groq]].
