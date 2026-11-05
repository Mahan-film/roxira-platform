# New server: sizing, migration runbook, baseline security, tooling verdicts

- **Date:** 2026-10-12. **Branch:** `docs/server-migration-plan`. **Status:** plan only. Nothing was run on the old or a new server.
- **Basis:** `docs/infra/INFRA_MAP_2026-10-09.md`, `docs/ops/DISASTER_RECOVERY.md` (section 8.3 is the planned-migration skeleton this plan expands), `scripts/ops/backup/*`, `docker-compose.prod.yml`, `docs/infra/CLOUDFLARE_ORIGIN_LOCKDOWN.md`, plus web checks made on 2026-10-12 (links in section 6).
- **Live access:** `ssh 5.75.200.67` was refused by the agent sandbox ("Operation not permitted"), so no live read-only check was possible. Every "current state" claim below comes from the repo docs and from the measured numbers the owner gave. Re-verify with the read-only commands in step 0 before ordering.
- Companion files: `scripts/infra/bootstrap_new_server.sh` (host baseline, idempotent, `--dry-run`), `scripts/infra/migrate_checklist.md` (Persian, ordered, owner-facing).

## خلاصه (فارسی)

**سایز پیشنهادی:** رم ۱۶ گیگ و دیسک ۱۶۰ گیگ (۸ هسته)، یا اگر هزینه مهم‌تر است ۸ گیگ رم با ۴ هسته و حداقل ۸۰ گیگ دیسک (ترجیحاً ۱۶۰). ۸ گیگ برای مصرف عادی کافی است (امروز حدود ۳ تا ۴ گیگ از ۱۵ گیگ مصرف می‌شود) ولی هنگام build ایمیج‌ها (torch و Next.js) و اگر بعداً reranker یا مدل دوم اضافه شود تنگ می‌شود. دیسک: مصرف واقعی بعد از پاکسازی حدود ۴۵ تا ۵۵ گیگ است؛ ۸۰ گیگ حداقل است و ۱۶۰ گیگ راحت.

**معماری و موجودی:** صفحه‌های رسمی Hetzner در ۲۰۲۶-۱۰-۱۲ همه‌ی پلن‌ها (از جمله CAX آرم) را «فعلاً موجود نیست» نشان دادند. این ممکن است ناشی از خواندن صفحه بدون جاوااسکریپت باشد؛ پس قبل از هر تصمیم در کنسول Hetzner چک شود. اگر آرم موجود نبود، x86 (CPX/CX/CCX) هم کار می‌کند ولی باید ایمیج‌ها دوباره build شوند و باینری xray مربوط به x-ui عوض شود (بخش ۱.۳). بدون تغییر معماری ریسک کمتر است.

**روش مهاجرت:** سرور جدید را کنار سرور قدیم بالا می‌آوریم، با همان بکاپ‌های رمزگذاری‌شده (restic/age) و اسکریپت‌های موجود `restore.sh` پر می‌کنیم، با `curl --resolve` تست می‌کنیم و فقط در لحظه‌ی قطع اتصال، رکورد A در Cloudflare را عوض می‌کنیم (پروکسی است، پس تقریباً فوری). سرور قدیم ۴۸ ساعت خاموش ولی سالم می‌ماند برای بازگشت. زمان قطع نوشتن (maintenance) تخمیناً ۱۵ تا ۳۰ دقیقه است.

**سه یافته‌ی مهم که قبل از شروع باید حل شود:**
1. `restore.sh` نام سرویس‌های compose را اشتباه می‌زند (`postgres`/`qdrant` به‌جای `postgres_prod`/`qdrant_prod`) و کانتینرهای Twenty با `docker run` ساخته شده‌اند و در هیچ compose نیستند؛ بدون دور زدن، ریستور وسط کار متوقف می‌شود (بخش ۲، مراحل ۵ و ۶).
2. سیستم بکاپ DR طبق مستندات هنوز «roll out» نشده یا وضعیتش تأیید نشده است؛ بدون یک اجرای موفق `server_backup.sh run` و یک ریستور آزمایشی، مهاجرت نکنید.
3. IP جدید باید در هر سرویسی که IP سرور را whitelist می‌کند (پیامک، درگاه پرداخت، ...) اضافه شود؛ این در ریپو تأیید نشده، پس باید دستی چک شود.

**ابزار پیشنهادی (یک استک):** اسکریپت bootstrap ایدمپوتنت (+ cloud-init حداقلی) + docker compose + `deploy_local.sh` فعلی + restic/age + Cloudflare (CF-only firewall، AOP اختیاری) + Beszel برای متریک + یک pinger بیرونی. Coolify/Dokploy/Kamal/Watchtower/Ansible فعلاً skip. Tailscale و Cloudflare Tunnel فقط trial (به دلیل دسترسی از ایران، بخش ۴).

---

## 1. Sizing

### 1.1 RAM

Measured: 15 GiB host, about 3 GB used by the app (infra map 2026-10-09 showed 4.1 GiB used and 11 GiB available with all 15 containers up). Estimated steady-state split (estimates, not measurements; confirm with `docker stats --no-stream` on the old host before ordering):

| Component | Rough resident RAM | Reason |
|---|---|---|
| `enterprise_app` (FastAPI + bge-m3 on torch CPU) | 2.5-3.5 GB | bge-m3 is about 568M parameters; fp32 weights alone are about 2.3 GB, plus torch runtime and request buffers |
| Qdrant | 0.3-0.6 GB | 183 MB of data, 10 collections, about 8-9 thousand points. Even 10x growth stays far below 8 GB |
| Postgres 17 + PgBouncer + Redis | 0.3-0.5 GB | the DB is 20-75 MB |
| NestJS backend, Next.js frontend, nginx | 0.6-0.9 GB | |
| Twenty CRM (server + its Postgres 16 + Redis) | 0.8-1.2 GB | node server is the heavy part |
| SearXNG + Valkey, sandboxes, dispatcher | 0.3-0.6 GB | |
| Page cache + OS | 1 GB+ | useful for Qdrant mmap and Postgres |

**8 GB is enough for steady state** (about 5-6.5 GB with cache) but headroom is only 1.5-3 GB. The risk is not the steady state; it is spikes:

