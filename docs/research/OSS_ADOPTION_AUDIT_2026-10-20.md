# OSS adoption and strategy audit - 2026-10-20

Question from the owner: did we adopt, for ourselves, the best open-source systems we planned (we deployed Twenty CRM; what are the equivalents for our own business operations), and did we implement the strategies we decided?

Method: docs read (STATE, SYSTEM_MAP, STRATEGY, MASTER_PLAN 2026-10-16, STRATEGY_STATUS 2026-10-14, STRATEGY_GAP 2026-10-12, TOOLS_ADOPTION, TOOLS_SCOUT, OBSERVABILITY, SOLO_FACTORY_REVIEW, ops docs), then read-only checks on srv1 (`docker ps/stats`, `systemctl`, `journalctl`, row counts in Postgres/SQLite; no secrets read, no writes). GitHub facts from the GitHub API on 2026-10-20. Items marked UNVERIFIED are estimates or not checked.

## 0. Headline answer

1. **Twenty CRM is deployed but has never been used.** Its database has 0 users and 0 workspaces (`core.user` = 0, `core.workspace` = 0; only migration tables are populated). Nothing syncs Smart Judge users, leads or payments into it; the only code that mentions it is a health ping and an MCP gateway stub. `docs/HANDOFF_2026-10-15.md` already calls it "legacy, orphan; not used by the product". It costs about 440 MB RAM on a box that is swapping (see section 1).
2. **For our own business operations we adopted almost nothing beyond infrastructure.** What we really run for ourselves: Umami (analytics, 72 events, 31 sessions since 2026-10-16), a home-built Telegram control bot, a home-built monitor (synthetic + log watch), home-built backups, SBOM scanning. We have no CRM in use, no support inbox, no external uptime/status page, no error tracker, no secrets manager, no feature flags, no log search.
3. **Several automations exist but are broken or inert** (section 3): weekly mutation timer fails (missing `python3-venv`), `roxira-docker-firewall.service` failed since 2026-10-13 (script missing), KPI weekly has never run, marketing publisher runs every 15 minutes but has no platform tokens, off-site restic repo is not configured (backups are local sets plus the Mac pull), radar and autodaemon timers are disabled.
4. **Scale reality** (from the DB, 2026-10-20): 2 registered users, 2 paid and 7 pending payment orders, 1 support ticket, 0 CRM leads, 0 enterprise inquiries. The honest value of a CRM today is low; the cheap, correct move is a nightly sync script, not new infrastructure.
5. **RAM is the binding constraint**: srv1 has 7.5 GiB RAM, 4.8 GiB used, 1.7 GiB free, 3.9 GiB of 7.8 GiB swap in use (text-embeddings alone has about 1.35 GB swapped out), 83% disk. Any new always-on container must be paid for by removing something. Plan below stays at a net of about 0 to +150 MB.

## 1. srv1 capacity snapshot (2026-10-20 18:00 UTC)

| Container | Memory now | Purpose |
| --- | --- | --- |
| roxira_embeddings (TEI bge-m3) | 1.19 GiB (limit 3.4) | embeddings for RAG |
| roxira_twenty_crm + db + redis | 427 + 10 + 3 = about 440 MiB | Twenty CRM (unused) |
| roxira_keypool (LiteLLM 1.77.7) | 370 MiB | model gateway |
| roxira_app_prod (FastAPI AI core) | 192 MiB | Smart Judge |
| roxira_qdrant_prod | 45 MiB | vectors |
| roxira_umami | 42 MiB | analytics |
| roxira_enterprise_backend / frontend | 31 / 52 MiB | NestJS hub / Next.js |
| postgres, pgbouncer, redis, nginx, mail, searxng, valkey, research, socket proxy | about 90 MiB combined | core data and edge |

