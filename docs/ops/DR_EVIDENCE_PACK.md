# Backup & Disaster Recovery Evidence Pack (T287)

**Last Updated:** 2026-11-24  
**Owner Issue:** `#1110` (T287, R29)  
**Related Runbooks:** `docs/ops/DISASTER_RECOVERY.md`, `docs/ops/OFFSITE_BACKUP.md`, `docs/ops/BACKUP_RETENTION.md`, `docs/ops/BACKUP_EMAIL.md`, `docs/ops/RESTORE_DRILL.md`

---

## 1. Reconciliation: `docs/STATE.md` vs `docs/security/SECURITY_AUDIT_2026-10-20.md`

`docs/strategy/research/R29_DIGEST.md` flagged a documentation conflict between earlier `docs/STATE.md` claims (hourly encrypted off-site backups) and `docs/security/SECURITY_AUDIT_2026-10-20.md` Finding #1 (no restic off-site copy configured on production; Mac pull was the only second copy).

Reconciled status as of **2026-11-24**:

| Layer | Code in Repo | Production Rollout Status |
|---|---|---|
| **Restic + `age` DR suite** (`scripts/ops/backup/server_backup.sh`, `restore.sh`, `deploy/systemd/roxira-backup-dr-*.timer`) | Delivered & unit-tested (`59 passed` in `scripts/ops/backup/`) | **Pending owner rollout** (`docs/ops/DISASTER_RECOVERY.md:3`). |
| **Off-site Neon + Codeberg** (`scripts/ops/backup/neon_offsite.sh`, `docs/ops/OFFSITE_BACKUP.md`) | Delivered | Requires owner env (`NEON_BACKUP_URL`, `CODEBERG_TOKEN`) on server. |
| **Age-encrypted daily email bundle** (`docs/ops/BACKUP_EMAIL.md`) | Delivered | Active once `BACKUP_AGE_RECIPIENT` + SMTP env are set. |
| **Legacy hourly `pg_dump` + Mac daily pull** (`scripts/auto_backup_daemon.sh`, `pull_backups_to_mac.sh`) | Active | Provides local dumps + Mac second copy until DR suite rollout completes. |
| **Object Lock (WORM) off-site bucket** | Supported via restic S3 backend (`scripts/ops/backup/lib.sh`) | **Owner action required:** provision S3/R2/B2 bucket with Object Lock enabled (30-day retention) and set `BACKUP_S3_*` in `/etc/roxira/backup.env`. |

---

## 2. Written RPO & RTO Targets

| Metric | Target | Mechanism |
|---|---|---|
| **RPO (Recovery Point Objective)** | **<= 1 hour** | Hourly `server_backup.sh run` (`roxira-backup-dr-pgcfg.timer`), daily Neon off-site restore (`02:40 UTC`), daily age-encrypted email bundle (`06:30 UTC`). |
| **RTO (Recovery Time Objective)** | **< 4 hours** | `scripts/infra/bootstrap_new_server.sh --restore` (`restore.sh --full`). Total dataset size is ~0.3 GB (Postgres + Qdrant); recovery time is dominated by package/Docker installation and DNS propagation. |
| **Retention** | 6 hourly + 3 daily local; 7 daily / 4 weekly / 6 monthly off-site; 30-day Object Lock | `scripts/ops/backup/retention.py` + `docs/ops/BACKUP_RETENTION.md` + Object Lock bucket policy. |

---

## 3. Object Lock (Immutable Off-Site Copy) Design

To protect against ransomware or accidental/malicious deletion of backup snapshots:
1. Configure a dedicated S3-compatible bucket (Hetzner Object Storage, Cloudflare R2, or Backblaze B2) with **Object Lock enabled** in **Governance or Compliance mode** and a **30-day default retention**.
2. Add the repository URL and restricted write-only/append credentials to `/etc/roxira/backup.env` (`BACKUP_S3_REPO`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) — never in git.
3. `server_backup.sh run` automatically pushes deduplicated, client-side AES-256 encrypted restic snapshots to every configured repository, and `restic check --read-data-subset=5%` runs weekly (`Sunday 04:30 UTC`).

---

## 4. Quarterly Restore-Test Log

| Date (UTC) | Scope | Environment | Result | Evidence |
|---|---|---|---|---|
| **2026-11-24** | Synthetic PostgreSQL 17 `pg_dump -Fc` -> `pg_restore --clean --if-exists --no-owner --no-acl` + backup script unit suite | Throwaway Docker `postgres:17` containers on Mac (non-prod) | **PASS** (`elapsed_s=1`, `dump_bytes=1752`, `verify=2\|400000`; `59 passed in 6.84s` for `pytest scripts/ops/backup/ -q`) | Executed for `#1110` (T287); no production data touched. |
| *Next scheduled: 2027-Q1* | Full `~/RoxiraBackups/` / restic Mac drill (`docs/ops/RESTORE_DRILL.md`) | Owner Mac throwaway containers | *Pending owner run* | Verify `payment_orders`, `users`, and Qdrant collection counts. |
