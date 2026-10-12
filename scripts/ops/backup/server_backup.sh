#!/usr/bin/env bash
# Roxira server backup: consistent dumps -> staging dir -> restic (encrypted, deduplicated)
# to the Hetzner Storage Box (sftp, primary offsite) and optionally an S3-compatible bucket.
#
# Runs ON the production host as root, from systemd timers (deploy/systemd/roxira-backup-dr-*.timer).
# Replaces the DB part of scripts/auto_backup_daemon.sh and scripts/ops/backup.sh; those can be
# retired once this has run cleanly for a few days (see docs/ops/DISASTER_RECOVERY.md).
#
# Local-only mode: with no restic repository configured (no Storage Box, no S3) and
# BACKUP_ALLOW_LOCAL_ONLY=1, `run` still writes the hourly consistent dump set (+ a config tarball)
# under sets/<timestamp> with KEEP_LOCAL_SETS rotation and records LAST_RESULT=OK. The owner's Mac
# pulls sets/latest daily (scripts/ops/backup/mac_pull.sh). Without that flag, "no repository" is a FAIL.
#
# Usage: server_backup.sh [--dry-run] <mode>
#   init      create the restic repositories that do not exist yet (one-time, idempotent)
#   run       dump + stage + restic backup + (daily) forget --prune     [hourly timer]
#   report    daily status email; on the bundle weekday also attach the age-encrypted config bundle
#   check     restic check --read-data-subset=5% on every repository     [weekly timer]
#   bundle    build the age-encrypted config bundle only (prints its path)
#   offsite   age-encrypt DB dumps + configs + corpus JSONL, split into <=17 MB parts, mail them (docs/ops/BACKUP_EMAIL.md)
#   --self-test-prune DIR [HOURLY [DAILY]]   run only prune_sets against DIR (used by the unit test; touches nothing else)
#
# Configuration: env file /etc/roxira/backup.env (names documented in deploy/backup/backup.env.example).
# Secrets: restic password file (RESTIC_PASSWORD_FILE, root-only), SMTP app password, S3 keys - env only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

MODE=""
SELF_TEST_DIR=""
SELF_TEST_KEEP=3
SELF_TEST_DAILY=0
if [ "${1:-}" = "--self-test-prune" ]; then
  SELF_TEST_DIR="${2:?--self-test-prune needs a directory}"
  SELF_TEST_KEEP="${3:-3}"
  SELF_TEST_DAILY="${4:-0}"
  set --
fi
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    init|run|report|check|bundle|offsite) MODE="$arg" ;;
    *) die "unknown argument: $arg" ;;
  esac
done
[ -n "$MODE" ] || [ -n "$SELF_TEST_DIR" ] || die "mode required: init|run|report|check|bundle|offsite (see --help)"

[ -n "$SELF_TEST_DIR" ] || load_env

REPO_DIR="${ROXIRA_REPO_DIR:-/opt/roxira_platform}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-/opt/roxira_backups/dr}"
STAGE="$LOCAL_DIR/stage"
SETS_DIR="$LOCAL_DIR/sets"
# Local retention (docs/ops/BACKUP_RETENTION.md): newest KEEP_HOURLY sets + the newest set of each of the
# KEEP_DAILY latest UTC days. BACKUP_KEEP_LOCAL_SETS is the old name of KEEP_HOURLY (still honoured).
KEEP_HOURLY="${BACKUP_KEEP_HOURLY:-${BACKUP_KEEP_LOCAL_SETS:-6}}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-3}"
MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-15}"   # below this: keep only the newest set and send an alert
STATE_DIR="${BACKUP_STATE_DIR:-/var/lib/roxira-backup}"
STATUS_FILE="$STATE_DIR/status.env"
CHECK_FILE="$STATE_DIR/check.env"   # written only by mode_check; status.env is rewritten hourly by mode_run
LOG_FILE="${BACKUP_LOG_FILE:-/var/log/roxira_backup_dr.log}"
DISK_WARN="${BACKUP_DISK_WARN_PCT:-85}"
DISK_ABORT="${BACKUP_DISK_ABORT_PCT:-95}"
ALERT_COOLDOWN_MIN="${BACKUP_ALERT_COOLDOWN_MIN:-360}"
PRUNE_HOUR_UTC="${BACKUP_PRUNE_HOUR_UTC:-03}"
BUNDLE_DOW="${BACKUP_BUNDLE_DOW:-7}"          # 1=Mon .. 7=Sun
BUNDLE_MAX_BYTES="${BACKUP_BUNDLE_MAX_BYTES:-20971520}"
EMAIL_OFFSITE="${BACKUP_EMAIL_OFFSITE:-off}"     # off | daily | weekly (weekly uses BUNDLE_DOW)
EMAIL_EXTRA_PATHS="${BACKUP_EMAIL_EXTRA_PATHS:-}"  # space-separated extra paths (e.g. the staged legal-corpus JSONL dir)
PG_CONTAINERS="${BACKUP_PG_CONTAINERS:-roxira_postgres_prod roxira_twenty_db}"
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"
REDIS_CONTAINER="${BACKUP_REDIS_CONTAINER:-roxira_redis_prod}"
RAW_VOLUMES="${BACKUP_RAW_VOLUMES:-roxira_platform_certbot_web}"
# Postgres and Qdrant volumes are deliberately NOT copied raw: a live copy is inconsistent.
# They are covered by pg_dump -Fc and Qdrant snapshots instead.