Host: 4 vCPU, `free -h`: used 4.8 GiB, available 2.7 GiB, swap used 3.9 GiB. Timers fire every 5 minutes (autodeploy, monitors) so swap churn is real. Reclaim options: stop Twenty if we do not adopt it (about 440 MiB), cap TEI batch/threads, or add RAM/second server (the global server in the master plan).

## 2. Inventory: planned, running, used, integrated

Legend: Running = present in `docker ps` or an enabled systemd unit on srv1. Used = data/activity evidence. Integrated = wired into our products or workflow.

### 2.1 Product and platform infrastructure

| System (licence) | Planned purpose | Running on srv1 | Actually used (evidence) | Integrated | Verdict |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL 17 + PgBouncer | main DB, pooling | yes (7 d up) | `enterprise_db` 22 MB, 2 users, 10 payment orders | yes | OK |
| Redis 7 | cache, queues | yes | in use by hub | yes | OK |
| Qdrant 1.19 | legal vectors | yes | `iran_laws_v6`, `iran_regulations_v2`, `iran_rulings_v1`, plus unused old collections | yes | OK; cleanup of unused collections still open (STATE item 8) |
| TEI bge-m3 embeddings | local embeddings | yes | 1.19 GiB, partly swapped | yes | OK, memory heavy |
| LiteLLM key pool (MIT) | free-first model gateway, cost log | yes | `/var/log/roxira-keypool/requests.jsonl` 2,296 calls, live traffic at 18:00 | yes (product chat, agents) | OK; image has 34 Critical OS CVEs (known) |
| SearXNG + Valkey + GPT-Researcher service | research, discovery | yes (6 d up) | research service healthy; `EMBEDDING` config gap noted in STRATEGY_STATUS | agents, F3 | partial, low traffic |
| Nginx + Cloudflare lockdown | edge | yes | yes | yes | OK |
| Postfix + DKIM mail relay (boky/postfix 5.1.0, MIT) | outbound mail (OTP, backup reports) | yes | backup report mailed 2026-10-20 06:30 | partial | OK; DMARC TXT records still the owner's manual step |
| Xray REALITY VPN | access path | yes (port 8443) | per STATE | n/a | OK |
| docker-socket-proxy (Tecnativa) | safe docker API for bots | yes | yes | yes | OK |
| Umami 3.4.0 (MIT, 39k stars) | web analytics, F7 | yes (4 d up, 42 MiB) | 2 sites tracked, 72 events, 31 sessions, first event 2026-10-16 | tracker in frontend, KPI report planned | used lightly; nobody reviews it yet |
| **Twenty CRM v2.41.0** (AGPL + commercial `ee`, 58.7k stars; latest release 2.49 on 2026-10-19, so we are 8 minors behind) | CRM for ourselves | yes, 3 containers, 7 d up | **0 users, 0 workspaces, no records** | **none** (no sync, no login ever created) | **deployed, unused** |

### 2.2 Operations automation (home-built on OSS parts)

