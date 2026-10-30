# srv1 load audit (2026-10-30)

Scope: `docs/strategy/MASTER_STRATEGY_2026-10-30.md` section 4. Everything below was measured read-only on srv1
(`ssh roxira-prod`, 2026-10-30 18:30 UTC). Nothing on srv1 was changed. Commands used are listed in section 7.

## 1. Result in five lines

1. The server is not short of RAM right now (7.7 GB total, 3.7 GB used, 4.0 GB available). The 4.4 GB of swap in use
   is mostly zram (3.3 GB, compressed) holding cold pages. It is a symptom of the Docker daemon (626 MB RSS after 17 days)
   and the Python core (540 MB) growing, not of the cron jobs.
2. The cron jobs we checked cost almost no RAM (each runs for seconds). Their cost is noise: process spawns, about 6.5 MB of logs so far,
   Qdrant searches, TEI embedding calls and, for one job, a paid OpenRouter call. Stopping them saves CPU and log disk,
   not gigabytes.
3. Qdrant uses 111 MB RSS for all 22 collections (vectors are memory-mapped). Old collections cost about 440 MB of disk,
   not RAM. The bigger disk item is 1.1 GB of old snapshots inside the Qdrant container.
4. No old collection may be deleted yet: no copy exists off the server for them (the nightly replica copies only
   `iran_laws_v6`), and four old names are still code defaults. Section 5 is the plan.
5. Failover reads covered only `iran_laws_v6`. The live `iran_rulings_v1` and `iran_regulations_v3b` were never replicated, so a
   failover to Qdrant Cloud would have answered those with 404. This PR adds the missing code path. **Until the owner sets
   `QDRANT_REPLICA_COLLECTIONS` on srv1 and the replica timer runs, `iran_rulings_v1` and `iran_regulations_v3b` are NOT on Qdrant
   Cloud, so failover cannot serve them whatever the code does.** The command is in section 6, step 3.

## 2. Memory and CPU

Host: `free -m` Mem 7720 total, 3670 used, 1246 free, 3027 cache, 4050 available. Swap 7956 total, 4423 used
(`/swapfile` 1 GB of 4 GB, `/dev/zram0` 3.3 GB of 3.8 GB). Load average 0.18 / 0.44 / 0.70. Uptime 17 days.
Disk `/`: 55 GB of 75 GB used. `docker system df`: images 31.6 GB (6.8 GB reclaimable), volumes 7.3 GB (2.7 GB reclaimable).

Containers (`docker stats --no-stream`):

| Container | Memory | Limit | CPU | Verdict |
| --- | --- | --- | --- | --- |
| roxira_app_prod (Python core) | 543 MB | 1.17 GB | 0.2% | Keep. Largest app process |
| roxira_enterprise_frontend | 64 MB | 600 MB | 0% | Keep |
| roxira_enterprise_backend | 49 MB | 900 MB | 0% | Keep |
| roxira_keypool | 71 MB | none | 0.3% | Keep |
| roxira_qdrant_prod | 62 MB (RSS 111 MB) | none | 0.9% | Keep (source of truth) |
| roxira_umami | 58 MB | none | 0% | Keep, low value, see section 4 |
| roxira_embeddings (TEI bge-m3) | 46 MB idle | 3.4 GB | 2.4% | Keep for queries. Batch builds move to Modal |
| roxira_postgres_prod | 33 MB | none | 0.2% | Keep |
| roxira_research, searxng, valkey | 15 + 5 + 2 MB | | <0.5% | Keep |
| roxira_mail, redis, pgbouncer, nginx, socket proxy | 1 to 14 MB each | | ~0% | Keep |

Host processes by RSS: `dockerd` 627 MB (17 days, never restarted), `run_unified_server.py` 540 MB, `qdrant` 111 MB,
`next-server` 103 MB (8 min old, after the last deploy) + 56 MB (14 days old), `containerd` 71 MB,
`litellm` 64 MB, `node dist/main.js` 52 MB, `journald` 49 MB, `fail2ban` 40 MB, `text-embeddings-router` 25 MB,
`xray` 23 MB, `taskq.py` 17 MB.

What this means: the real RAM levers are a `dockerd` restart (owner decision, short outage of all containers, not done here)
and a memory cap or periodic restart of the Python core. Neither is in this PR.

## 3. Cron jobs and timers

Source: `/etc/cron.d/*`, root crontab, `systemctl list-timers --all` (47 timers). Log sizes and last lines from
`/var/log`. "Measured" means the log or journal of the last 24 hours shows what it does.

### cron.d and crontab

