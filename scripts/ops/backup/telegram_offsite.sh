#!/usr/bin/env bash
# Telegram off-site database backup: the production Postgres databases from the
# roxira_postgres_prod container, dumped with pg_dump -Fc, tarred, age-encrypted to the owner's
# public key (/etc/roxira-backup-age.pub) and sent to the owner's Telegram bot chat in <=45 MB
# parts. This is a CONVENIENCE tier (tier 4), never the primary: the Bot API caps a file at
# 50 MB and the private age key lives ONLY on the owner Mac. See docs/ops/TELEGRAM_BACKUP.md.
#
# Runs ON the production host as root. For every non-template database (or TELEGRAM_BACKUP_DBS):
#   1. pg_dump -Fc inside the container (docker exec; no host port). Compression is built into -Fc.
#   2. verify the dump with pg_restore -l, tar the dumps (no extra compression), age -R the tarball.
#      Refuses to run when the recipient file is missing: an unencrypted dump is never sent.
#   3. split the encrypted file into 45 MB parts (`split -b 45m`), parts numbered.
#   4. send each part with the Bot API sendDocument (curl --fail + retries); the caption carries
#      date, host, part i/n, size and the sha256 of the full encrypted file.
#   5. append one log line (date, size, sha256, ok/fail) to /root/deploy-state/telegram-backup.log
#      and alert the owner via scripts/ops/notify/notify.py on failure.
# Temp files live in a mktemp dir and are removed by a trap; nothing is kept on disk.
#
# Token/chat come from the same env the notify bot uses (NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID,
# optional NOTIFY_BOT_API); TELEGRAM_BACKUP_CHAT_ID overrides the chat. The token is never
# printed (no `set -x`, no URL echo) and every log line passes through offsite_tools.py redact.
#
# Install (on the production server, as root; units live next to this script):
#   install -m 644 scripts/ops/backup/roxira-telegram-offsite.service /etc/systemd/system/
#   install -m 644 scripts/ops/backup/roxira-telegram-offsite.timer   /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now roxira-telegram-offsite.timer
#   systemctl start roxira-telegram-offsite.service   # first run, then:
#   journalctl -u roxira-telegram-offsite -n 60 --no-pager
#
# Extra artifacts (T197): `telegram_offsite.sh --send-file FILE --label NAME` skips the pg_dump and sends
# an ALREADY age-encrypted file (Qdrant snapshots, config set) through the same split + sendDocument path.
# It refuses a file without the age header, waits up to TELEGRAM_LOCK_WAIT s (default 900) for the 6-hourly run,
# and SKIPS (exit 10, logged, no alert) when the file is above TELEGRAM_MAX_TOTAL_MB (default 150): the Bot API
# cap is 50 MB per file, so a big snapshot would be dozens of parts. Exit 0 = sent, 10 = skipped, 1 = failed.
#
# Usage: telegram_offsite.sh [--dry-run] [--send-file FILE --label NAME]
# Env (names only; values never printed): NOTIFY_BOT_TOKEN, NOTIFY_CHAT_ID, NOTIFY_BOT_API,
#   TELEGRAM_BACKUP_CHAT_ID, TELEGRAM_BACKUP_DBS, TELEGRAM_PG_CONTAINER (roxira_postgres_prod),
#   TELEGRAM_AGE_RECIPIENTS_FILE (/etc/roxira-backup-age.pub), TELEGRAM_PART_MB (45),
#   TELEGRAM_BACKUP_LOG (/root/deploy-state/telegram-backup.log), TELEGRAM_MAX_TOTAL_MB (150), TELEGRAM_LOCK_WAIT (900)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=offsite_lib.sh
. "$SCRIPT_DIR/offsite_lib.sh"
# human <bytes>: readable size for log lines (offsite_lib.sh does not define it).
declare -F human >/dev/null || human() { numfmt --to=iec "$1" 2>/dev/null || printf "%sB" "$1"; }

SEND_FILE=""
LABEL="pg"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --send-file) SEND_FILE="${2:?--send-file needs a file}"; shift ;;
    --label) LABEL="${2:?--label needs a name}"; shift ;;
    -h | --help) sed -n '2,43p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
[[ "$LABEL" =~ ^[a-z0-9_-]{1,30}$ ]] || die "bad label '$LABEL'"

load_names NOTIFY_BOT_TOKEN NOTIFY_CHAT_ID NOTIFY_BOT_API TELEGRAM_BACKUP_CHAT_ID