| System | Planned purpose | State on srv1 (2026-10-20) | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| roxira-autodeploy (+ rollback, legal gate) | merge = release | running every 5 min, last run 17:55 | timers list | OK |
| monitor-synthetic / monitor-logs / monitor-daily | uptime, TLS, 5xx watch | running every 5 min, all OK; TLS roxira.ir 33 days left | journal | OK but runs on the same box, so it cannot see a full outage; MONITORING.md lists external uptime as "free services" suggestion only |
| DR backup (dump + restic, `server_backup.sh`) | backups, restore drills | run timer works (hourly local set, 14 s); daily e-mail report works; weekly check works | journal | **gap: "no restic repository configured; BACKUP_ALLOW_LOCAL_ONLY=1, local sets only (the Mac pull is the second copy)"**. No true off-site, encrypted repo. `/root/deploy-state/db-backups` holds only 4 old dumps (latest 2026-10-14) |
| roxira-sbom (syft/grype) | CVE visibility | running daily 04:15, summary file written | summary.txt: app 14 Critical, keypool 34 Critical, backend 3, frontend 2 | OK as visibility; fixes pending (STATE item 7) |
| **roxira-mutation-weekly** (mutmut) | mutation tests on legal scripts | **failed** 2026-10-18 02:00: `ensurepip not available, apt install python3.14-venv` | journal | broken; one `apt install` away |
| **roxira-docker-firewall.service** | block public access to internal Docker ports | **failed** since 2026-10-13: `/usr/local/sbin/roxira-docker-firewall.sh` missing | systemctl | broken. Current risk is low (every container port is bound to 127.0.0.1, public listeners are only 22, 80, 443, 8443) but the defence-in-depth layer is absent |
| roxira-taskq + `run_task.sh` (OpenCode agents) | F1/F2 queue + escalation | service active | taskq.db: 9 tasks, 14 attempts in total; last activity 2026-10-16 | built, barely used since the agents key ran out of credit |
| OPENROUTER agents key | fund agents | credit-watch runs hourly: "remaining 5.0" (a limit of $5, not necessarily spend) | journal | owner action open (fund ~$20) |
| roxira-control-bot (Telegram) | mobile control and alerts | active; `NOTIFY_BOT_TOKEN` and `NOTIFY_CHAT_ID` both set | journal shows only periodic `getUpdates` TimeoutError | works; occasional timeouts |
| roxira-selfimprove hourly/daily | golden eval, question mining | daily run 2026-10-20 00:30 OK, 0 issues opened, $0.04 | journal | running; value depends on golden-set size (still DRAFT per GAP doc) |
| roxira-usdt-poll | crypto payment poller | running every minute, nothing pending | journal | OK |
| agentdb-gc (throwaway agent DBs) | agent isolation | running hourly | timers | OK |
| **roxira-kpi-weekly** (F7) | weekly Persian KPI to the bot | timer enabled, **never fired** (next Fri 2026-10-23 06:00) | `journalctl`: no entries | untested in production; first run is the test |
| **roxira-marketing-publish** (F6) | publish approved posts | runs every 15 min, exits instantly | journal | **inert: zero platform tokens configured** (no META/LINKEDIN/X variables in `.env`), no content store on the server |
| roxira-radar, radar-daily, autodaemon, cf-refresh | tech radar, health daemon, Cloudflare IPs | timers installed but **not active** | `systemctl list-timers` shows no schedule | disabled; radar workflow also dead since GitHub Actions is off |
| sysstat, certbot, logrotate, docker-prune | host hygiene | running | timers | OK |

### 2.3 Factory (F1-F7) and chassis

| Step | Claimed state | Verified state |
| --- | --- | --- |
| F1 workbench | live | code present; no evidence of recent use |
| F2 taskq | live | 9 tasks ever; idle since 2026-10-16 |
| F3 brief to spec | live; `my-legal-research` specced | one project specced, never built |
| F4 SaaS chassis (Next.js, Better Auth 1.7.10, Drizzle 0.45.4, Umami hook) | built and verified | template in `templates/saas-chassis`; **no product has been generated from it**; not deployed |
| F5 projectctl multi-project deploy | built, "for the global server" | no global server exists, so never exercised |
| F6 marketing engine | built, needs tokens | inert (see above) |
| F7 KPI + Umami | built, inert until configured | Umami configured and collecting; KPI report not yet run |
| G2 Malaysian law pilot | internal eval only | pending AGC permission (owner/lawyer) |

### 2.4 Tools researched and explicitly not adopted (consistent with docs)

Flowise (archived), Composio, n8n (licence), Dify (licence), Langfuse (heavy; replaced by the local cost log), Firecrawl, LlamaIndex/Haystack/GraphRAG, Mem0, Dokploy/Coolify, Chatwoot ("too heavy for 8 GB"), Better Auth in the Iran stack (kept only in the chassis), Hermes ecosystem, Harness^2, Ghost Downloader, HexStrike. These skips are deliberate, not gaps.