| Job | Schedule | What it really does (measured) | Verdict |
| --- | --- | --- | --- |
| `roxira_agent_mesh` -> agent_mesh_daemon.py | every 10 min | Prints ten fixed lines "ONLINE, Health 100%". No check of anything. Log 2.0 MB | **Stop** |
| `roxira_mesh_cron` -> same daemon | every 5 min | Same script again, log 4.0 MB | **Stop** |
| `roxira_mesh_cron` -> seo_dispatcher.py | daily 04:00 | Counts 4592 sitemap URLs and pings `google.com/ping` and `bing.com/ping` for `ghazihoushmand.ir`. Google retired its ping endpoint in 2023, errors are swallowed | **Stop** (same file as the mesh line) |
| `roxira_swarm_qa` -> swarm_qa_worker.py | every 15 min | Calls `/system/simulation-qa`, which runs three fixed legal questions through the knowledge graph: 3 Qdrant searches and 3 embeddings, 288 searches and 864 embeddings a day, result only logged | **Stop**. `roxira-selfimprove-hourly` already evaluates retrieval |
| `roxira_social_marketing` | daily 09:00 | One OpenRouter call (paid rung) writes `/tmp/latest_social_post.txt` inside the container. The file does not exist, `/var/log/marketing_autopilot.log` does not exist, nothing consumed it | **Stop** |
| root crontab `daily_tech_scout.sh` | daily 04:30 | Fails every night: `ModuleNotFoundError: No module named 'httpx'`, "no reports were generated" | **Stop** until fixed |
| `roxira_legal_autonomous_sync` -> ekhtebar_crawler.py | hourly | Last run "0 documents imported". Log 400 KB | **Move**: daily instead of hourly (next step, needs a code review of the crawler) |
| same file -> legal_verifier_daemon.py | daily 03:00 | Reads all `graph_nodes` (8822 rows) and prints that 3937 are duplicates. Fixes nothing. Log 5.6 MB | **Keep** for now; the duplicate count is a real finding for the legal team, the log needs rotation |
| `roxira_legal_feeder` | daily 03:00 | Last run "indexed" with no new documents | Keep |
| root crontab `run_periodic_crawler.py` | daily 03:30 | "No new or changed file, exit without work" | Keep |
| certbot, e2scrub, sysstat | system | Standard | Keep |

### systemd timers (active)

CPU time is from `journalctl ... Consumed` lines, only where systemd printed them.

| Timer | Interval | Measured | Verdict |
| --- | --- | --- | --- |
| roxira-usdt-poll | 1 min | payment poller | Keep (payments) |
| roxira-admin-snapshot | 1 min | host snapshot for the admin console | **Move** to 5 min (one-line unit edit, later) |
| roxira-autodeploy | 5 min | 8.7 / 22 / 20 s CPU per run | Keep |
| roxira-monitor-logs, monitor-synthetic | 5 min | health checks | Keep |
| roxira-marketing-publish | 15 min | publishes approved posts only | Keep |
| roxira-selfimprove-hourly | hourly | retrieval eval and latency metrics, read-only | Keep, review frequency after the key pool upgrade |
| roxira-backup-dr-run | hourly | about 6 s CPU per run (hourly backup, RPO 1 h) | Keep |
| roxira-disk-guard | hourly | 0.5 s CPU per run | Keep |
| agentdb-gc, credit-watch, codeberg-mirror | hourly | small | Keep |
| neon-offsite, qdrant-replica, telegram-offsite, backup-dr-report/check | daily or weekly | backups | Keep |
| sbom | daily | 1.2 s CPU, 46 MB peak, 4.5 min wall | Keep |
| mutation-weekly, kpi-weekly, docker-prune, cf-refresh | weekly | reports and cleanup | Keep |
| autodaemon, radar, radar-daily | none (never ran) | disabled already | Leave disabled |

Per-timer CPU for the others was not printed by systemd; all are under a few seconds per run in `sysstat`, none appears in the
top-25 RSS list.

Expected effect of stopping the six jobs above: about 530 fewer process spawns a day, no more growth of the 6.5 MB of mesh, QA and tech-scout logs, 288 fewer Qdrant searches and 864 fewer TEI/CF embeddings a day, one fewer paid OpenRouter call a day.
RAM: no measurable change. That is the honest number.

## 4. Other candidates seen (not changed)

- `roxira_umami` (58 MB): analytics container. Keep unless the owner does not read the stats; then it is a 58 MB saving.
- Two `next-server` processes of different age (14 days, 8 minutes). Check which container each belongs to before the next deploy; not verified here.
- `dockerd` at 627 MB: restart in a maintenance window (all containers restart). Owner decision.

## 5. Qdrant collections