- `docker compose build` of the torch image and the Next.js build (each can take 2-4 GB). Today `deploy_local.sh` builds on the server.
- A second model (the roadmap lists a reranker and an embedder A/B, `docs/STATE.md` next steps 8): +1 to 2 GB each.
- Twenty import jobs.

Decision rule:

| Situation | Choice |
|---|---|
| Builds stay on the server, or a reranker/second model is planned in the next 6 months, or the Roxira factory will host more containers on this box | **16 GB** |
| Cost is the main constraint, builds are moved off the box (build on the Mac, `docker save`/push), no new models | **8 GB** + 4 GiB swap (the bootstrap script adds it automatically) |

The price difference between the 8 GB and 16 GB plans of the same family is small compared with one incident, so the default recommendation is **16 GB**. Set per-container `mem_limit` on `enterprise_app` (about 4 GB) and on Twenty in either case, so one runaway container is OOM-killed instead of the host.

### 1.2 Disk

Measured on 2026-10-12 (owner): images 12.8 GB, containers 4.6 GB, volumes 3 GB, build cache 4-10 GB (pruned weekly now), `/root` 8 GB, logs 1.5 GB, backups 0.7-1.4 GB, repo 1.6 GB.

| Item | Day-1 on the new server | Notes |
|---|---|---|
| OS + packages | 5 GB | `/usr` was 3 GB |
| Docker images | 12.8 GB | arch-specific; do **not** copy `/var/lib/containerd` (48 GB on the old host, mostly dead layers). Rebuild/pull on the new host |
| Container writable layers | 4.6 GB | check why it is this large (likely model cache or logs written inside `enterprise_app`); fix before migrating, do not carry it over |
| Volumes (Postgres, Redis, Qdrant, certbot, Twenty) | 3 GB | |
| Build cache | 4-10 GB | capped by the weekly `roxira-docker-prune` timer |
| Logs | 1.5 GB | `/var/log` rotation + Docker `max-size 20m x 3` (bootstrap sets this) |
| Repo | 1.6 GB | |
| Backups on the same disk (3 hardlinked sets + age bundle) | 1-1.5 GB | `BACKUP_KEEP_HOURLY`/`DAILY` defaults, see `docs/ops/BACKUP_RETENTION.md` |
| `/root` | about 1 GB | leave the 8 GB of old tarballs, `.env` copies and `bash_history` behind (they are secrets/junk; see risk 4 in the infra map) |
| Swap file | 4 GB | only on the 8 GB plan |
| Restore scratch (temporary) | 2 GB | during migration only |
| **Total** | **about 45 GB** (50 GB with scratch) | |

Growth drivers: the legal corpus is tiny (a 10x corpus is about 2 GB of vectors), uploads are in memory only (nothing persists), so growth comes from images (each deploy keeps a `:prev` image: +2-4 GB), build cache, logs and backup retention, all bounded by the existing timers.

- **Minimum: 80 GB** (about 60% used at day 1 with a 10 GB build-cache cap; works only if prune and retention timers are enabled on day 1).
- **Comfortable: 160 GB** (about 30% used; room for two image generations, a restore scratch, and a second app). Prefer this: on Hetzner the 16 GB plans already include 160 GB.
- A Hetzner Volume (block storage) can be added later without re-provisioning, so undersizing is cheap to fix, but root-disk resize is one-way.

### 1.3 vCPU and architecture (ARM vs x86)

- **vCPU:** 4 is the minimum (embedding inference is CPU-bound and torch uses all cores; builds are parallel). 8 is comfortable and matches the current host (8 vCPU, load average 0.25 on 2026-10-09).
- **Torch is not an obstacle on either arch.** `Dockerfile.prod` installs `torch==2.14.1` from `https://download.pytorch.org/whl/cpu`, which publishes CPU wheels for both aarch64 and x86_64. The CUDA-leak assertion in the Dockerfile is arch-neutral.
- **Staying on ARM is the lowest-risk path** (same image digests, same Qdrant/Postgres binaries, same x-ui/xray binary, same build results as the current host). Switching to x86 adds these tasks:
  1. Check that every `image: ...@sha256:` pin in `docker-compose.prod.yml` is a **multi-arch index** digest, not an arm64 manifest digest: `docker buildx imagetools inspect <image>` must list `linux/amd64`. A single-arch pin fails with "exec format error" on x86.
  2. Rebuild the three built images on x86 (`enterprise_app`, backend, frontend). Check `sentence-transformers`/other wheels for aarch64-only pins in the requirements files.
  3. `restore.sh` restores `/usr/local/x-ui/bin`, which holds `xray-linux-arm64`. On x86 reinstall x-ui/xray for amd64 and restore only its database (`/etc/x-ui/x-ui.db`). Ports 8443/2053/2096 stay as they are.
  4. Qdrant snapshots and `pg_dump -Fc` dumps are architecture-independent (documented behaviour for pg_dump; for Qdrant snapshot upload verify the point counts after restore, step 6).
  5. Speed: Ampere Altra (CAX) and x86 shared vCPU are comparable for this workload; do not decide on speed. Measure once with the existing retrieval eval on the rehearsal server.

### 1.4 Hetzner products (verified 2026-10-12 from hetzner.com product pages and docs.hetzner.cloud/whats-new)

| Family | Plan | vCPU | RAM | Disk (NVMe) | Locations per Hetzner page |
|---|---|---|---|---|---|
| Cost-optimized, Arm64 (Ampere) | CAX21 | 4 | 8 GB | 80 GB | NBG1, HEL1 |
| | CAX31 | 8 | 16 GB | 160 GB | NBG1, HEL1 |
| | CAX41 | 16 | 32 GB | 320 GB | NBG1, HEL1 |
| Cost-optimized, x86 (Intel/AMD) | CX33 | 4 | 8 GB | 80 GB | NBG1, HEL1 |
| | CX43 | 8 | 16 GB | 160 GB | NBG1, HEL1 |
| Regular performance, x86 (AMD) | CPX32 | 4 | 8 GB | 160 GB | NBG1, HEL1, SIN1 |
| | CPX42 | 8 | 16 GB | 320 GB | NBG1, HEL1, SIN1 |
| General purpose, dedicated vCPU (AMD) | CCX13 | 2 | 8 GB | 80 GB | NBG1, HEL1, US, SIN |
| | CCX23 | 4 | 16 GB | 160 GB | NBG1, HEL1, US, SIN |

