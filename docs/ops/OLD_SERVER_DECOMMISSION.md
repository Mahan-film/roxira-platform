# Old server (5.75.200.67 / `roxira-old`) decommission readiness

Status as of **2026-11-04** (read-only audit; nothing was changed on either server).
**Verdict: NOT YET.** The 7-day clock is not complete, and the old server cannot be inspected right now.

## 1. Criterion (owner decision)

Decommission only after **7 consecutive days of successful backups on srv1** plus **a passing restore drill**.
Nothing else is required, but the owner must give the final OK in writing.

## 2. Where we are

Source: `journalctl -u roxira-backup-dr-run.service` and `/var/lib/roxira-backup/*.env` on srv1.

| Date (UTC) | Daily backup run (01:07) | Notes |
| --- | --- | --- |
| 2026-10-30 | FAILED hourly until 17:42, then OK | Not counted: the day had failures. |
| 2026-10-31 | OK (17 s, 0 warnings) | Day 1 |
| 2026-11-01 | OK (23 s, 2 warnings) | Day 2. Drill passed 05:10; check OK 04:33. |
| 2026-11-02 | OK (17 s) | Day 3 |
| 2026-11-03 | OK (23 s) | Day 4 |
| 2026-11-04 | OK (21 s), `status.env` LAST_RESULT=OK | Day 5 |
| 2026-11-05 / 06 | pending | Day 6 / 7 |

- Counting from 2026-10-31 the 7th successful day is **2026-11-06**.
- If the owner counts from 2026-11-03 (the date this audit was requested), the 7th day is **2026-11-09**.
- Restore drill: `DRILL_RESULT=OK` at 2026-11-01 05:10 UTC (`pipeline (throwaway key)`; PG databases restored, qdrant skipped as empty by design for `agentdb_template_1`). The drill timer is weekly; the next run is **Sun 2026-11-08 05:11 UTC**. Recommended: wait for that second pass, so the drill post-dates the 7 days of backups.
- Offsite (R2): `R2_LAST_RESULT=OK`, hourly `pgcfg` sets (last 2026-11-04 01:37 UTC, 85 MB).
- Mac pull (`~/Backups/roxira-dr/pull.log`): one entry, 2026-11-03 18:39, `mode=rsync`, newest set `20261103T010736Z`; an earlier attempt at 18:37 found srv1 unreachable. The pull is not yet a daily history, so do not use it as evidence of 7 days.
- Caveat: `BACKUP_MODE=local-only` in `status.env`. The sets live on srv1 itself (plus the R2 hourly pgcfg and the Mac copy). Disk on srv1 is at 76-79 %.

Earliest sensible date: **Sunday 2026-11-08 after the drill, realistically Monday 2026-11-09**.

## 3. Old server state

- `ping` has no reply; TCP 22 and 443 accept connections, but `ssh roxira-old` fails with `Connection timed out during banner exchange` (checked 2026-11-04). We therefore **could not list what is on it**. Before decommission someone must get a shell (Hetzner console / rescue) and run the checks in section 5.
- Per the migration notes it was frozen at the cutover on 2026-10-13: app containers, cron and timers stopped, **databases still up**.

## 4. Data that may exist only on the old server

Not verified (host unreachable). Candidates to check, none confirmed:

1. Anything written to its Postgres, Qdrant or Twenty after the cutover set was taken on 2026-10-13 (should be nothing, as the app was stopped).
2. The old `.env` / secret files (the old `.env` lacked `TWENTY_DB_PASSWORD`, which was copied from container env). Treat as secrets: do not copy them into git or chat.
3. `x-ui` / VPN state (disabled on srv1; only needed if the VPN users still depend on the old config).
4. Logs, `data/` crawler output and agent work directories that were never part of the DR set.
5. Cloudflare tunnel / DNS records that still point at `5.75.200.67` (aratai.ir `www` is a tunnel CNAME; check it does not reference the old origin).
6. Hetzner-side items: snapshots, volumes, floating IPs, firewall rules attached to the old project.

## 5. Steps for the owner (when the date has passed)

1. Confirm on srv1 that the last 7 daily runs are OK and the drill is OK:
   ```bash
   ssh roxira-prod 'cat /var/lib/roxira-backup/status.env /var/lib/roxira-backup/drill.env; journalctl -u roxira-backup-dr-run.service --since "7 days ago" --no-pager | grep -E "backup run|FAILED"'
   ```
2. Get a shell on the old server (Hetzner Cloud console if SSH still times out) and list what is there:
   ```bash
   docker ps -a; df -h; ls -la /opt/roxira_platform/data /etc/roxira; crontab -l
   ```
   Copy anything from section 4 that matters to srv1 or the Mac (`~/Backups`, never into git).
3. Check nothing still points at it: Cloudflare DNS for the 7 domains and the tunnel config; `git grep 5.75.200.67` for scripts.
4. Take a final Hetzner snapshot of the old server and keep it ~30 days (cheap rollback).
5. Power off the old server (do not delete yet) and watch the site and the daily backup for 48 h.
6. Delete the server and the snapshot after the grace period, then remove the `roxira-old` alias from `scripts/ops/ssh_config.example` in a PR.

Rollback during steps 4-5: power the server on again and point Cloudflare back; the DBs are intact as frozen on 2026-10-13.