Local volume `roxira_platform_qdrant_data`: 831 MB for 22 collections. Evidence for "who reads what" is the Qdrant access log
(`docker logs roxira_qdrant_prod`, 91,875 lines, 2026-10-13 16:17 to 2026-10-30 18:31) combined with the container
environment of `roxira_app_prod` / `roxira_enterprise_backend` (collection names only) and the code defaults in this repo.

| Collection | Disk | Reads in the last 24 h | Last read | Referenced by | Verdict |
| --- | --- | --- | --- | --- | --- |
| iran_laws_v6 | 71 MB | 747 search, 428 scroll | now | `LIGHTRAG_QDRANT_COLLECTION` | **Keep**, replicated to cloud |
| iran_rulings_v1 | 63 MB | 305 search | now | `SMARTJUDGE_RULINGS_COLLECTION` | **Keep**, replicate (section 6) |
| iran_regulations_v3b | 29 MB | 305 search | now | `SMARTJUDGE_REGULATIONS_COLLECTION` | **Keep**, replicate |
| judicial_precedents | 9 MB | 0 | never in log | env + `JUDICIAL_PRECEDENTS_COLLECTION` | Keep (env points at it) |
| judiciary_circulars | 6 MB | 0 | never in log | env | Keep |
| legal_advisory_opinions | 4 MB | 0 | never in log | no env | Review |
| iran_laws_v3 | 65 MB | 0 | 2026-10-14 | default of `laws_public.py`, `qdrant_replica.py` | **Keep until the default is changed** |
| iran_laws_v2 | 56 MB | 0 | never in log | default of `lightrag_engine.py` fallback | Keep until default changed |
| iran_laws_bge_m3 | 65 MB | 0 | never in log | default of the citation guard and law ingester | Keep until default changed |
| iran_laws_mistral_v1 | 13 MB | 0 | never in log | `LEGAL_COLLECTION_NAME` (code replaces it, vectors are not bge-m3) | Keep until env changed |
| iran_regulations_v1 | 8 MB | 0 | 2026-10-14 | default of `regulations_public.py` | Keep until default changed |
| iran_laws_v4 | 90 MB | 0 | 2026-10-14 | no env, no code default | **Candidate** |
| iran_laws_v5 | 67 MB | 0 | 2026-10-14 | no env, no code default | **Candidate** |
| iran_laws_v7 | 86 MB | 0 | 2026-10-22 | build/eval scripts only | **Candidate** |
| iran_laws_v7b | 85 MB | 0 | 2026-10-22 | none (no file mentions it) | **Candidate** |
| iran_laws_v8h | 79 MB | 0 | 2026-10-22 | gate scripts only | **Candidate** (hybrid BM25 was rejected 2026-10-22) |
| iran_regulations_v2 | 10 MB | 0 | 2026-10-23 | eval script only | **Candidate** |
| iran_regulations_v3 | 11 MB | 0 | 2026-10-22 | build scripts only | **Candidate** |
| iran_laws_phase1_test | 12 MB | 0 | never in log | docs only | **Candidate** |
| research_knowledge_base, smartjudge_learned_experience, software_factory_code_vectors | 22 MB | 0 | never in log | factory code | Keep, tiny |

Candidates total about 440 MB of disk. RAM cost is about zero: with `on_disk_payload` and mmap, the whole Qdrant process is 111 MB.

Proof still missing before any deletion (this is why nothing is deleted here):

1. **No off-server copy exists.** The nightly replica copies only `iran_laws_v6` to Qdrant Cloud
   (journal: `iran_laws_v6 cloud_count 6304 = local_count 6304`). `QDRANT_REPLICA_COLLECTIONS` is not set in `/opt/roxira_platform/.env`.
2. The access log covers 17 days only and cannot see a reader that runs less often than that (for example a yearly report).
3. Seven candidate names appear in build or eval scripts that someone may re-run to compare versions.

Plan, in order, each step reversible:

1. Change the four code defaults (v3, v2, bge_m3, regulations_v1) to the live collections in a reviewed PR.
2. Create a Qdrant snapshot of each candidate and store it in R2 (encrypted, `age`) and on one spare cloud cluster
   (`QDRANT_CLOUD_URL_2`). Verify by restoring one snapshot into a throwaway collection and comparing point counts.
3. Wait one more week of access logs with no reads.
4. Delete one candidate at a time with `DELETE /collections/<name>` after the owner approves the list. Restore path: upload the snapshot.

Snapshots: `/qdrant/snapshots` inside the Qdrant container is 1.1 GB, of which `iran_laws_v3` 585 MB, `iran_laws_bge_m3` 129 MB,
`iran_rulings_v1` 126 MB, `iran_laws_v2` 112 MB. These are leftovers from earlier manual snapshots (the nightly replica deletes
its own). They belong to the backup/cleanup workstream, which must confirm an off-server copy first. Not touched here.