## 3. Gaps: what we planned or need and do not have running

| Need | Planned? | Current state | Gap |
| --- | --- | --- | --- |
| CRM for ourselves (leads, sign-ups, payments, lawyers, partners) | Twenty deployed | unused, empty | not adopted. Note the hub also has its own tenant CRM module (`crm_leads`, 0 rows), so there are two unused CRMs |
| Owner dashboard (one page: users, revenue, traffic, costs, health) | F7 weekly Telegram text only | none live | missing |
| Support inbox | `support_tickets` table + e-mail relay | 1 ticket; no alert, no owner view | missing (no notification path) |
| External uptime / status page | "suggested" in MONITORING.md; STATE item 8 | none | missing; on-box monitor cannot detect host outage |
| Error tracking | not in docs (0 hits for Sentry/GlitchTip) | none; 5xx counted from nginx logs | missing |
| Product analytics funnel | Umami + events | collecting; funnel not reviewed | partial |
| LLM observability | cost log (`cost_report.py`) | JSONL with 2,296 rows | partial; Langfuse deliberately skipped |
| Feature flags | none planned | env flags only | acceptable at this scale |
| Secrets manager | SOPS mentioned in 9 docs, `docs/research/SECRETS_AND_SAFE_DEPLOY_2026-10.md` | plaintext `.env` on the server, `.env` copies in `/root/env-backups` | design only |
| Log search | none | `journalctl` and docker logs by hand | missing |
| Off-site encrypted backups | restic planned (`DISASTER_RECOVERY.md`) | repo not configured | **highest-risk gap** |
| Restore drill | monthly by hand (`RESTORE_DRILL.md`) | no evidence of a recent drill | unverified |
| Email deliverability (DMARC) | owner adds TXT records | still owner action | open |
| Host metrics history | sysstat | sysstat only | fine |

## 4. Candidate tools (verified on GitHub, 2026-10-20)

RAM numbers are estimates (UNVERIFIED) unless stated.

| Tool | Use for us | Licence | Stars | Last push / release | RAM (est.) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Gatus (TwiN/gatus) | status page + uptime as code, alerts to Telegram | Apache-2.0 | 12.4k | push 2026-10-17, v5.37.0 (2026-09-24) | 20-50 MB (single Go binary) | config in git fits our workflow; run OFF the box |
| Uptime Kuma (louislam) | uptime + public status page, UI | MIT | 92.7k | push 2026-10-20, 2.5.6 (2026-10-09) | 100-200 MB (Node + SQLite) | friendlier UI; also run off the box |
| Healthchecks (healthchecks/healthchecks) | dead-man's switch for our timers (backup, kpi, selfimprove) | BSD-3-Clause | 10.4k | push 2026-10-20, v5.0 (2026-10-20) | hosted free tier = 0 on srv1 | catches "timer silently stopped", which on-box checks cannot |
| restic | encrypted off-site backups | BSD-2-Clause | 36.7k | push 2026-10-18 | 300-600 MB transient at run time (we saw 667 MB peak for the current backup) | already integrated in `server_backup.sh`; only the repo target is missing |
| SOPS + age | encrypted secrets in git | MPL-2.0 / BSD-3-Clause | 23.5k / 24.0k | 2026-10-20 / 2026-08-29 | 0 (CLI) | pairs with autodeploy |
| Twenty (already deployed) | CRM | AGPL + commercial `ee` | 58.7k | 2026-10-20; release 2.49 (2026-10-19) | 440 MB now | upgrade needed if kept (v2.41.0 to 2.49) |
| GlitchTip | Sentry-compatible error tracking | MIT (per project; hosted on GitLab, not GitHub) | 362 stars on GitLab backend mirror (UNVERIFIED: official repo path) | active (GitLab API 2026-10-20) | 300-500 MB (Django + worker + Postgres + Redis) | defer until RAM is freed or the global server exists |
| Sentry self-hosted | error tracking | not OSI (NOASSERTION, BSL-style) | 9.6k | 2026-10-19 | several GB | too heavy; reject |
| Beszel | host + container metrics with history | MIT | 26.4k | 2026-10-20, v0.21.0 | 30-60 MB hub + agent | optional, only if sysstat is not enough |
| Dozzle | live docker log viewer | MIT | 14.7k | 2026-10-20 | 10-20 MB | nice for log search without Loki; bind to localhost + SSH tunnel |
| Grafana Loki | log search | AGPL-3.0 | 29.0k | 2026-10-20 | 300+ MB with Promtail | reject at this RAM |
| Listmonk | newsletters / lawyer outreach | AGPL-3.0 | 23.9k | v7.0.0-beta.1 (2026-10-20, beta) | 40-80 MB + its own Postgres DB | wait for stable v7 |
| Vaultwarden | team password manager | AGPL-3.0 | 69.3k | 1.37.4 (2026-10-05) | 10-20 MB | useful when the second person works with us |
| Infisical | secrets manager | MIT core + `ee` | 29.9k | 2026-10-20 | Postgres + Redis + API, 500 MB+ | overkill; SOPS is enough |
| Unleash / GrowthBook | feature flags | AGPL / MIT+`ee` | 13.9k / 8.5k | 2026-10-20 | 300-500 MB | reject; env flags suffice |
| Chatwoot | support inbox | MIT + `ee` | 38.0k | 2026-10-20 | 1 GB+ (Rails + Sidekiq) | reject while the server is at 7.5 GiB |
| Metabase / NocoDB / Superset | owner dashboard / DB UI | AGPL+commercial / NOASSERTION / Apache-2.0 | 49.8k / 65.3k / 75.2k | 2026-10-20 | 500 MB to 2 GB+ | reject on srv1; the dashboard can be a static page or Telegram digest from Umami + SQL |

