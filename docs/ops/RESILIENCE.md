# Resilience / self-healing (W23)

Audited read-only against production (`5.75.200.67`, `/opt/roxira_platform`) on
2026-09-28. Scope: what happens when a container crashes, a deploy goes bad,
or the site goes down, and how fast we find out and recover.

## 1. Audit findings

### Restart policies — already good
Every container in `docker-compose.prod.yml`, plus the two Twenty CRM and two
sandbox containers running alongside it, already has `restart: always` (or
`unless-stopped` for the two Software Foundry sandboxes). Docker itself
restarts on host reboot via the `docker` systemd service. **No change
needed here.**

### Healthchecks — gaps closed in this PR
Before this PR:

| Service | Healthcheck before | Source |
| --- | --- | --- |
| `postgres_prod` | yes (`pg_isready`) | compose |
| `pgbouncer_prod` | yes (`pg_isready`) | compose |
| `roxira_enterprise_backend` | yes (`curl /docs`) | Dockerfile |
| `roxira_enterprise_frontend` | yes (`curl /`) | Dockerfile |
| `enterprise_app` (FastAPI/judge, port 8000) | **none** | — |
| `nginx_gateway` | **none** | — |
| `redis_prod` | **none** | — |
| `qdrant_prod` | **none** | — |

This PR adds compose-level healthchecks for `enterprise_app` (curl
`/health`, which returns 200 from inside the container — the nginx 404 on
`/health` from outside is a separate, pre-existing routing gap, see Known
issues in `docs/STATE.md`), `nginx_gateway` (curl against itself, not `-f`,
so a 502 from a *down upstream* does not flap nginx's own health status —
only a refused/timed-out connection does), `redis_prod` (`redis-cli ping`),
and `qdrant_prod` (a `bash /dev/tcp` probe — the `qdrant/qdrant` image ships
neither `curl` nor `wget`, only `bash`, verified by `docker exec ... which`).
Backend and frontend healthchecks are intentionally **not** duplicated in
compose; they already come from `HEALTHCHECK` in their Dockerfiles, and
redefining them in compose would silently override that image if the two
drift.

### Log rotation — already enforced at the Docker daemon level
`/etc/docker/daemon.json` on the host already sets `json-file` with
`max-size: 20m`, `max-file: 3` for **every** container (verified via
`docker inspect --format '{{.HostConfig.LogConfig}}'` on all 13 running
containers — all inherit the daemon default). This PR also adds the same
`logging:` block explicitly to `docker-compose.prod.yml` for the services it
touches, so the policy survives if the daemon default is ever changed or the
compose file is used against a different host.

### Backups — a working hourly job already exists
`root`'s crontab runs `scripts/auto_backup_daemon.sh` every hour
(`0 * * * *`, logs to `/var/log/roxira_backup.log`). It does:
- `pg_dump --clean --if-exists` of `enterprise_db`, gzip -9.
- a raw `tar.gz` of the Qdrant container's `/qdrant/storage` directory.
- 7-day retention (`find ... -mtime +7 -delete`).
- a `flock` lock so overlapping runs no-op instead of racing.

`/opt/roxira_backups` held ~2.1 GB at audit time (hourly Qdrant archives
~39 MB each). `scripts/ops/pull_backups_to_mac.sh`, installed as a daily
`launchd` job on the owner's Mac (`scripts/ops/install_mac_backup_pull.sh`),
pulls the newest Postgres + Qdrant archive off the server every day — this
is the off-site copy. It also separately backs up the Twenty CRM database,
which the hourly job does not cover.

This PR adds `scripts/ops/backup.sh` per the W23 spec: nightly, 7-day
retention, and — the one real improvement over the existing job — it uses
Qdrant's **HTTP snapshot API** (`POST /snapshots`, download, then
`DELETE /snapshots/{name}` to avoid growing the container's own disk)
instead of tarring the live storage directory, which can in principle catch
Qdrant mid-write. **This duplicates `auto_backup_daemon.sh`'s job at a
different cadence — do not enable both `roxira-backup.timer` and the
existing cron line for the same window.** See the runbook below for the
tradeoff; picking one is the owner's call, since it touches what
`pull_backups_to_mac.sh` reads.

Also noted: three older, one-off backup scripts on the server
(`create_full_backup.sh`, `create_bulletproof_backup.sh`,
`create_master_certified_backup.sh` in `/root/`) that are not on any timer —
out of scope for this PR, flagging only.