PG_CONTAINER="${TELEGRAM_PG_CONTAINER:-roxira_postgres_prod}"
AGE_FILE="${TELEGRAM_AGE_RECIPIENTS_FILE:-/etc/roxira-backup-age.pub}"
LOG_FILE="${TELEGRAM_BACKUP_LOG:-/root/deploy-state/telegram-backup.log}"
PART_MB="${TELEGRAM_PART_MB:-45}"
MAX_TOTAL_MB="${TELEGRAM_MAX_TOTAL_MB:-150}"
LOCK_WAIT="${TELEGRAM_LOCK_WAIT:-900}"
API="${NOTIFY_BOT_API:-https://api.telegram.org}"
CHAT="${TELEGRAM_BACKUP_CHAT_ID:-${NOTIFY_CHAT_ID:-}}"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DATE="$(date -u '+%F')"
HOSTN="$(hostname)"
SIZE=""
SHA=""
SEND_FAIL=""
export REDACT_ENV_NAMES="NOTIFY_BOT_TOKEN"

# sha256_file FILE: hex sha256, sha256sum or shasum.
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# record STATUS: append one line (date, size, sha256, status) to the local log.
record() {
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  printf '%s size=%s sha256=%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${SIZE:-?}" "${SHA:-?}" "$1" \
    >>"$LOG_FILE" 2>/dev/null || true
}

# fail MESSAGE: log, record a fail line, alert the owner, exit 1. Never fatal on notify.
fail() {
  log "ERROR: $*"
  record "fail: $*"
  notify_owner "Telegram off-site backup FAILED: $*. See: journalctl -u roxira-telegram-offsite -n 80"
  exit 1
}

if [ "$DRY_RUN" = "1" ] && [ -n "$SEND_FILE" ]; then
  echo "[dry-run] send-file : $SEND_FILE (label $LABEL), age header required, skipped above ${MAX_TOTAL_MB} MB, ${PART_MB}m parts"
  exit 0
fi
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] source    : docker exec $PG_CONTAINER pg_dump -Fc for every non-template DB"
  echo "[dry-run] encrypt   : tar dumps | age -R $AGE_FILE -> roxira-pg-\$STAMP.tar.age"
  echo "[dry-run] split     : ${PART_MB}m parts (numbered) when larger"
  echo "[dry-run] send      : curl --fail --retry 3 ${API}/bot***/sendDocument (chat: $([ -n "$CHAT" ] && echo set || echo MISSING))"
  echo "[dry-run] log       : $LOG_FILE"
  exit 0
fi

# --- preflight ---------------------------------------------------------------------------------
NEED_TOOLS="docker age curl split"
[ -n "$SEND_FILE" ] && NEED_TOOLS="curl split"
# shellcheck disable=SC2086  # intentional word splitting of the tool list
for tool in $NEED_TOOLS; do command -v "$tool" >/dev/null 2>&1 || die "$tool not found"; done
[ -n "${NOTIFY_BOT_TOKEN:-}" ] || die "NOTIFY_BOT_TOKEN is not set (scripts/ops/set_server_env.sh NOTIFY_BOT_TOKEN)"
# Never send an unencrypted dump: without the public recipient there is nothing safe to send.
[ -n "$SEND_FILE" ] || [ -r "$AGE_FILE" ] || fail "age recipients file $AGE_FILE missing; refusing to send an unencrypted dump"
[ -n "$CHAT" ] || die "TELEGRAM_BACKUP_CHAT_ID / NOTIFY_CHAT_ID is not set"

mkdir -p "$OFFSITE_STATE_DIR" && chmod 700 "$OFFSITE_STATE_DIR" 2>/dev/null || true
exec 9>"$OFFSITE_STATE_DIR/telegram.lock"
if [ -n "$SEND_FILE" ]; then
  flock -w "$LOCK_WAIT" 9 || die "another telegram_offsite.sh run is still in progress after ${LOCK_WAIT}s"
else
  flock -n 9 || die "another telegram_offsite.sh run is in progress"
fi

WORK="$(mktemp -d)" || die "cannot create work dir"
chmod 700 "$WORK" 2>/dev/null || true
cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT

ENC="$WORK/roxira-$LABEL-$STAMP.tar.age"
if [ -n "$SEND_FILE" ]; then
  # --- extra artifact: already encrypted by the caller; never send anything that is not age output
  [ -s "$SEND_FILE" ] || fail "send-file $SEND_FILE is missing or empty"
  [ "$(head -c 21 "$SEND_FILE")" = "age-encryption.org/v1" ] || fail "send-file $SEND_FILE is not age-encrypted; refusing to send"
  SIZE="$(stat -c %s "$SEND_FILE")"
  SHA="$(sha256_file "$SEND_FILE")"
  if [ "$SIZE" -gt $((MAX_TOTAL_MB * 1048576)) ]; then
    log "SKIPPED $LABEL: $(human "$SIZE") is above TELEGRAM_MAX_TOTAL_MB=${MAX_TOTAL_MB}; R2 is the off-site copy"
    record "skipped $LABEL: $SIZE bytes above ${MAX_TOTAL_MB} MB cap"
    exit 10
  fi
  ENC="$SEND_FILE"
else
  # --- 1. dumps ----------------------------------------------------------------------------------
  mkdir -p "$WORK/pg"
  DBS="${TELEGRAM_BACKUP_DBS:-}"
  if [ -z "$DBS" ]; then
    # Same discovery as server_backup.sh: every non-template database, $POSTGRES_USER expands inside.
    DBS="$(docker exec "$PG_CONTAINER" sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -Atc \"select datname from pg_database where not datistemplate and datname<>'postgres'\"" 2>/dev/null || true)"
  fi
  [ -n "$DBS" ] || fail "no databases found in $PG_CONTAINER (is it running?)"
  # shellcheck disable=SC2086  # intentional word splitting: TELEGRAM_BACKUP_DBS is a space-separated list
  for db in $DBS; do
    [[ "$db" =~ ^[A-Za-z0-9_]{1,63}$ ]] || fail "bad database name '$db'"
    dump_argv=()
    while IFS= read -r -d '' a; do dump_argv+=("$a"); done < <(build_pg_dump_exec "$PG_CONTAINER" "$db")
    "${dump_argv[@]}" >"$WORK/pg/$db.dump" 2>"$WORK/$db.err" \
      || fail "pg_dump failed for $db: $(tail -n 3 "$WORK/$db.err" | tr '\n' ' ' | head -c 300)"
    [ -s "$WORK/pg/$db.dump" ] || fail "empty dump for $db"
    docker exec -i "$PG_CONTAINER" pg_restore -l <"$WORK/pg/$db.dump" >/dev/null 2>&1 \
      || fail "dump for $db is not a readable archive"
    log "dumped $db $(human "$(stat -c %s "$WORK/pg/$db.dump")")"
  done

  # --- 2. encrypt --------------------------------------------------------------------------------
    if ! tar -cf - -C "$WORK/pg" . 2>"$WORK/tar.err" | age -R "$AGE_FILE" -o "$ENC" 2>"$WORK/age.err"; then
    fail "age encryption failed: $(tail -n 3 "$WORK/age.err" | tr '\n' ' ' | head -c 300)"
  fi
  [ -s "$ENC" ] || fail "encrypted file is empty"
  SIZE="$(stat -c %s "$ENC")"
  SHA="$(sha256_file "$ENC")"
  log "encrypted $(human "$SIZE") sha256 $SHA"
fi

# --- 3. split ----------------------------------------------------------------------------------
split -b "${PART_MB}m" -d -a 3 "$ENC" "$WORK/part-"
PARTS=("$WORK"/part-*)
N="${#PARTS[@]}"
[ "$N" -ge 1 ] || fail "split produced no parts"

# --- 4. send -----------------------------------------------------------------------------------
i=0
for part in "${PARTS[@]}"; do
  i=$((i + 1))
  base="$(basename "$part")"
  psize="$(stat -c %s "$part")"
  caption="roxira $LABEL backup $DATE $HOSTN part $i/$N size ${psize}B sha256 $SHA"
  if ! curl --fail --silent --retry 3 --retry-delay 5 --max-time 600 -o "$WORK/send.json" \
    -F "chat_id=$CHAT" -F "caption=$caption" -F "document=@$part;filename=$base" \
    "$API/bot${NOTIFY_BOT_TOKEN}/sendDocument"; then
    SEND_FAIL="curl failed for part $i/$N"
    break
  fi
  if ! grep -q '"ok":true' "$WORK/send.json"; then
    SEND_FAIL="Telegram rejected part $i/$N: $(grep -o '"description":"[^"]*"' "$WORK/send.json" 2>/dev/null | head -n 1 | tr -d '\n' | head -c 200)"
    break
  fi
  log "sent part $i/$N $(human "$psize")"
done

# --- 5. result ---------------------------------------------------------------------------------
if [ -n "$SEND_FAIL" ]; then
  fail "partial send, backup is NOT restorable: $SEND_FAIL"
fi
record "ok"
log "sent $N part(s) of $(human "$SIZE"), sha256 $SHA"
exit 0