What I could and could not verify:

- **Prices were not shown** on the fetched pages (price fields rendered blank), so none are quoted here. Secondary sources (Northflank, Findstack, WZ-IT, 2026) report a portfolio price rise on 2026-04-01 (about 30-37%) and a second repricing effective 2026-06-15 that hit CPX and CCX hardest (+113% to +176%), while CAX11/CAX21 rose about 31-33%. Existing servers keep their old price until rescaled. Conclusion to verify in the console: **Arm CAX and cost-optimized CX are now much cheaper than CPX/CCX**, so availability of CAX decides the budget.
- **Availability:** every plan on the fetched pages showed "currently unavailable", and one secondary review reports a Hetzner status notice "Limited availability of cloud instances" open since 2026-06-26 and CX/CAX shown unavailable on 2026-08-17. A page fetched without JavaScript may show this for plans that are actually orderable, so treat it as unconfirmed. Check with `hcloud datacenter describe nbg1-dc3` (lists available server types) or the console order form. If CAX is truly gone, the order of preference is CX43 (x86, 8/16/160) then CPX42, and plan the x86 tasks in 1.3.
- Hetzner docs (2026-05-28) state price changes apply to new orders and rescales, not existing servers.
- IPv4 is billed separately in some listings (about EUR 0.50/month per one source). Not verified on Hetzner's page.

**Location and network (users reach the site through Cloudflare):** an Iranian visitor connects to the nearest Cloudflare edge; only cache misses and API calls cross to the origin, so the origin's location mostly affects API latency from the Cloudflare edge that serves Iran (typically a Gulf, Turkey or Europe PoP). Nuremberg/Falkenstein (central Germany, best peering to Frankfurt-area Cloudflare) is the safe choice; Helsinki is a few ms further; Singapore is worse for Iran and only CPX/CCX offer it. Do not pick the US. Open Iran-path issues (HTTP/3 off, challenge settings) are Cloudflare-side and are tracked in `docs/ops/SITE_HEALTH_2026-10-09.md`; a new origin does not change them. Keep the new server in the same Hetzner network family so Groq (works from the current Hetzner IP) and OpenRouter keep working, and test it in the smoke step. Outbound SMTP: Hetzner restricts ports 25/465 on new accounts by default (check the current policy); the backup mailer uses STARTTLS on 587 and must be tested.

**Recommendation:** CAX31 (Arm, 8 vCPU / 16 GB / 160 GB) in NBG1 if orderable. If not: CX43 or CPX42 (x86) with the x86 task list. If budget forces 8 GB: CAX21 / CX33 with 80 GB, accept the "builds off-box" rule.

---

## 2. Migration runbook

Goal: new server fully built and verified in parallel, then a short write freeze, a delta restore, a DNS flip, and 48 hours of rollback cover. The old host is never modified except for stopping writers at cutover (and that is reversible).

Variables used below: `OLD=5.75.200.67`, `NEW=<new ip>`, domains `ghazihoushmand.ir`, `roxira.ir`, `roxira.net` (+ `www`).

### 0. Preconditions (nothing here changes prod)