Gatus vs Uptime Kuma: pick Gatus if we want config in git and minimal RAM; pick Kuma if the owner wants a clickable UI and a public status page quickly. Either belongs on the owner's Mac (launchd) or the future global server, never only on srv1.

## 5. Smallest next step per gap (dogfooding)

| Gap | Smallest concrete step | Effort | Extra RAM on srv1 |
| --- | --- | --- | --- |
| Twenty unused | Decide in one line: keep or stop. If keep: (a) owner opens the Twenty UI via SSH tunnel to 127.0.0.1:3002 and creates the workspace, (b) hub writes `scripts/ops/crm_sync/sync_to_twenty.py`: nightly, read-only on `enterprise_db` (`users`, `payment_orders`, `support_tickets`), upsert People (users) and Opportunities (paid and pending orders) via the Twenty API with an API key stored in server env; idempotent by external id | M (1 day) | 0 (Twenty already running); +0 if stopped saves 440 MB |
| Owner dashboard | Extend the Friday KPI report to a daily compact digest: new users, payments, Umami visitors, chat cost from `cost_report.py`, failed timers. Telegram first; a static `/owner` page later | S | 0 |
| Support inbox | On `support_tickets` insert (or 5-minute poll) send a Telegram message through `notify.py` with ticket text and a link | S | 0 |
| External uptime | Run Gatus on the owner's Mac (launchd) or the global server, probe `https://ghazihoushmand.ir/health`, `https://roxira.ir`, TLS expiry, alert to the Telegram bot. Plus Healthchecks.io free ping at the end of backup-dr-run, kpi-weekly and selfimprove-daily | S | 0 |
| Off-site backups | Create one restic repo (Hetzner Storage Box, Backblaze B2 or similar), set `RESTIC_REPOSITORY` and password in server env, remove `BACKUP_ALLOW_LOCAL_ONLY`, run one restore drill and record it. The restic code already exists | S-M (needs owner choice of storage) | 0 steady, about 600 MB transient |
| Broken timers | `apt install python3.14-venv` for mutation; restore or reinstall `roxira-docker-firewall.sh` from `scripts/ops/firewall/` (check what rules it applies first), or disable the unit | S | 0 |
| Error tracking | Interim: keep nginx 5xx watch plus the app's own logs. Install GlitchTip on the global server (Track G) or after reclaiming Twenty's RAM | M | 300-500 MB (deferred) |
| Secrets | SOPS + age for the server `.env` copy kept in git or the Mac; keep runtime `.env` on disk | M | 0 |
| Log search | Dozzle on localhost for ad-hoc viewing; skip Loki | S | 10-20 MB |
| Marketing engine | Do not run the timer until tokens exist; disable `roxira-marketing-publish.timer` (it wakes every 15 min for nothing) or add one account token and a first approved post | S | 0 |
| Product analytics | Create a Umami funnel (landing, chat, signup, checkout) and read it in the KPI report | S | 0 |
| Memory pressure | Stop Twenty if not adopted, or set `mem_limit` on TEI and move it off swap | S | frees 440 MB |