### Disk
`/` (and `/var/lib/docker`, same partition): 150 GB total, 81 GB used, 64 GB
free (56%). Not urgent, but hourly Qdrant snapshots (~39 MB × up to 168/week
before pruning) plus nightly backups if both jobs run would roughly double
the steady-state backup footprint. Worth revisiting the cadence, not the
scope of this PR.

### Certbot
`certbot.timer` is active and enabled (runs twice daily, last successful
trigger seen in the audit window). Certs for `ghazihoushmand.ir`, `roxira.ir`
and `roxira.net` are configured (`/etc/letsencrypt/renewal/*.conf`). No
change needed.

### Other systemd timers observed
`roxira-worker.timer`, `roxira-autodaemon.timer`, `roxira-radar.timer`,
`sysstat`, `logrotate.timer`, `dpkg-db-backup.timer`, `fstrim.timer`,
`apt-daily*.timer`, `motd-news.timer`, `update-notifier*.timer` — all
standard Ubuntu/Roxira infra, nothing dangerous observed.

### Dangerous or notable things found (flagging, not fixing — out of scope for W23)
- **A kernel reboot is pending** (`/var/run/reboot-required` present) — already
  known (`docs/STATE.md`). A reboot with no supervised restart check could
  currently leave the operator unsure the stack came back cleanly; this PR's
  `uptime.yml` at least gives a 15-minute-granularity alert if it doesn't.
- `enterprise_app` had **no healthcheck at all** before this PR — a hung
  (not crashed) FastAPI process would have kept `restart: always` from ever
  firing, and nginx would keep routing to it. Closed above.
- `nginx_gateway` had no healthcheck either — same risk for the actual
  front door.
- Three unscheduled, undocumented one-off backup scripts sit in `/root/`
  (see above) — dead weight or a false sense of safety, worth a cleanup pass
  outside this PR.
- `.env` on the server is owned `501:staff` (a macOS uid/gid, from an rsync
  push at some point) rather than `root:root` — harmless today (mode 600,
  root-only), but a papercut worth fixing in a future pass.

## 2. What this PR changes

1. `docker-compose.prod.yml`: healthchecks for `enterprise_app`,
   `nginx_gateway`, `redis_prod`, `qdrant_prod`; explicit `logging:` blocks
   (`json-file`, `max-size: 20m`, `max-file: 3`) on every service this PR
   touches, matching the daemon default. Restart policies were already
   `always` everywhere — untouched.
2. `scripts/ops/deploy.sh` — tags the current image of each named service as
   `:prev`, builds + recreates only those services, polls
   `docker inspect .State.Health.Status` until `healthy` (or a fixed grace
   period for services with no healthcheck), and calls `rollback.sh` for
   every touched service plus an nginx reload if any of them fails.
   `scripts/ops/rollback.sh <service>` retags `:prev` back to `:latest`,
   recreates just that service, and waits for it to come back healthy.
3. `scripts/ops/backup.sh` — nightly Postgres `pg_dump` (gzip, 7-day
   retention) + Qdrant snapshot via the HTTP snapshot API.
   `deploy/systemd/roxira-backup.service` + `.timer` — **not installed by
   this PR**; `deploy/systemd/README.md` has the install/remove commands,
   gated on owner approval per repo rules.
4. `.github/workflows/uptime.yml` — every 15 minutes on `ubuntu-latest`:
   `GET https://ghazihoushmand.ir/` expecting 200, and
   `POST /api/v1/apps/judge/payments/create-invoice` with `{}` expecting
   400 (proves the payment route is alive without creating a real invoice —
   an empty body should fail Zibal/DTO validation, not 404/500/timeout). On
   failure it opens or comments on a single open issue labelled `incident`.
   No secrets needed (uses `github.token` for the issue API, same pattern as
   the existing `e2e-smoke.yml`). **The `incident` label must exist in the
   repo before the workflow can create an issue with it** — if it doesn't,
   `gh issue create --label incident` will fail; create the label once via
   the GitHub UI or `gh label create incident`.

## 3. Runbook (راهنمای فارسی)

### وقتی سایت پایین است (چک‌های ۱۵ دقیقه‌ای `uptime.yml` شکست خورده)
1. ایشو با برچسب `incident` را در گیت‌هاب باز کنید — لینک اجرای Actions که
   شکست خورده در متن ایشو هست.