1. One bootstrap script: `scripts/infra/bootstrap_new_server.sh` (host baseline, plus `--restore`). `scripts/ops/bootstrap_new_server.sh` (PR #526) is now a stub that forwards to it with `--restore`. The runbook below runs the baseline first and the restore as separate, checkable steps.
2. Confirm the DR system really runs on the old host (docs say "not yet rolled out"; STATE says unverified):
   ```bash
   ssh $OLD 'systemctl list-timers "roxira-backup-dr-*" --no-pager; ls -ld /etc/roxira; tail -n 5 /var/lib/roxira-backup/status.env'
   ```
   If the timers are absent, run the rollout in `docs/ops/DISASTER_RECOVERY.md` section 6 first (owner approval) or take a manual set with `server_backup.sh run`. Do not migrate without one verified restore drill (`restore.sh --scratch /var/tmp/drill`, `docs/ops/RESTORE_DRILL.md`).
3. Defects found while reading the scripts, and their status in this PR:
   - `restore.sh` used wrong compose service names (`postgres`, `qdrant`) and an un-guarded `createdb` that aborted the run. **Fixed**: it now uses `postgres_prod` / `qdrant_prod` (overridable with `RESTORE_DB_SERVICES`, `RESTORE_QDRANT_SERVICE`, `RESTORE_COMPOSE_FILE`), dies loudly if compose cannot start them, and skips-with-warning (listing what was skipped) instead of aborting when a database container is not ready. Steps 5 and 6 below no longer need the manual pre-start or `BACKUP_PG_CONTAINERS` workaround.
   - Twenty (`roxira_twenty_*`) is defined in `docker-compose.modern-stack.yml` (verified read-only on prod by container labels; the infra map's "started with docker run" was wrong). **Fixed in `restore.sh`**: it starts `twenty_db`/`twenty_redis` from that file (override with `RESTORE_TWENTY_COMPOSE` / `RESTORE_TWENTY_ENV`), restores the dump, then starts `twenty_crm`; missing file or env gives a warning and skips. Its secrets (`TWENTY_DB_PASSWORD`, `TWENTY_APP_SECRET`, `TWENTY_ENCRYPTION_KEY`) come from the repo `.env`, already in the backup set. `server_backup.sh` now also backs up `twenty_data/server` (uploads), which was missing. Create the network on a new host first: `docker network create roxira_mesh`.
   - Restoring old crontabs would run the daily marketing campaign and crawlers on the new host. **Fixed**: `restore.sh --full` stops cron, holds the old crontabs under `/var/lib/roxira/cron-held`, prints every active job, and `restore.sh --apply-cron [--dry-run]` activates them at cutover after review (`--cron apply|skip` for other behaviour).
   - If switching architecture: image pins and x-ui binary (section 1.3).
4. Collect IP allowlists that contain `$OLD` (cannot be verified from the repo): SMS provider (Kavenegar), payment gateway, Google OAuth is by redirect URI (domain), Groq/OpenRouter are by key. Ask each provider to add `$NEW` before cutover. Test in the smoke step.
5. Freeze: no deploys and no migrations during the window (`touch .deploy-freeze` locally, per `docs/ops/DEPLOY_LOCAL.md`).
6. Have ready on the Mac: `~/Secrets/roxira/restic-dr.pass`, `backup-age.key`, a current Mac repo (`~/Backups/roxira-dr/restic`, `scripts/ops/backup/mac_pull.sh` has run today), Hetzner API token for `hcloud`, Cloudflare dashboard access.

### 1. Provision (about 10 minutes)

```bash
brew install hcloud                      # Mac, once
hcloud context create roxira             # paste the token when asked; it is stored in your local hcloud config
hcloud ssh-key create --name roxira-admin --public-key-from-file ~/.ssh/id_ed25519.pub
hcloud server-type list | grep -E 'cax|cx|cpx'      # confirm names, specs, current availability
hcloud server create --name roxira-2 --type cax31 --image ubuntu-24.04 --location nbg1 \
  --ssh-key roxira-admin --label project=roxira
hcloud server ip roxira-2                # = NEW
```

Optional now, strongly recommended: a Hetzner Cloud Firewall (free, outside the host) mirroring what ufw allows (22, 80/443, and whatever 8443/2053/2096 policy you run today). Create it in the console so the rules are visible; do not narrow 22/8443/2053/2096 differently from today.

Reproducibility option: Hetzner accepts cloud-init user-data (`--user-data-from-file`). A 10-line cloud-init that only creates the admin user, adds your key and runs `apt-get install -y git curl` is enough; the real configuration stays in the idempotent script so it can also be re-run on a live server. Ansible is not needed at this scale (section 4).

### 2. Harden (about 10 minutes)

```bash
scp scripts/infra/bootstrap_new_server.sh root@$NEW:/root/
ssh root@$NEW 'bash /root/bootstrap_new_server.sh --dry-run'      # read it
ssh root@$NEW 'bash /root/bootstrap_new_server.sh'                # keep this session open; sshd hardening is skipped without --i-have-key-access
ssh roxira@$NEW 'sudo ufw status verbose; sudo fail2ban-client status sshd; docker --version'   # second terminal MUST work
ssh root@$NEW true && ssh roxira@$NEW true && ssh root@$NEW 'bash /root/bootstrap_new_server.sh --i-have-key-access'   # only now: sshd keys-only
```

The script: admin user + key-only SSH (root key login stays because `deploy_local.sh` uses root), ufw (22, 80, 443; never touches 8443/2053/2096/60000:61000), fail2ban sshd jail, unattended-upgrades (security only, no auto reboot), Docker from the official repo (key fingerprint checked), swap on 8 GB hosts, `/etc/roxira` 0700, systemd units installed but not enabled.

### 3. Place secrets and the repo (about 15 minutes)

Secrets never go through chat or git. Copy server-to-server through the Mac so nothing is printed:

```bash
ssh root@$OLD 'cat /etc/roxira/backup.env' | ssh root@$NEW 'umask 077; cat > /etc/roxira/backup.env'
ssh root@$OLD 'cat /etc/roxira/monitor.env' | ssh root@$NEW 'umask 077; cat > /etc/roxira/monitor.env'   # if it exists
scp ~/Secrets/roxira/restic-dr.pass root@$NEW:/etc/roxira/restic.pass       # password of the repo you will restore from
ssh root@$NEW 'chmod 600 /etc/roxira/*; ls -l /etc/roxira'
# the Mac restic repo is the restore source (no Storage Box in use)
rsync -a ~/Backups/roxira-dr/restic/ root@$NEW:/var/lib/roxira/mac-repo/
ssh root@$NEW "printf 'BACKUP_LOCAL_REPO=/var/lib/roxira/mac-repo\n' >> /etc/roxira/backup.env"
```

If the Mac repo password differs from the server repo password, point `RESTIC_PASSWORD_FILE` at the right file (DISASTER_RECOVERY 8.2 step 4).

Repo: create a fresh read-only deploy key on the new host rather than copying the old one.
```bash
ssh root@$NEW 'ssh-keygen -t ed25519 -N "" -f /root/.ssh/roxira_deploy -C roxira-2-deploy && cat /root/.ssh/roxira_deploy.pub' > /tmp/roxira-2.pub   # public half only
gh repo deploy-key add /tmp/roxira-2.pub --repo Mahan-film/roxira-platform --title roxira-2   # org deploy keys must be allowed
ssh root@$NEW 'printf "Host github.com\n  IdentityFile /root/.ssh/roxira_deploy\n  IdentitiesOnly yes\n" >> /root/.ssh/config; git clone git@github.com:Mahan-film/roxira-platform.git /opt/roxira_platform'
ssh root@$NEW 'bash /opt/roxira_platform/scripts/infra/bootstrap_new_server.sh'   # re-run: installs the systemd units now that the repo exists
```

Cron is handled by the restore script itself (held, listed, activated only with `--apply-cron`). Restored timers are not started by the restore; stop `roxira-*.timer` after it as shown in step 5.

### 4. Rehearsal restore (do this days before; repeat in the window)

```bash
ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --dry-run --repo local'
ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --repo local --scratch /var/tmp/restore-1'    # drill: extract + verify dumps, applies nothing
```
Put `.env` and the support files in place from the scratch tree, then build (this is the slow step, 15-30 minutes for the torch image; do it now, not in the window):
```bash
ssh root@$NEW 'S=/var/tmp/restore-1; cp -a $S/opt/roxira_platform/.env /opt/roxira_platform/.env && chmod 600 /opt/roxira_platform/.env
cd /opt/roxira_platform && scripts/ops/nginx/gen_snakeoil_cert.sh && scripts/ops/nginx/update_cloudflare_ips.sh && scripts/ops/prep_backend_mounts.sh --apply
docker compose -f docker-compose.prod.yml config -q && docker compose -f docker-compose.prod.yml build'
```
(The scratch path layout is `<scratch>/<absolute path>`; confirm with `ls $S/opt/roxira_platform` first.) Order and flags follow `docs/infra/CLOUDFLARE_ORIGIN_LOCKDOWN.md` steps 0-2.

### 5. Restore (files, Postgres, Qdrant; cron held)

```bash
ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --repo local --full --dry-run'     # read the plan first
ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --repo local --full --yes --scratch /var/tmp/restore-1'
```
`--full` then: stops cron, places files (config, certs in `/etc/letsencrypt`, `/etc/x-ui`, `/root/deploy-state`, `/etc/ufw`, systemd units, Twenty files), holds the old crontabs under `/var/lib/roxira/cron-held` and prints every job, restores `enterprise_db` with `pg_restore --clean --if-exists --no-owner`, uploads Qdrant snapshots, and brings the stack up. After it:
```bash
ssh root@$NEW 'ufw reload; systemctl stop "roxira-*.timer"; systemctl is-active cron; ufw status numbered'   # cron must be inactive: old jobs are held, not live   # restore replaced /etc/ufw and unit files; 22/8443/2053/2096 now match the old host
```
Careful: step 4 of `restore.sh` rsyncs `/root/.ssh` over the new host's `authorized_keys`. Your key is in the backup, so you are not locked out, but check `ssh root@$NEW true` from a second terminal immediately.

### 6. Qdrant verification (snapshots restored by step 5; compare against the old host)

```bash
for H in $OLD $NEW; do echo "== $H"; ssh root@$H 'curl -s localhost:6333/collections | jq -r ".result.collections[].name" | sort | while read c; do printf "%s %s\n" "$c" "$(curl -s localhost:6333/collections/$c | jq .result.points_count)"; done'; done
```
Counts must be equal for every collection (expected from the 2026-10-09 map: `iran_laws_v2` 5,083; `iran_laws_mistral_v1` 1,444; `iran_laws_bge_m3` 1,308; `software_factory_code_vectors` 1,022; `judiciary_circulars` 250; plus newer `iran_laws_v3`, which the STATE file says is the served collection). If one is short, re-upload that snapshot:
`curl -X POST "localhost:6333/collections/<name>/snapshots/upload?priority=snapshot&wait=true" -F snapshot=@<file>` (files under `/var/tmp/restore-1/opt/roxira_backups/dr/stage/qdrant/<name>/`).
Check that `LIGHTRAG_QDRANT_COLLECTION` in the restored `.env` names the served collection, and that the bge-m3 weights load (the first request downloads them if they are not in the image or a volume; warm it now with one chat request so the first user does not wait).

### 7. Twenty, sandboxes, research stack

Step 5 already started Twenty's DB/Redis from `docker-compose.modern-stack.yml`, restored the dump and started the CRM (needs the restored repo `.env`). Check `docker ps | grep twenty` (create the network first on a brand-new host: `docker network create roxira_mesh`; `docker compose -f docker-compose.modern-stack.yml config -q` validates it). Then `docker compose -f docker/research-stack/docker-compose.yml up -d` and the sandbox compose files under `data/sandboxes/*` if they should run. Dispatcher: `systemctl enable --now roxira-dispatcher` (unit comes back with `/etc/systemd/system`). x-ui: see 1.3, item 3.

### 8. Smoke test on the new IP (before any DNS change)

Cloudflare-only firewall is not applied yet, so `$NEW:443` is reachable from the Mac. nginx returns 444 for requests without a known Host, so test with `--resolve`:

```bash
for D in ghazihoushmand.ir roxira.ir roxira.net; do
  curl -sS -o /dev/null -w "$D %{http_code} tls=%{ssl_verify_result}\n" --resolve $D:443:$NEW https://$D/health
done
curl -sS --resolve ghazihoushmand.ir:443:$NEW https://ghazihoushmand.ir/api/health | head -c 300
cd /opt/roxira_platform && bash scripts/ops/deploy_local.sh check          # on the Mac with DEPLOY_SSH_HOST=$NEW
ssh root@$NEW 'docker ps --format "{{.Names}}\t{{.Status}}" | sort; free -m; df -h /'
ssh root@$NEW 'curl -s -o /dev/null -w "groq %{http_code}\n" https://api.groq.com/openai/v1/models; curl -s -o /dev/null -w "openrouter %{http_code}\n" https://openrouter.ai/api/v1/models'
```
(401 from Groq/OpenRouter without a key means "reachable"; a timeout or 403 from the IP means blocked.) For a browser test add `NEW ghazihoushmand.ir roxira.ir roxira.net` to `/etc/hosts` on the Mac, test login (OTP SMS, Google OAuth), a chat question with citations, a case-file upload, then remove the lines. Confirm: legal chat answers from the right collection, payment test order reaches the gateway (allowlist), backup mail works (`FORCE_BUNDLE=1 scripts/ops/backup/server_backup.sh report` on the new host), `docker stats` memory is within the plan.

### 9. Cutover window (target 15-30 minutes)

1. Announce; put the app in maintenance (or accept a short write freeze). On `$OLD`, stop writers in this order:
   ```bash
   ssh root@$OLD 'systemctl stop cron; systemctl stop "roxira-*.timer"; cd /opt/roxira_platform && docker compose -f docker-compose.prod.yml stop roxira_enterprise_frontend roxira_enterprise_backend enterprise_app nginx_gateway; docker stop roxira_twenty_crm'
   ssh root@$OLD '/opt/roxira_platform/scripts/ops/backup/server_backup.sh run'     # final consistent set, DBs still up
   ```
2. On the Mac: `scripts/ops/backup/mac_pull.sh` (pulls the final set into the Mac repo), `rsync -a ~/Backups/roxira-dr/restic/ root@$NEW:/var/lib/roxira/mac-repo/`.
3. On `$NEW`: delta restore of the DBs and Qdrant: rerun step 5's `restore.sh --full` (file placement is idempotent and the DBs are small, about 0.3 GB), then repeat the step 6 count comparison. Qdrant on `$OLD` is still running, so its counts remain readable.
4. Review the held jobs, then activate them: `ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --apply-cron --dry-run'` and again without `--dry-run`. Start the timers:
   `ssh root@$NEW 'systemctl start $(systemctl list-unit-files "roxira-*.timer" --no-legend | awk "{print \$1}")'` (or `bootstrap_new_server.sh --enable-timers` for the supported list). The bootstrap script's final sshd step needs `--i-have-key-access`; run it once, after you tested key login for root and the admin user from a second terminal.
5. **Cloudflare DNS:** for every proxied A record of the three zones (and `www`) change the content to `$NEW`. Remove or update AAAA records too (an AAAA still pointing at the old host sends IPv6 users there). Records are proxied (orange cloud), so the change takes effect at the edge in seconds; TTL does not matter. Grey-cloud records (VPN hostnames, mail, anything not proxied) must be handled separately and consciously: moving them moves the VPN endpoint (decision in section 5, item "x-ui").
6. Verify through Cloudflare (no `--resolve`): `curl -sS https://ghazihoushmand.ir/health`, a login, a chat question. Watch `docker logs -f roxira_nginx_prod` on `$NEW` for real traffic (`CF-Connecting-IP` present).
7. Apply the origin lockdown on the new host **after** traffic is flowing and you have confirmed Cloudflare can reach it:
   ```bash
   ssh root@$NEW '/opt/roxira_platform/scripts/ops/firewall/cloudflare_only.sh --apply && /opt/roxira_platform/scripts/ops/firewall/cloudflare_only.sh --status'
   curl -sk --max-time 8 -o /dev/null -w "direct IP: %{http_code}\n" https://$NEW/     # must now fail/444
   ```
   Then, once verified, enable `roxira-cf-refresh.timer` (it is deliberately not in the bootstrap list).
8. Update the Mac: `ROXIRA_HOST`/`DEPLOY_SSH_HOST` in `~/Secrets/roxira/*.env`, `~/.ssh/config`, `known_hosts` for `$NEW`, the `mac_pull.sh` target (`launchd` agent), `scripts/ops/set_server_env.sh` host. Run one `server_backup.sh run` on `$NEW`; confirm the daily report email arrives from the new host. Then remove `.deploy-freeze` and run `deploy_local.sh check` and a no-op `deploy` dry run to confirm `prev_commit` and the `:prev` image tags exist on the new host (they were restored with `/root/deploy-state`, but the images were rebuilt, so run one real deploy of the current commit to re-record rollback state).

### 10. Rollback (first 48 hours)

- **Within the window, before writes happen on the new host:** flip the Cloudflare A records back to `$OLD`, then on `$OLD`: `systemctl unmask`/`start cron`, start the stopped containers and timers. No data loss.
- **After users wrote data on the new host:** data written there is not on the old host. Either accept a loss of the window's writes, or take `server_backup.sh run` on `$NEW`, restore that set on `$OLD` with `restore.sh --repo local --full` (same procedure as above, reversed), then flip DNS back. Decide a cut-off (suggest: rollback is free for the first 2 hours, a controlled data-carrying rollback after that).
- Do **not** run both hosts' cron/timers at once (duplicate crawls, duplicate marketing posts, duplicate backup mails, two writers on the same legal sources).

### 11. Keep 48 hours, then decommission

1. Old host: keep containers stopped, cron masked, disk untouched. It still costs hourly; that is the price of a rollback.
2. After 48 hours of clean operation (two daily backup mails received from `$NEW`, one restore drill passed against the new set, certbot renewal dry run OK: `certbot renew --dry-run` on `$NEW`, which needs Cloudflare proxy to reach `/.well-known/acme-challenge/`):
   - Final archive: `server_backup.sh run` was already taken at cutover; additionally create a Hetzner snapshot of the old server (`hcloud server create-image --type snapshot roxira-1`), keep it 7 days (snapshots are billed per GB), then delete.
   - Rotate secrets that lived on the old host and were copied by hand (JWT secret, DB passwords, API keys) only if you suspect exposure; routine rotation is out of scope. **Do rotate** if the old host was ever in the "compromised" state described in infra-map risks 1-4.
   - Remove the old host from provider allowlists, deploy keys (`gh repo deploy-key list`), Cloudflare firewall rules, `known_hosts`, the Mac pull config.
   - `hcloud server delete roxira-1` (owner decision; irreversible). Do not use any bulk-destructive command; delete exactly this server.

### 12. Checklist

See `scripts/infra/migrate_checklist.md` (Persian, one line per step with the exact command).

---

## 3. Baseline security ("acceptable, not extreme")

Status key: HAVE = documented as present on the current host (infra map 2026-10-09 or merged repo code), MERGED = in the repo but rollout on prod unconfirmed (STATE.md urgent item 4), NEW = not in place.

| Layer | Status today | On the new server |
|---|---|---|
| SSH keys only, no password | HAVE (`PasswordAuthentication no`, `MaxAuthTries 3`, root key login allowed) | `bootstrap_new_server.sh` writes `00-roxira-hardening.conf` (the `00-` prefix wins over cloud-init's `50-cloud-init.conf`). Root key login is kept because `deploy_local.sh` and the Mac backup pull use it. Port 22 unchanged |
| Brute-force protection | HAVE fail2ban (sshd + 3x-ipl jails; 7,019 failures, 512 bans seen) | script installs fail2ban with a systemd-backend sshd jail. The `3x-ipl` jail comes back through the restored `/etc/fail2ban` only if you add it to the backup path set (it is not today); re-create it by hand after the x-ui install. CrowdSec: skip for now (section 4) |
| Automatic security updates | NEW/unclear (15 pending upgrades and a pending reboot on 2026-10-09) | script enables unattended-upgrades (security pocket, no auto-reboot). You still need a monthly manual reboot window (`needrestart` is installed to flag it) |
| Host firewall | HAVE ufw (default deny in) | script: default deny in/allow out, allow 22, 80, 443. 8443/2053/2096/60000:61000 are never touched by the script; they come back with the restored `/etc/ufw`, which is exactly the old policy |
| HTTP origin Cloudflare-only | MERGED (`cloudflare_only.sh`, `roxira-cf-refresh.timer`, nginx catch-all 444) | apply after DNS flip (step 9.7). Without it the origin answers anyone who finds the IP. Docker bypasses ufw INPUT, which is why the script uses `DOCKER-USER` |
| Authenticated Origin Pulls | NEW | optional; free; ~30 min (nginx `ssl_client_certificate` + `ssl_verify_client on` on the server blocks, upload Cloudflare's CA, or better a Cloudflare-issued custom cert). Adds protection against other Cloudflare tenants and misconfigured allowlists. Trial after migration, not during it |
| Cloudflare Tunnel (no open 80/443) | NEW | option only, see section 4 (trial) |
| Docker socket proxy | MERGED (`docker-socket-proxy` in compose, backend no longer mounts `docker.sock`) | comes with the compose file. Verify on the new host: `docker inspect roxira_enterprise_backend --format '{{json .Mounts}}'` must not list `docker.sock` |
| Non-root, read-only, cap_drop containers | MERGED for the backend (uid 100, `cap_drop ALL`, `no-new-privileges`, `read_only`). NEW for `qdrant` (runs as root), `enterprise_app`, Twenty | acceptable now; fix Qdrant `user:` and add `cap_drop` to `enterprise_app` in a later PR |
| Image pinning | MERGED (digest pins in compose) | check multi-arch on arch change (1.3). Twenty/SearXNG/Valkey use `latest`: pin them in the new Twenty compose |
| Secrets files | HAVE partly: backup env/restic pass in `/etc/roxira` 0600 (rollout step 2); app `.env` in the repo dir; plaintext `.env` copies in `/root/env-backups` and `/root/deploy-state/env-backups` (infra map risk 4) | script creates `/etc/roxira` 0700 and forces 0600 on its files. Keep `.env` at `/opt/roxira_platform/.env` mode 0600 (compose expects it; moving it is a bigger change). Do **not** carry the `env-backups` directories or `/root/.bash_history` over. Restore step copies `/root/deploy-state`: delete its `env-backups/` on the new host after the restore |
| Qdrant/Redis/Postgres exposure | HAVE (loopback binds). Qdrant has no API key | unchanged; set `QDRANT_API_KEY` only together with an app change (not part of the migration) |
| Cloudflare WAF basic rules | unknown (owner-managed) | free plan: enable the Free Managed Ruleset, one rate-limiting rule on `/api/v1/auth/*` (nginx already limits `auth_otp` at 10 r/min), block the old origin IP in "IP access rules" after decommission. Keep challenges/bot-fight conservative: Iran-path problems with challenges are already documented (STATE.md urgent item 5). Do not turn on country blocking |
| TLS | HAVE Let's Encrypt via certbot in 3 lineages; HSTS raised to 180 days in the merged nginx | certs come back with `/etc/letsencrypt`; run `certbot renew --dry-run`. `roxira.net` lineage expires 2026-11-20 on the old host: confirm renewal on the new one |
| Backups encrypted | HAVE restic AES-256 repo on the Mac, age-encrypted config bundle and offsite mail parts; local sets on the server disk are plain (same trust as the DB) | unchanged. Weak spot: with no Storage Box there are 2 real copies (server + Mac). Add a third: Cloudflare R2 bucket via `BACKUP_S3_*` (supported, zero code) |
| Admin access | root key from the Mac | script adds the `roxira` admin user with sudo; consider disabling root login only after `deploy_local.sh` is taught to use it |
| Hetzner Cloud Firewall | NEW | free layer outside the host; mirror ufw (see step 1) |

---

## 4. Tooling evaluation (scale: one server, early stage, low cost; Iran-based owner)

Search-verified on 2026-10-12 unless marked "from knowledge". Source links in section 6.

| Candidate | Verdict | Reason |
|---|---|---|
| **Plain idempotent bootstrap script** (this PR) | **ADOPT** | One server; the whole host config is about 300 lines of reviewed shell with `--dry-run`; no extra runtime on the Mac. It is the reproducible host definition; compose files + `restore.sh` are the app definition |
| cloud-init (minimal user-data) | **ADOPT (tiny)** | Only to inject the admin user + key + `git curl` at first boot so the script can run unattended. Do not put logic in it |
| Ansible | **SKIP** (revisit at 3+ servers) | Needs Python/YAML tooling and roles for what the script already does; idempotence of apt/ufw/systemd modules is nice but not worth a second language here |
| Kamal 2 | **SKIP** | Search confirms Kamal 2 uses its own `kamal-proxy` (zero-downtime, multi-app by host) and works for any containerized app with a health route, but it would replace `deploy_local.sh` (freeze check, migration gate, `:prev` rollback, smoke) and duplicate nginx's role, for a 12-container compose stack with stateful accessories. No payoff now |
| Coolify (v4 stable released April 2026 per sources) | **SKIP on prod** | A control plane with the Docker socket and its own DB/proxy adds 0.5-1.2 GB RAM (per comparison sites) and a large attack surface on the box that holds the customer data. Our gated `deploy_local.sh` would be re-implemented in a UI. Per sources it also cannot do zero-downtime for Compose deployments |
| Dokploy (pre-1.0 per sources; core Apache-2.0, some features under a separate source-available licence) | **TRIAL, off prod** | Lighter than Coolify (300-400 MB idle per community reports). Useful later as the host for the software factory's generated customer apps (the `roxira_sandbox_*` use case) on a **separate small server**, so a bad generated app cannot touch the legal DB |
| CapRover | **SKIP** | Not re-verified in depth this session (Swarm-based, older model); same reasons as Coolify/Dokploy, and nothing that compose + nginx does not already cover |
| Komodo | **WATCH** | Multi-server Docker control plane (GPLv3, TOML/UI configs). Becomes interesting at 2+ servers; not now |
| Tailscale (free Personal plan: 6 users, unlimited devices, 50 tagged resources per 2026 sources; plans changed 2026-04-08) | **TRIAL** | Good for private admin access (SSH, Beszel hub, Qdrant dashboard) so those never need a public port. Unverified here: reachability of Tailscale's coordination/DERP infrastructure from Iran, where the owner works. Keep port 22 as is until a month of use proves it. Headscale would remove the vendor dependency but you then run and secure the control server yourself: skip unless Tailscale is blocked |
| Cloudflare Tunnel (available on the Free plan per sources; outbound-only `cloudflared`) | **TRIAL after migration** | Removes the need to open 80/443 and makes the CF-only firewall unnecessary, but it changes the request path (tunnel PoP selection, WebSocket/live-voice behaviour, HTTP/3 settings already suspected in the Iran-path problem) and adds a daemon that is a single point of failure. Do not change two things at once: migrate first, then trial on a staging hostname. AOP is the lower-effort alternative |
| Uptime Kuma | **SKIP on the same box** | A pinger on the server it watches cannot see a dead server. We already have `synthetic_check.py` + log watcher timers with email. If you want an external view use a free hosted pinger from another network (not verified which) or run Kuma on the Mac/Pi |
| Netdata | **SKIP** | Per comparison sites 200-500 MB RAM (vendor-affiliated source, unverified) and host mounts/capabilities; overkill |
| Grafana + Loki (+Prometheus) | **SKIP** | Needs 1+ GB and care; our logs are files + `log_watch.py`. Revisit when you need cross-service tracing |
| **Beszel** (hub + 9 MB Go agent, PocketBase; v0.18.x/0.19 per sources) | **ADOPT** | Fills the real gap (no historical host/container CPU, RAM, disk metrics or alerts) at tens of MB. Keep the hub bound to localhost or reach it via Tailscale/SSH tunnel; agents verify certificates in 0.19 |
| restic (current) | **ADOPT / keep** | Already used; dedup, client-side encryption, works with sftp, S3/R2 and local repos. Add the missing third copy (R2 or a Storage Box) |
| Kopia | **SKIP** | Equivalent features; switching costs the whole backup tooling and gains nothing at this size |
| Watchtower | **SKIP** | The original repo was made read-only on 2025-12-17 (end of maintenance, last release 2023). A maintained fork exists (`nickfedor/watchtower`), but blind auto-update of images is the wrong model for us: pinned digests, stateful Postgres/Qdrant, `:prev` rollback and the smoke gate in `deploy_local.sh`. For visibility only, a notify-only tool (DIUN) or Renovate PRs that bump digests would fit; not needed today |
| fail2ban vs CrowdSec | **fail2ban ADOPT, CrowdSec SKIP** | fail2ban is already in place and enough for SSH (last release 1.1.0, April 2024, still maintained). CrowdSec adds shared threat intel but also an agent and bouncers to operate; the real HTTP attack surface is behind Cloudflare |
| Hetzner Cloud Firewall + `hcloud` CLI | **ADOPT** | Free external firewall layer and scriptable provisioning (`hcloud server create`), which is the actual "infrastructure as code" you need at this size. Terraform/OpenTofu: skip until there is more than one server |
| Anything newer that clearly beats these | none found | The 2026 landscape (Coolify/Dokploy/Komodo/Kamal) is covered above; none is better than compose + scripts for one server holding customer data |

### Recommended single stack

**"Compose-first, scripts in the repo, no control plane on prod":**

1. Provisioning: `hcloud` CLI (+ Hetzner Cloud Firewall) and a minimal cloud-init.
2. Host baseline: `scripts/infra/bootstrap_new_server.sh` (idempotent, reviewed, `--dry-run`).
3. App definition: `docker-compose.prod.yml` + `docker-compose.modern-stack.yml` (Twenty) and the `docker/research-stack/` compose file, images pinned by digest.
4. Deploy: existing `scripts/ops/deploy_local.sh` (gated, rollback, smoke).
5. Recovery: restic + age DR system (`server_backup.sh`, `restore.sh`, Mac pull), plus a third copy on R2.
6. Edge: Cloudflare proxy, `cloudflare_only.sh`, WAF basics; AOP/Tunnel as later trials.
7. Visibility: existing synthetic/log-watch timers + Beszel; external pinger.
8. Admin: SSH keys; Tailscale on trial.

Why this keeps current and future projects manageable: every layer is a file in git that a cheap model or a Claude subagent can read, diff and review (this matches the factory rules in `AGENTS.md`: reviewed PRs, no hidden UI state, L4 paths owner-written); there is no web control plane holding the Docker socket next to customer data; a second app is a second compose project behind the same nginx and the same backup path list; the autonomous factory can generate apps into `data/sandboxes/*` and, when they multiply, those move to a separate Dokploy box without touching the legal-data host; and rebuilding the whole host from nothing is one script, one restore and one DNS flip, which this plan exercises for real.

---

## 5. Open decisions for the owner

1. **x-ui / xray (ports 8443, 2053, 2096):** they are not Roxira code, but `restore.sh` moves `/etc/x-ui`. Decide: move the VPN with the migration (clients need the new IP if they connect by IP; the hostname if grey-cloud DNS) or leave it on the old host and keep that host alive. If the old host is deleted, VPN users lose service. On x86 the binary must be reinstalled (1.3).
2. **Arm or x86** depending on actual availability (1.4).
3. **8 GB or 16 GB** (1.1). Default recommendation: 16 GB.
4. **Which bootstrap script survives** (`scripts/ops/` vs `scripts/infra/`) and who fixes `restore.sh` service names (L4).
5. **Third backup copy** location (R2 vs Storage Box).

## 6. Sources checked on 2026-10-12

- Hetzner product pages: [cost-optimized](https://www.hetzner.com/cloud/cost-optimized), [regular performance](https://www.hetzner.com/cloud/regular-performance), [general purpose](https://www.hetzner.com/cloud/general-purpose); [Hetzner Cloud changelog](https://docs.hetzner.cloud/whats-new) (price update effective 2026-06-15, CPX02/CPX12 added).
- Price and availability commentary (secondary, partly conflicting): [Findstack](https://findstack.com/resources/hetzner-price-increase-2026), [Northflank](https://northflank.com/blog/hetzner-cloud-server-price-increases), [WZ-IT](https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/), [Spare Cores CAX specs](https://sparecores.com/server/hcloud/cax31).
- Watchtower end of maintenance: [Linuxiac](https://linuxiac.com/docker-update-tool-watchtower-reaches-end-of-maintenance/).
- PaaS comparisons: [getdeploying](https://getdeploying.com/guides/coolify-vs-dokploy), [WZ-IT 2026 comparison](https://wz-it.com/en/blog/self-hosted-paas-comparison-coolify-dokploy-caprover/); Komodo: [Linuxiac](https://linuxiac.com/komodo-1-19-build-and-deploy-tool-brings-new-cli/); Kamal 2: [Saeloun](https://blog.saeloun.com/2026/07/23/rails-8-kamal-2-deployment-zero-downtime/).
- Monitoring: [Beszel vs Netdata vs Uptime Kuma](https://futurepicker.com/?p=4703), [Beszel 0.19 guide](https://aicybr.com/blog/beszel-0-19-self-hosting-monitoring-guide).
- Cloudflare: [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull), [Tunnel guide](https://tech-insider.org/ie/cloudflare-tunnel-setup-2026/); Tailscale plan: [CostBench](https://costbench.com/software/ztna/tailscale-ztna/free-plan/); fail2ban vs CrowdSec: [LumaDock](https://lumadock.com/tutorials/crowdsec-vs-fail2ban) (CrowdSec-leaning source).
- Not verified: live prod state (ssh blocked), Hetzner prices, Hetzner outbound-SMTP policy, Tailscale reachability from Iran, CapRover status, provider IP allowlists.