FAILS=()
WARNS=()
[ -n "$SELF_TEST_DIR" ] || mkdir -p "$STATE_DIR" 2>/dev/null || true

stamp() { date -u '+%Y%m%dT%H%M%SZ'; }

# ---- status file (key='value') ---------------------------------------------------------------
STATUS_TMP=""
status_set() { [ -n "$STATUS_TMP" ] && printf "%s='%s'\n" "$1" "${2//\'/}" >>"$STATUS_TMP" || true; }

# prune_sets <hourly> <daily>: delete local sets outside the retention window (selection logic lives in
# retention.py, unit-tested offline). Never the target of `latest`, never anything whose name is not a
# timestamp directory. No bulk deletes: one validated directory at a time.
prune_sets() {
  local hourly="$1" daily="${2:-0}" latest_target="" d name
  [ -d "$SETS_DIR" ] || return 0
  latest_target="$(readlink -f "$SETS_DIR/latest" 2>/dev/null || true)"
  while IFS= read -r name; do
    [[ "$name" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || continue
    d="$SETS_DIR/$name"
    [ -d "$d" ] && [ ! -L "$d" ] || continue
    [ "$(readlink -f "$d")" = "$latest_target" ] && continue
    run rm -rf -- "$d"
  done < <(python3 "$SCRIPT_DIR/retention.py" "$SETS_DIR" --hourly "$hourly" --daily "$daily")
}

if [ -n "$SELF_TEST_DIR" ]; then
  SETS_DIR="$SELF_TEST_DIR"
  prune_sets "$SELF_TEST_KEEP" "$SELF_TEST_DAILY"
  exit 0
fi

# ---- alert email, throttled so a persistent fault does not send 24 mails/day -------------------
send_mail() { # subject, body-file, [attachments...]
  local subject="$1" body="$2"
  shift 2
  local args=(--subject "$subject" --body-file "$body")
  local a
  for a in "$@"; do args+=(--attach "$a"); done
  [ "$DRY_RUN" = "1" ] && args+=(--dry-run)
  python3 "$SCRIPT_DIR/notify_email.py" "${args[@]}" || warn "email not sent (see above)"
}

alert() { # subject, message
  local marker="$STATE_DIR/last_alert"
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] alert email: $1"; return 0; fi
  if [ -f "$marker" ] && [ -n "$(find "$marker" -mmin "-$ALERT_COOLDOWN_MIN" 2>/dev/null)" ]; then
    warn "alert suppressed by cooldown (${ALERT_COOLDOWN_MIN} min): $1"
    return 0
  fi
  local body
  body="$(mktemp)"
  printf '%s\n\nhost: %s\ntime: %s\nlog: %s\n' "$2" "$(hostname)" "$(date -u)" "$LOG_FILE" >"$body"
  send_mail "[roxira-backup] $1" "$body"
  [ "$DRY_RUN" = "1" ] || touch "$marker"
  rm -f "$body"
}

# ---- dumps -----------------------------------------------------------------------------------
container_running() { docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null | grep -q true; }

dump_postgres() {
  local c db out
  for c in $PG_CONTAINERS; do
    out="$STAGE/pg/$c"
    if [ "$DRY_RUN" = "1" ]; then
      echo "[dry-run] pg_dump -Fc every non-template DB + pg_dumpall --globals-only in $c -> $out"
      continue
    fi
    if ! container_running "$c"; then FAILS+=("postgres container $c not running"); continue; fi
    mkdir -p "$out"
    # $POSTGRES_USER / $POSTGRES_DB expand inside the container, not on the host.
    if ! docker exec "$c" sh -c 'pg_dumpall -U "$POSTGRES_USER" --globals-only' >"$out/globals.sql" 2>"$out/globals.err"; then
      FAILS+=("pg_dumpall globals failed in $c")
    fi
    local dbs
    dbs="$(docker exec "$c" sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -Atc \"select datname from pg_database where not datistemplate and datname<>'postgres'\"" 2>/dev/null || true)"
    if [ -z "$dbs" ]; then FAILS+=("no databases listed in $c"); continue; fi
    for db in $dbs; do
      if docker exec "$c" sh -c "pg_dump -U \"\$POSTGRES_USER\" -Fc -d '$db'" >"$out/$db.dump" 2>"$out/$db.err" \
        && docker exec -i "$c" pg_restore -l <"$out/$db.dump" >/dev/null 2>&1; then
        log "pg ok: $c/$db $(human "$(stat -c %s "$out/$db.dump")")"
      else
        FAILS+=("pg_dump/verify failed for $c/$db")
      fi
    done
    rm -f "$out"/*.err
  done
}

qdrant_curl() {
  local key_args=()
  [ -n "${QDRANT_API_KEY:-}" ] && key_args=(-H "api-key: ${QDRANT_API_KEY}")
  curl -fsS --max-time "${BACKUP_QDRANT_TIMEOUT:-1800}" "${key_args[@]}" "$@"
}

dump_qdrant() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] qdrant: for each collection POST /collections/<c>/snapshots, download, DELETE snapshot -> $STAGE/qdrant"
    return
  fi
  local cols c snap
  if ! cols="$(qdrant_curl "$QDRANT_URL/collections" | jq -r '.result.collections[].name')"; then
    FAILS+=("qdrant collection list failed"); return
  fi
  for c in $cols; do
    if ! snap="$(qdrant_curl -X POST "$QDRANT_URL/collections/$c/snapshots?wait=true" | jq -r '.result.name')" || [ -z "$snap" ] || [ "$snap" = null ]; then
      FAILS+=("qdrant snapshot create failed for $c"); continue
    fi
    mkdir -p "$STAGE/qdrant/$c"
    if qdrant_curl -o "$STAGE/qdrant/$c/$snap" "$QDRANT_URL/collections/$c/snapshots/$snap" && [ -s "$STAGE/qdrant/$c/$snap" ]; then
      qdrant_curl "$QDRANT_URL/collections/$c" >"$STAGE/qdrant/$c/collection_info.json" || true
      log "qdrant ok: $c $(human "$(stat -c %s "$STAGE/qdrant/$c/$snap")")"
    else
      FAILS+=("qdrant snapshot download failed for $c")
    fi
    # Always remove the server-side snapshot so the container disk does not grow.
    qdrant_curl -X DELETE "$QDRANT_URL/collections/$c/snapshots/$snap?wait=true" >/dev/null || warn "could not delete snapshot $snap of $c"
    if [ "${BACKUP_QDRANT_PRUNE_OLD:-0}" = "1" ]; then
      # opt-in: remove leftovers from older ad-hoc scripts (e.g. /root/backup_qdrant.sh never deletes)
      local old
      for old in $(qdrant_curl "$QDRANT_URL/collections/$c/snapshots" | jq -r '.result[].name'); do
        qdrant_curl -X DELETE "$QDRANT_URL/collections/$c/snapshots/$old?wait=true" >/dev/null || true
      done
    fi
  done
}

dump_redis() {
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] redis: BGSAVE in $REDIS_CONTAINER, docker cp dump.rdb -> $STAGE/redis"; return; fi
  container_running "$REDIS_CONTAINER" || { WARNS+=("redis container not running"); return; }
  local before after
  before="$(docker exec "$REDIS_CONTAINER" redis-cli lastsave 2>/dev/null || echo 0)"
  docker exec "$REDIS_CONTAINER" redis-cli bgsave >/dev/null 2>&1 || { WARNS+=("redis bgsave failed"); return; }
  for _ in $(seq 1 60); do
    after="$(docker exec "$REDIS_CONTAINER" redis-cli lastsave 2>/dev/null || echo 0)"
    [ "$after" != "$before" ] && break
    sleep 1
  done
  mkdir -p "$STAGE/redis"
  docker cp "$REDIS_CONTAINER:/data/dump.rdb" "$STAGE/redis/dump.rdb" 2>/dev/null || WARNS+=("redis dump.rdb copy failed (data is cache-only if appendonly=no and no dump)")
}

dump_volumes() {
  local v src
  for v in $RAW_VOLUMES; do
    src="/var/lib/docker/volumes/$v/_data"
    if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] copy volume $v -> $STAGE/volumes/$v"; continue; fi
    if [ -d "$src" ]; then mkdir -p "$STAGE/volumes/$v" && cp -a "$src/." "$STAGE/volumes/$v/"; else WARNS+=("volume $v not found"); fi
  done
}

dump_meta() {
  local m="$STAGE/meta"
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] meta: docker ps/images, dpkg selections, crontab, ufw status, systemd unit list -> $m"; return; fi
  mkdir -p "$m"
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' >"$m/docker_ps.txt" 2>/dev/null || true
  docker images --digests --format '{{.Repository}}:{{.Tag}}\t{{.Digest}}' >"$m/docker_images.txt" 2>/dev/null || true
  docker volume ls -q >"$m/docker_volumes.txt" 2>/dev/null || true
  dpkg --get-selections >"$m/dpkg_selections.txt" 2>/dev/null || true
  crontab -l >"$m/root_crontab.txt" 2>/dev/null || true
  ufw status verbose >"$m/ufw_status.txt" 2>/dev/null || true
  systemctl list-unit-files --state=enabled --no-pager >"$m/systemd_enabled.txt" 2>/dev/null || true
  ( cd "$REPO_DIR" 2>/dev/null && git rev-parse HEAD >"$m/repo_head.txt" 2>/dev/null ) || true
  date -u >"$m/backup_time.txt"
}

# Local-only mode has no restic run to pick up configs, so the set carries them: one root-only tarball
# (contains .env files; it never leaves the server unencrypted: the Mac stores it inside a restic repo).
# $REPO_DIR/data is not included (can be large); it is only covered when a restic repository exists.
dump_configs() {
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] configs: tar .env/compose/nginx/crontabs/systemd/ufw/letsencrypt -> $STAGE/configs/configs.tar.gz"; return; fi
  local list=() p
  while IFS= read -r p; do
    [ "$p" = "$STAGE" ] && continue
    [ "$p" = "$REPO_DIR/data" ] && continue
    list+=("$p")
  done < <(backup_paths)
  mkdir -p "$STAGE/configs"
  # tar exit 1 = "file changed while reading": acceptable for configs
  tar -czf "$STAGE/configs/configs.tar.gz" --warning=no-file-changed "${list[@]}" 2>/dev/null || [ $? -eq 1 ] \
    || FAILS+=("config tarball failed")
  [ -s "$STAGE/configs/configs.tar.gz" ] || FAILS+=("config tarball empty")
}

# ---- restic path set -------------------------------------------------------------------------
backup_paths() {
  local p
  for p in \
    "$STAGE" \
    "$REPO_DIR/data" \
    "$REPO_DIR/.env" "$REPO_DIR/docker/research-stack/.env" "$REPO_DIR/.env.example" \
    "$REPO_DIR/docker-compose.prod.yml" "$REPO_DIR/docker-compose.modern-stack.yml" \
    "$REPO_DIR/docker/research-stack/docker-compose.yml" \
    "$REPO_DIR/nginx" "$REPO_DIR/nginx.conf" "$REPO_DIR/nginx_split.conf" \
    /etc/nginx /etc/letsencrypt \
    /var/spool/cron/crontabs /etc/cron.d \
    /etc/systemd/system /etc/ufw /etc/fail2ban/jail.local /etc/ssh/sshd_config.d \
    /root/deploy-state /root/env-backups /root/.ssh \
    /etc/x-ui /usr/local/x-ui/bin/config.json \
    /etc/roxira/backup.env; do
    [ -e "$p" ] && echo "$p"
  done
}

RESTIC_EXCLUDES=(
  --exclude '__pycache__' --exclude '*.pyc' --exclude 'node_modules' --exclude '.next/cache'
  --exclude '.cache' --exclude '*.tmp' --exclude '/opt/roxira_platform/data/sandboxes/*/node_modules'
  --exclude '/etc/roxira/restic.pass' --exclude '/root/.ssh/known_hosts.old'
)