2. با `ssh 5.75.200.67` وارد شوید و وضعیت کانتینرها را ببینید:
   `docker ps --format 'table {{.Names}}\t{{.Status}}'`
   هر سرویسی که `(unhealthy)` یا `Restarting` نشان می‌دهد را با
   `docker logs --tail 100 <name>` بررسی کنید.
3. اگر nginx بالا نیست: `docker exec roxira_nginx_prod nginx -t` (خطای
   کانفیگ) سپس `docker exec roxira_nginx_prod nginx -s reload`.
4. اگر علت یک دیپلوی اخیر است: `scripts/ops/rollback.sh <service>` را روی
   سرور اجرا کنید (مثلاً `enterprise_app` یا
   `roxira_enterprise_backend` — نام سرویس در `docker-compose.prod.yml`، نه
   نام کانتینر).
5. بعد از هر ریکاوری، `docker exec roxira_nginx_prod nginx -s reload` را
   فراموش نکنید — nginx آی‌پی کانتینرهای بازسازی‌شده را کش می‌کند.
6. تأیید نهایی: `curl -I https://ghazihoushmand.ir/` باید ۲۰۰ بدهد؛
   `curl -X POST .../payments/create-invoice -d '{}'` باید ۴۰۰ بدهد (نه
   ۴۰۴/۵۰۲).

### وقتی یک دیپلوی جدید سایت را خراب می‌کند
1. `scripts/ops/deploy.sh <service...>` خودش healthcheck را چک می‌کند و اگر
   شکست بخورد به‌صورت خودکار rollback می‌کند — یعنی اگر دیپلوی از طریق این
   اسکریپت انجام شده باشد معمولاً نیازی به کار دستی نیست.
2. اگر دیپلوی دستی (بدون `deploy.sh`) بوده: `scripts/ops/rollback.sh <service>`
   را اجرا کنید. این اسکریپت به ایمیج تگ‌شده با `:prev` برمی‌گردد — این تگ
   فقط بعد از حداقل یک اجرای موفق `deploy.sh` وجود دارد.
3. اگر هیچ ایمیج `:prev` نیست (اولین دیپلوی آن سرویس بوده): باید دستی روی
   commit قبلی چک‌اوت و بیلد کنید — طبق بخش ۷ `docs/STRATEGY.md`.

### وقتی بکاپ لازم است (بازیابی دیتابیس)
- بکاپ‌های ساعتی فعلی: `/opt/roxira_backups/postgres_*.sql.gz` و
  `qdrant_*.tar.gz` (اسکریپت `scripts/auto_backup_daemon.sh`، از قبل روی
  کرون فعال است — این PR آن را عوض نمی‌کند).
- بازیابی Postgres: `gunzip -c postgres_<تاریخ>.sql.gz | docker exec -i
  roxira_postgres_prod psql -U enterprise_admin -d enterprise_db`
- کپی آفلاین روی مک مالک هر روز با `scripts/ops/pull_backups_to_mac.sh`
  انجام می‌شود (لانچ‌دی مک).
- اگر تایمر nightly جدید (`roxira-backup.timer`) بعداً با تأیید مالک نصب شد،
  فایل‌های Qdrant با پسوند `.snapshot` (نه `.tar.gz`) خواهند بود — بازیابی
  آن‌ها یعنی کپی فایل به `/qdrant/snapshots/` داخل کانتینر و فراخوانی
  `PUT /collections/{name}/snapshots/recover` روی API کوئدرنت.

### وقتی دیسک پر می‌شود
- `df -h /` را چک کنید. اگر بکاپ‌ها علت هستند،
  `ROXIRA_BACKUP_RETENTION_DAYS` را در کرون/تایمر کم کنید یا یکی از دو مسیر
  بکاپ (ساعتی یا nightly) را غیرفعال کنید — هر دو را همزمان نگه ندارید.

## 4. What needs the owner's approval before it does anything on prod
- Installing `deploy/systemd/roxira-backup.timer` (and deciding whether to
  keep, replace, or run it alongside the existing hourly cron backup).
- Creating the `incident` GitHub label if it does not already exist, so
  `uptime.yml` can label the issues it opens.
- Anything from the "flagging, not fixing" list above (the `.env` ownership
  papercut, the three unscheduled `/root/` backup scripts, the pending
  kernel reboot).