## 6. What this PR changes and the owner commands

Code (all inert until the owner turns something on):

| Change | File |
| --- | --- |
| Rulings "latest" listing now reads local Qdrant first and then every Qdrant Cloud cluster (it only knew the local host); it filters by sub-collection on the server, pages through up to 5000 points instead of the first 200, and no longer caches an empty answer | `smartjudge/rulings_retrieval.py` |
| Batch embedding builds can use Modal: `EMBED_BACKEND=modal` in `build_v7.py`, refused unless `MODAL_PARITY_OK=1` after the parity test | `scripts/legal/build_v7.py` |
| Dry-run-first script that moves the six useless cron entries out of the way and can put them back | `scripts/ops/load_audit/stop_useless_jobs.sh` |
| Dry-run-first script that sets `WORKBENCH_BACKEND=daytona` for the agent queue | `scripts/ops/load_audit/enable_daytona_workbench.sh` |
| Tests for all of the above | `scripts/ops/load_audit/tests`, `test_qdrant_cloud_failover.py`, `test_build_v7.py` |

Already present and verified, so not rebuilt: vector search failover to four Qdrant Cloud clusters (`legal_graph/qdrant_cloud.py`),
the Daytona runner (`daytona_runner.py`), and the Modal embedding function (`scripts/infra/modal_embed.py`).

Owner commands, in this order, after the PR is merged and srv1 has the new files (`autodeploy` or `git pull`):

```bash
# 1. Stop the useless jobs (look at the dry run first)
ssh roxira-prod 'cd /opt/roxira_platform && bash scripts/ops/load_audit/stop_useless_jobs.sh'
ssh roxira-prod 'cd /opt/roxira_platform && bash scripts/ops/load_audit/stop_useless_jobs.sh --apply'

# 2. Agent checks on Daytona (restarts only roxira-taskq)
ssh roxira-prod 'cd /opt/roxira_platform && bash scripts/ops/load_audit/enable_daytona_workbench.sh'
ssh roxira-prod 'cd /opt/roxira_platform && bash scripts/ops/load_audit/enable_daytona_workbench.sh --apply'

# 3. REQUIRED for rulings/regulations failover: replicate the two live collections that are not on Qdrant Cloud yet
#    (adds one line to .env; the timer runs nightly, the second command runs it now)
ssh roxira-prod 'echo "QDRANT_REPLICA_COLLECTIONS=iran_laws_v6,iran_rulings_v1,iran_regulations_v3b" >> /opt/roxira_platform/.env'
ssh roxira-prod 'systemctl start roxira-qdrant-replica.service; journalctl -u roxira-qdrant-replica -n 20 --no-pager'
```

Modal for batch embedding stays off until the parity test passes once (`docs/infra/MODAL_EMBED_PARITY.md`); then run a build with
`EMBED_BACKEND=modal MODAL_PARITY_OK=1`. Production query embedding stays `EMBED_BACKEND=cf` with TEI fallback.

Rollback:

```bash
ssh roxira-prod 'cd /opt/roxira_platform && ls /var/backups/roxira-disabled-jobs/'
ssh roxira-prod 'cd /opt/roxira_platform && bash scripts/ops/load_audit/stop_useless_jobs.sh --rollback /var/backups/roxira-disabled-jobs/<stamp>'
ssh roxira-prod 'cd /opt/roxira_platform && bash scripts/ops/load_audit/enable_daytona_workbench.sh --rollback'   # changes only its three variables
ssh roxira-prod 'sed -i "/^QDRANT_REPLICA_COLLECTIONS=/d" /opt/roxira_platform/.env'
```

Expected savings (honest): about 530 process spawns, the mesh/QA log growth, 288 searches and 864 embeddings a day, one paid LLM call a day;
agent test runs stop using up to 2 GB of RAM on srv1 while they run; zero change in resident RAM from the cron work.
Larger RAM wins are the `dockerd` restart and a memory cap on the Python core (section 2), which need an owner decision.
Collection cleanup frees about 440 MB of disk and nearly no RAM, and only after section 5.

## 7. How this was measured

`free -m`, `swapon --show`, `docker stats --no-stream`, `ps -eo ... --sort=-rss`, `docker system df`, `cat /etc/cron.d/*`,
`crontab -l`, `systemctl list-timers --all`, `journalctl -u <timer>.service --since "24 hours ago"`, log tails in `/var/log`,
`du` on the Qdrant volume and `/qdrant/snapshots`, `docker logs roxira_qdrant_prod` grouped by `/collections/<name>/points/*`,
`env | grep COLLECTION` inside two containers, and `grep` over this repo. Reading the Qdrant API key was deliberately not done;
counts per collection come from disk size and the access log.