# ---- modes -----------------------------------------------------------------------------------
mode_init() {
  step "init restic repositories"
  local repos r
  repos="$(configured_repos)"
  [ -n "$repos" ] || die "no repository configured (set BACKUP_SB_USER/BACKUP_SB_HOST and/or BACKUP_S3_*)"
  for r in $repos; do
    if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] restic init on repo '$r' (skipped if it already exists)"; continue; fi
    if restic_on "$r" cat config >/dev/null 2>&1; then
      log "repo $r already initialised"
    else
      restic_on "$r" init && log "repo $r initialised"
    fi
  done
}

mode_run() {
  local t0 t_start started
  t0="$(date +%s)"
  started="$(stamp)"
  STATUS_TMP=""
  if [ "$DRY_RUN" != "1" ]; then
    STATUS_TMP="$STATE_DIR/status.env.new"
    : >"$STATUS_TMP"
  fi
  status_set LAST_RUN_START "$started"

  if [ "$DRY_RUN" != "1" ]; then
    exec 9>"${BACKUP_LOCK_FILE:-/var/lock/roxira-backup-dr.lock}"
    flock -n 9 || { log "another backup run is active; exiting"; exit 0; }
    mkdir -p "$(dirname "$LOG_FILE")"
    exec > >(tee -a "$LOG_FILE") 2>&1
    command -v jq >/dev/null || die "jq not installed"
    umask 077
    mkdir -p "$LOCAL_DIR"
    chmod 700 "$LOCAL_DIR" 2>/dev/null || true
    if [ -n "$(configured_repos)" ]; then
      command -v restic >/dev/null || die "restic not installed"
      [ -r "$RESTIC_PASSWORD_FILE" ] || die "restic password file $RESTIC_PASSWORD_FILE missing"
    fi
  fi
  local local_only=0
  [ -z "$(configured_repos)" ] && [ "${BACKUP_ALLOW_LOCAL_ONLY:-0}" = "1" ] && local_only=1
  status_set BACKUP_MODE "$([ "$local_only" = 1 ] && echo local-only || echo restic)"

  step "1/6 disk guard"
  local pct
  pct="$(disk_pct "$(dirname "$LOCAL_DIR")")"
  pct="${pct:-0}"
  status_set DISK_PCT "$pct"
  log "disk usage of backup filesystem: ${pct}% (warn ${DISK_WARN}, abort ${DISK_ABORT})"
  if [ "$pct" -ge "$DISK_ABORT" ]; then
    # free space first by dropping only the oldest local sets (keep the newest one); refuse to stage if still above the abort threshold
    prune_sets 1 0
    pct="$(disk_pct "$(dirname "$LOCAL_DIR")")"
    if [ "$pct" -ge "$DISK_ABORT" ]; then
      status_set LAST_RESULT FAIL; status_set LAST_ERROR "disk ${pct}% >= ${DISK_ABORT}%, staging refused"
      alert "DISK FULL ${pct}%" "Backup aborted: disk at ${pct}%. Free space on the server."
      [ "$DRY_RUN" = "1" ] || mv "$STATUS_TMP" "$STATUS_FILE"
      exit 2
    fi
  elif [ "$pct" -ge "$DISK_WARN" ]; then
    WARNS+=("disk usage ${pct}% >= ${DISK_WARN}%")
    KEEP_HOURLY=1; KEEP_DAILY=0
    alert "disk ${pct}%" "Disk usage on the backup filesystem is ${pct}% (threshold ${DISK_WARN}%). Local backup sets reduced to 1."
  fi
  # Absolute free-space floor (BACKUP_MIN_FREE_GB): keep only the newest set, free space now, alert.
  local free_now
  free_now="$(free_gb "$(dirname "$LOCAL_DIR")" 2>/dev/null || true)"
  case "$free_now" in ''|*[!0-9]*) free_now="" ;; esac  # only a clean integer is compared
  status_set FREE_GB "${free_now:-unknown}"
  log "free space on backup filesystem: ${free_now:-unknown} GB (floor ${MIN_FREE_GB} GB)"
  if [ -n "$free_now" ] && [ "$free_now" -lt "$MIN_FREE_GB" ]; then
    KEEP_HOURLY=1; KEEP_DAILY=0
    WARNS+=("free disk ${free_now} GB < ${MIN_FREE_GB} GB; local sets reduced to the newest one")
    prune_sets 1 0
    alert "low disk: ${free_now} GB free" "Free space is ${free_now} GB, below BACKUP_MIN_FREE_GB=${MIN_FREE_GB}. Only the newest local backup set is kept. Free space on the server (docker prune, scripts/ops/backup/prune_legacy_backups.sh)."
  fi

  step "2/6 stage dumps"
  run rm -rf "$STAGE"
  run mkdir -p "$STAGE"
  dump_postgres
  dump_qdrant
  dump_redis
  dump_volumes
  dump_meta
  [ -z "$(configured_repos)" ] && dump_configs
  if [ "$DRY_RUN" != "1" ]; then
    status_set STAGE_BYTES "$(du -sb "$STAGE" | cut -f1)"
  fi

  step "3/6 local rotation (hardlinked sets: ${KEEP_HOURLY} hourly + ${KEEP_DAILY} daily)"
  if [ "${#FAILS[@]}" -eq 0 ]; then
    run mkdir -p "$SETS_DIR"
    run cp -al "$STAGE" "$SETS_DIR/$started"
    if [ "$DRY_RUN" != "1" ]; then
      ln -sfn "$SETS_DIR/$started" "$SETS_DIR/latest"
      prune_sets "$KEEP_HOURLY" "$KEEP_DAILY"
    fi
  else
    warn "dump failures present; not rotating a local set from a partial stage"
  fi

  step "4/6 restic backup"
  local repos=() r out sid added
  while IFS= read -r r; do [ -n "$r" ] && repos+=("$r"); done < <(configured_repos)
  if [ "${#repos[@]}" -eq 0 ]; then
    if [ "$local_only" = 1 ]; then
      log "no restic repository configured; BACKUP_ALLOW_LOCAL_ONLY=1, local sets only (the Mac pull is the second copy)"
    elif [ "$DRY_RUN" != "1" ]; then
      FAILS+=("no restic repository configured (set BACKUP_ALLOW_LOCAL_ONLY=1 for local sets + Mac pull)")
    fi
  fi
  PATHS=()
  while IFS= read -r p; do PATHS+=("$p"); done < <(backup_paths)
  for r in ${repos[@]+"${repos[@]}"}; do
    if [ "$DRY_RUN" = "1" ]; then
      echo "[dry-run] restic backup (repo $r) --host roxira-prod --tag hourly ${#PATHS[@]} paths"
      continue
    fi
    out="$(mktemp)"
    if restic_on "$r" backup --host roxira-prod --tag hourly "${RESTIC_EXCLUDES[@]}" "${PATHS[@]}" >"$out" 2>&1; then
      sid="$(sed -n 's/^snapshot \([0-9a-f]\{8\}\) saved.*/\1/p' "$out" | tail -1)"
      added="$(sed -n 's/^Added to the repository: \(.*\)$/\1/p' "$out" | tail -1)"
      status_set "SNAP_$r" "${sid:-?}"; status_set "ADDED_$r" "${added:-?}"
      log "restic $r ok: snapshot ${sid:-?}, added ${added:-?}"
    else
      FAILS+=("restic backup to $r failed: $(tail -3 "$out" | tr '\n' ' ')")
    fi
    rm -f "$out"
  done

  step "5/6 retention (forget --prune, once a day)"
  for r in ${repos[@]+"${repos[@]}"}; do
    if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] restic forget --keep-hourly 24 --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune (repo $r) at ${PRUNE_HOUR_UTC}h UTC"; continue; fi
    if [ "$(date -u +%H)" = "$PRUNE_HOUR_UTC" ] || [ ! -f "$STATE_DIR/last_prune_$r" ]; then
      if restic_on "$r" forget --host roxira-prod --keep-hourly 24 --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune >/dev/null 2>&1; then
        touch "$STATE_DIR/last_prune_$r"
      else
        WARNS+=("restic forget/prune failed on $r")
      fi
    fi
  done

  step "6/6 status"
  t_start="$(( $(date +%s) - t0 ))"
  status_set LAST_RUN_END "$(stamp)"; status_set DURATION_S "$t_start"
  status_set WARNINGS "${WARNS[*]:-}"
  if [ "${#FAILS[@]}" -gt 0 ]; then
    status_set LAST_RESULT FAIL; status_set LAST_ERROR "${FAILS[*]}"
    [ "$DRY_RUN" = "1" ] || mv "$STATUS_TMP" "$STATUS_FILE"
    alert "FAILED" "Backup run failed:
$(printf ' - %s\n' "${FAILS[@]}")"
    exit 1
  fi
  status_set LAST_RESULT OK; status_set LAST_OK "$(stamp)"
  [ "$DRY_RUN" = "1" ] || mv "$STATUS_TMP" "$STATUS_FILE"
  log "backup run OK in ${t_start}s (warnings: ${#WARNS[@]})"
}

mode_bundle() {
  # Small config bundle (env files, compose, nginx, crontabs, units) encrypted to the owner's age public key.
  local out
  out="$STATE_DIR/config-bundle-$(stamp).tar.age"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] tar .env/compose/nginx/crontabs/systemd/ufw | age -r \$BACKUP_AGE_RECIPIENT -> $out (must be < ${BUNDLE_MAX_BYTES} bytes)"
    echo "$out"
    return 0
  fi
  [ -n "${BACKUP_AGE_RECIPIENT:-}" ] || { warn "BACKUP_AGE_RECIPIENT unset; bundle skipped"; return 1; }
  command -v age >/dev/null || { warn "age not installed; bundle skipped"; return 1; }
  local list=() p
  for p in "$REPO_DIR/.env" "$REPO_DIR/docker/research-stack/.env" "$REPO_DIR/docker-compose.prod.yml" \
    "$REPO_DIR/docker/research-stack/docker-compose.yml" "$REPO_DIR/nginx.conf" /etc/nginx/conf.d \
    /var/spool/cron/crontabs /etc/cron.d /etc/ufw/user.rules /etc/ufw/user6.rules /etc/x-ui/x-ui.db \
    /usr/local/x-ui/bin/config.json /etc/roxira/backup.env /root/deploy-state/env-backups; do
    [ -e "$p" ] && list+=("$p")
  done
  find "$STATE_DIR" -maxdepth 1 -name 'config-bundle-*.tar.age' -mtime +14 -delete 2>/dev/null || true
  tar -czf - --warning=no-file-changed "${list[@]}" 2>/dev/null | age -r "$BACKUP_AGE_RECIPIENT" -o "$out"
  local size
  size="$(stat -c %s "$out")"
  if [ "$size" -gt "$BUNDLE_MAX_BYTES" ]; then
    warn "config bundle is $(human "$size"), over the limit; not attached"
    rm -f "$out"
    return 1
  fi
  echo "$out"
}