## 6. Strategies and decisions from the docs not yet implemented

| # | Decision / strategy (source) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Fund the agents OpenRouter key (~$20) to unblock F1-F3 (MASTER_PLAN section 10) | not done | credit-watch: remaining 5.0; taskq idle since 10-16 |
| 2 | Off-site restic backups (DISASTER_RECOVERY, W8 follow-up) | not done | "no restic repository configured" |
| 3 | Twenty hardening runbook, issue #397 (`docs/ops/TWENTY_HARDENING.md`) | not started | STRATEGY_STATUS line 240; and Twenty has no workspace at all |
| 4 | Docker firewall (DOCKER-USER chain, W8) | unit failed, script missing | systemctl |
| 5 | Weekly mutation testing (STATE item 7) | installed but failing | journal |
| 6 | External uptime check (STATE item 8) | not done | none |
| 7 | LLM observability, Langfuse or cost per answer (STATE item 8) | partial (cost log only) | requests.jsonl, no dashboard |
| 8 | Qdrant cleanup of unused collections, keep v3 + v5 (STATE item 8) | not done | STATE |
| 9 | Old server 5.75.200.67 decommission (needs owner OK) | not done | STATE |
| 10 | DMARC records on three domains (SOLO_FACTORY_REVIEW) | owner action open | docs |
| 11 | KPI weekly report live (F7) | first run due 2026-10-23 | timers |
| 12 | Marketing engine live (F6) | inert, no tokens | `.env` has no platform variables |
| 13 | Control-bot confirm buttons, deploy freeze (#676) | running; not re-verified | journal |
| 14 | F4 chassis used for a real product; first Track G product | not started | no generated product |
| 15 | F5 global server and company accounts (Phase 0: adviser check, partner agreement, new GitHub org, Hetzner) | not started (owner) | MASTER_PLAN section 3 |
| 16 | G2 Malaysian law pilot (AGC reuse terms, 20 Acts ingest, landing + waitlist) | not started beyond pipeline code | MASTER_PLAN section 5 |
| 17 | Tenant isolation waves 2-6 (invoicing, accounting/HR, inventory, damages, tax keys; repository-level asserts) | not started per STRATEGY_STATUS (the 2026-10-14 STATE says modules are isolated; reconcile) | STRATEGY_STATUS lines 176-181 vs STATE |
| 18 | Real Moadian integration (simulated today) | not started | STRATEGY_STATUS line 155 |
| 19 | Key pool image CVEs (34 Critical) | open | SBOM summary |
| 20 | Eval gate in `deploy_local.sh`; golden sets grown to 50+20 and lawyer-verified | partial | GAP L1 |
| 21 | Missing laws: direct taxes 1366, 1403 guild amendment; lawyer review loop; regulations refresh | open | STATE next workstreams 1-3 |
| 22 | `llms.txt`, GEO brand capture, FAQ schema audit | not started / partial | STRATEGY_STATUS lines 133-135 |
| 23 | Persian STT via Groq decision; PII scrubber wired into LLM path; jurisdiction rules wiring | owner / agent pending | STRATEGY_STATUS lines 76-80 |
| 24 | Tech radar / weekly registry check | timers disabled, Actions off | systemctl |
| 25 | Autonomous Software Foundry product (do not sell until built) | not started | STRATEGY_STATUS line 161 |

## 7. Top 10 actions (prioritised)

| Rank | Action | Why now | Effort | Extra RAM on srv1 | Owner input |
| --- | --- | --- | --- | --- | --- |
| 1 | Configure the off-site restic repository and run one restore drill | only copies today are on the same host plus the Mac pull; data includes payments and user data | S-M | 0 (transient 600 MB) | choose storage and approve |
| 2 | Add external monitoring: Gatus (or Uptime Kuma) on the Mac or global server, plus Healthchecks.io pings from backup, KPI and selfimprove timers | nothing today detects a full outage or a silently stopped timer | S | 0 | none (hub can do it) |
| 3 | Decide Twenty: keep and sync, or stop. Recommended: keep, build the nightly sync (users, orders, tickets), then upgrade 2.41.0 to the current release in a window | owner explicitly wants dogfooding; today it is 440 MB of idle RAM | M | 0 (or -440 MB) | one UI login, API key via `set_server_env.sh` |
| 4 | Fix the two broken units: install `python3.14-venv` (mutation) and restore or remove the docker-firewall unit | red units hide real failures; firewall layer is missing | S | 0 | approval for server change |
| 5 | Telegram digest: new tickets, new users, payments, Umami visitors, chat cost, failed timers (daily), run the first KPI weekly by hand with `--dry-run` before Friday | cheapest owner dashboard; reuses notify.py and cost_report.py | S | 0 | none |
| 6 | Disable the idle marketing timer or provide one platform token and approve a first post | 96 useless wakeups a day; F6 value is zero until tokens exist | S | 0 | tokens (Meta business account) |
| 7 | Fund the agents key (~$20) | unblocks taskq/F1-F3; agents idle since 2026-10-16 | S | 0 | owner payment |
| 8 | Create a Umami funnel (landing, chat, sign-up, checkout) and review weekly; put conversion in the digest | only 72 events so far; growth work needs a number | S | 0 | none |
| 9 | Secrets hygiene: SOPS + age for env backups; DMARC TXT records; rotate anything that ever sat in `/root/env-backups` copies | plaintext `.env` copies on disk and in backups | M | 0 | DNS edit for DMARC |
| 10 | Error tracking: GlitchTip on the global server (Track G) or on srv1 only after Twenty is stopped or RAM is added; until then rely on nginx 5xx watch | no exception visibility; heavy for current RAM | M | 300-500 MB (deferred) | none until RAM exists |

Not recommended now: Chatwoot, Metabase/NocoDB/Superset, Loki, Unleash/GrowthBook, Infisical, Sentry self-hosted, Langfuse (RAM or complexity beyond value at 2 users).

## 8. Honest caveats

- All figures were read on 2026-10-20 between about 17:55 and 18:05 UTC; usage and memory fluctuate.
- Counts of Twenty "0 users, 0 workspaces" come from the `core` schema of the `default` database; a different Twenty database was not found.
- `NOTIFY_*` and platform tokens were checked only by counting matching variable names, never by reading values.
- RAM figures for candidate tools are estimates, not measurements. GlitchTip's canonical repo is on GitLab; its star count and licence need confirmation before any install.
- STATE.md says the enterprise modules are tenant-isolated while STRATEGY_STATUS (2026-10-14) lists waves 2-6 as not started; the docs disagree and should be reconciled by whoever owns W-tenancy.
- Nothing on the server or in the repo was modified; the only file created is this report.
