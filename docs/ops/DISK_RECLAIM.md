# Production Disk Reclaim Runbook

Target: keep root filesystem `/` below **60%** usage.

## 1. Read-Only Audit First
Run the audit script (prints candidates only, never deletes):
```bash
bash scripts/ops/disk_reclaim_plan.sh
```

## 2. Keep-List (NEVER delete)
- **Qdrant** data volumes and snapshots
- **Postgres** data volumes and **WAL** archives
- **Current running images** (all images referenced by `docker compose ps`)
- Named Docker volumes (`docker volume ls`)

## 3. Safe Prune Commands (Owner Approval Required)
Only run after reviewing the output of `disk_reclaim_plan.sh`:

1. Remove dangling images:
   ```bash
   docker image prune -f
   ```
2. Remove build cache older than 7 days (168h):
   ```bash
   docker builder prune --filter "until=168h" -f
   ```
3. Remove unused (unreferenced) images if still above 60%:
   ```bash
   docker image prune -a --filter "until=168h" -f
   ```

## 4. Existing Timers
Reuse the existing `disk-guard` and `docker-prune` systemd timers; do not create duplicate timers.