mode_offsite() {
  # Encrypt (age, owner public key) a tar of: latest Postgres dumps, configs, extra paths; split; mail the parts.
  local day work payload latest out rc=0 list=() p
  day="$(date -u +%F)"
  work="$STATE_DIR/offsite"
  payload="$work/roxira-offsite-$day.tar.age"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] tar latest pg dumps + configs + BACKUP_EMAIL_EXTRA_PATHS | age -r \$BACKUP_AGE_RECIPIENT -> $payload"
    echo "[dry-run] email_offsite.py offsite --input $payload (caps: BACKUP_EMAIL_PART_MB/MAX_MAILS/MAX_DAY_MB)"
    return 0
  fi
  [ -n "${BACKUP_AGE_RECIPIENT:-}" ] || { warn "BACKUP_AGE_RECIPIENT unset; offsite skipped"; return 1; }
  command -v age >/dev/null || { warn "age not installed; offsite skipped"; return 1; }
  latest="$(readlink -f "$SETS_DIR/latest" 2>/dev/null || true)"
  [ -d "$latest" ] || { warn "no local set to mail"; return 1; }
  mkdir -p "$work"; chmod 700 "$work"
  find "$work" -maxdepth 1 -type f -mtime +2 -delete 2>/dev/null || true
  for p in "$latest/pg" "$REPO_DIR/.env" "$REPO_DIR/docker/research-stack/.env" "$REPO_DIR/docker-compose.prod.yml" \
    "$REPO_DIR/docker/research-stack/docker-compose.yml" "$REPO_DIR/nginx.conf" /etc/nginx/conf.d /etc/roxira/backup.env $EMAIL_EXTRA_PATHS; do
    [ -e "$p" ] && list+=("$p")
  done
  tar -czf - --warning=no-file-changed "${list[@]}" 2>/dev/null | age -r "$BACKUP_AGE_RECIPIENT" -o "$payload"
  python3 "$SCRIPT_DIR/email_offsite.py" offsite --input "$payload" --work-dir "$work/parts" \
    --state-file "$STATE_DIR/email_day.json" || rc=$?
  # Normal runs write the manifest under parts/, the OVER_CAP path writes it in $work.
  cp -f "$work/parts/offsite-manifest-$day.json" "$work/manifest-last.json" 2>/dev/null \
    || cp -f "$work/offsite-manifest-$day.json" "$work/manifest-last.json" 2>/dev/null || true
  rm -f "$payload"
  return "$rc"
}

mode_report() {
  local date_s out_dir pct rc=0 extra=()
  date_s="$(date -u +%F)"
  out_dir="$STATE_DIR/report"
  pct="$(disk_pct "$(dirname "$LOCAL_DIR")")"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] email_offsite.py report -> backup-report-$date_s.md + manifest-$date_s.json (+ config bundle weekly, offsite mode=$EMAIL_OFFSITE)"
    return 0
  fi
  mkdir -p "$out_dir"
  local do_off=0
  case "$EMAIL_OFFSITE" in
    daily) do_off=1 ;;
    weekly) [ "$(date -u +%u)" = "$BUNDLE_DOW" ] && do_off=1 ;;
  esac
  [ "${FORCE_OFFSITE:-0}" = "1" ] && do_off=1
  rm -f "$STATE_DIR/offsite/manifest-last.json"
  if [ "$do_off" = 1 ]; then
    mode_offsite || warn "offsite e-mail did not complete (rc=$?); the report says so"
  elif [ "$(date -u +%u)" = "$BUNDLE_DOW" ] || [ "${FORCE_BUNDLE:-0}" = "1" ]; then
    local b
    if b="$(mode_bundle)"; then extra+=(--attach "$b"); fi
  fi
  local off_args=()
  [ -f "$STATE_DIR/offsite/manifest-last.json" ] && off_args=(--offsite-manifest "$STATE_DIR/offsite/manifest-last.json")
  python3 "$SCRIPT_DIR/email_offsite.py" report --status-env "$STATUS_FILE" --check-env "$CHECK_FILE" \
    --sets-dir "$SETS_DIR" --out-dir "$out_dir" --date "$date_s" --host "$(hostname)" --disk-pct "${pct:-0}" \
    ${off_args[@]+"${off_args[@]}"} ${extra[@]+"${extra[@]}"} || rc=$?
  [ "$rc" = 0 ] || warn "report email not sent (rc=$rc)"
}

mode_check() {
  local r out all_ok=1 res
  STATUS_TMP=""
  for r in $(configured_repos); do
    if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] restic check --read-data-subset=5% (repo $r)"; continue; fi
    out="$(mktemp)"
    if restic_on "$r" check --read-data-subset=5% >"$out" 2>&1; then
      log "restic check $r ok"
    else
      all_ok=0
      alert "restic check FAILED on $r" "$(tail -20 "$out")"
    fi
    rm -f "$out"
  done
  [ "$DRY_RUN" = "1" ] && return 0
  res=OK; [ "$all_ok" = 1 ] || res=FAIL
  # separate file: status.env is atomically replaced by every hourly run and would drop these lines
  { printf "CHECK_RESULT='%s'\n" "$res"; printf "CHECK_AT='%s'\n" "$(stamp)"; } >"$CHECK_FILE.new" && mv "$CHECK_FILE.new" "$CHECK_FILE"
  [ "$all_ok" = 1 ]
}

case "$MODE" in
  init) mode_init ;;
  run) mode_run ;;
  report) mode_report ;;
  check) mode_check ;;
  bundle) mode_bundle ;;
  offsite) mode_offsite ;;
esac
