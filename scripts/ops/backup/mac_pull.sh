#!/usr/bin/env bash
# Mac side of the 3-2-1 backup: keep an encrypted local restic repository of the production backups.
#
#   copy mode (preferred): `restic copy` the server's snapshots from the Hetzner Storage Box repo
#                          into ~/Backups/roxira-dr/restic  (needs Storage Box access from the Mac)
#   rsync mode (default when no Storage Box is configured, or MAC_PULL_MODE=rsync): rsync the newest
#                          consistent dump set (sets/latest, written hourly by server_backup.sh) over ssh
#                          into a private temp dir, `restic backup` it into the local repo, delete the temp dir
# Either way the data at rest on the Mac is inside a restic (AES-256) repository.
#
# Usage: mac_pull.sh [--dry-run]
# Config: ~/Secrets/roxira/backup-pull.env (names only below; file mode 600, never in git)
#   ROXIRA_HOST (default 5.75.200.67), RESTIC_DR_PASSWORD_FILE (default ~/Secrets/roxira/restic-dr.pass),
#   SB_REMOTE_PASSWORD_FILE (default same file: the server repo password), BACKUP_SB_USER, BACKUP_SB_HOST,
#   BACKUP_SB_PORT (23), BACKUP_SB_KEY (~/Secrets/roxira/storagebox_backup), BACKUP_SB_PATH (roxira-restic)
#   MAC_PULL_MODE (auto|rsync|copy), MAC_PULL_MAX_AGE_H (rsync mode: fail if the server set is older, default 6),
#   MAC_PULL_KEEP_DAILY/WEEKLY/MONTHLY (14/8/12), ROXIRA_SSH_USER (root), ROXIRA_SSH_KEY (optional)
# Only ~/Backups/roxira-dr/ is written; other ~/Backups content is never touched.
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

CONF="${ROXIRA_PULL_ENV:-$HOME/Secrets/roxira/backup-pull.env}"
if [ -r "$CONF" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONF"
  set +a
fi
HOST="${ROXIRA_HOST:-5.75.200.67}"
DEST="${ROXIRA_DR_DIR:-$HOME/Backups/roxira-dr}"
LOCAL_REPO="$DEST/restic"
LOG="$DEST/pull.log"
LOCAL_PW="${RESTIC_DR_PASSWORD_FILE:-$HOME/Secrets/roxira/restic-dr.pass}"
REMOTE_PW="${SB_REMOTE_PASSWORD_FILE:-$LOCAL_PW}"
KEY="${BACKUP_SB_KEY:-$HOME/Secrets/roxira/storagebox_backup}"
PULL_MODE="${MAC_PULL_MODE:-auto}"
MAX_AGE_H="${MAC_PULL_MAX_AGE_H:-6}"
SSH_USER="${ROXIRA_SSH_USER:-root}"
SB_OK=0
FORGET_SEL=(--group-by "host,tags" --tag mac-pull)   # rsync mode: one stable group, paths differ per run
if [ "$PULL_MODE" != rsync ] && [ -n "${BACKUP_SB_USER:-}" ] && [ -n "${BACKUP_SB_HOST:-}" ] && [ -r "$KEY" ]; then SB_OK=1; fi

log() {
  if [ "$DRY_RUN" = 1 ]; then printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; return; fi
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG" >&2
}
# message text goes in as argv, never spliced into the AppleScript source (no injection via error text)
notify() {
  osascript -e 'on run argv' \
    -e 'display notification (item 2 of argv) with title "Roxira DR backup" subtitle (item 1 of argv)' \
    -e 'end run' -- "$1" "$2" >/dev/null 2>&1 || true
}
fail() { log "ERROR: $*"; notify FAILED "$*"; exit 1; }
doit() { if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }

[ "$DRY_RUN" = 1 ] || mkdir -p "$DEST"
[ "$DRY_RUN" = 1 ] || { command -v restic >/dev/null || fail "restic missing: brew install restic"; }
[ "$DRY_RUN" = 1 ] || [ -r "$LOCAL_PW" ] || fail "password file $LOCAL_PW missing"

# Online check: launchd also fires while offline; skip quietly, it retries next day / next wake.
if [ "$DRY_RUN" != 1 ] && ! nc -z -G 5 "$HOST" 22 >/dev/null 2>&1; then
  log "server $HOST unreachable (offline?); will retry on the next run"
  # an offline Mac is normal for a day; if the last good pull is older than 48h, say so
  if [ -f "$DEST/last_ok" ] && [ -n "$(find "$DEST/last_ok" -mmin +2880 2>/dev/null)" ]; then notify STALE "No successful pull for over 48h"; fi
  exit 0
fi

step_init() {
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] restic init $LOCAL_REPO (if missing)"; return; fi
  RESTIC_PASSWORD_FILE="$LOCAL_PW" restic -r "$LOCAL_REPO" cat config >/dev/null 2>&1 \
    || {
      if [ "$SB_OK" = 1 ]; then
        # same chunker params as the source repo so `restic copy` keeps deduplication
        RESTIC_PASSWORD_FILE="$LOCAL_PW" RESTIC_FROM_PASSWORD_FILE="$REMOTE_PW" restic -r "$LOCAL_REPO" \
          -o "sftp.command=ssh -p ${BACKUP_SB_PORT:-23} -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${BACKUP_SB_USER}@${BACKUP_SB_HOST} -s sftp" \
          init --from-repo "sftp:${BACKUP_SB_USER}@${BACKUP_SB_HOST}:${BACKUP_SB_PATH:-roxira-restic}" --copy-chunker-params
      else
        RESTIC_PASSWORD_FILE="$LOCAL_PW" restic -r "$LOCAL_REPO" init
      fi
    }
}
step_init

if [ "$SB_OK" = 1 ]; then
  FORGET_SEL=()
  log "mode=copy from Storage Box ${BACKUP_SB_HOST}"
  SB_REPO="sftp:${BACKUP_SB_USER}@${BACKUP_SB_HOST}:${BACKUP_SB_PATH:-roxira-restic}"
  SB_SFTP="ssh -p ${BACKUP_SB_PORT:-23} -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${BACKUP_SB_USER}@${BACKUP_SB_HOST} -s sftp"
  # restic applies global -o options to BOTH repositories in `copy` (the --from-repo options are cloned from
  # the global ones), so sftp.command below reaches the Storage Box; the local repo ignores the sftp namespace.
  # Same password on both repos is simplest; copy requires chunker params to match, so the local repo
  # is initialised with --copy-chunker-params from the source on first run (see DISASTER_RECOVERY.md).
  doit env RESTIC_PASSWORD_FILE="$LOCAL_PW" RESTIC_FROM_PASSWORD_FILE="$REMOTE_PW" \
    restic -r "$LOCAL_REPO" -o "sftp.command=$SB_SFTP" copy --from-repo "$SB_REPO" --host roxira-prod \
    || fail "restic copy failed"
else
  log "mode=rsync pull from ${SSH_USER}@${HOST} (no Storage Box in use)"
  umask 077
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/roxira-pull.XXXXXX")"
  trap '[ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf -- "$TMP"' EXIT
  SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20)
  [ -n "${ROXIRA_SSH_KEY:-}" ] && SSH_OPTS+=(-i "$ROXIRA_SSH_KEY")
  SSH=(ssh "${SSH_OPTS[@]}")
  SSH_CMD="${SSH[*]}"
  REMOTE="${SSH_USER}@${HOST}"
  SETS=/opt/roxira_backups/dr/sets
  if [ "$DRY_RUN" != 1 ]; then
    # What are we about to pull, and is it fresh? (the set name is its UTC timestamp)
    SET_ID="$("${SSH[@]}" "$REMOTE" "basename \"\$(readlink -f $SETS/latest)\"" 2>/dev/null || true)"
    case "$SET_ID" in
      20[0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
      *) fail "no valid dump set found at $SETS/latest on the server (is the hourly backup running?)" ;;
    esac
    SET_EPOCH="$(date -j -u -f '%Y%m%dT%H%M%SZ' "$SET_ID" +%s 2>/dev/null || date -u -d "${SET_ID:0:8} ${SET_ID:9:2}:${SET_ID:11:2}:${SET_ID:13:2}" +%s)"
    AGE_H=$(( ( $(date +%s) - SET_EPOCH ) / 3600 ))
    log "newest server set: $SET_ID (${AGE_H}h old)"
    [ "$AGE_H" -le "$MAX_AGE_H" ] || fail "newest server set is ${AGE_H}h old (> ${MAX_AGE_H}h): server backup timer stopped?"
  fi
  doit rsync -a -e "$SSH_CMD" "${REMOTE}:${SETS}/latest/" "$TMP/" \
    || fail "rsync of latest dump set failed"
  # status + newest age-encrypted config bundle (both optional)
  doit rsync -a -e "$SSH_CMD" "${REMOTE}:/var/lib/roxira-backup/status.env" "$TMP/" 2>/dev/null || true
  doit rsync -a -e "$SSH_CMD" "${REMOTE}:/var/lib/roxira-backup/config-bundle-*.tar.age" "$TMP/" 2>/dev/null || true
  doit env RESTIC_PASSWORD_FILE="$LOCAL_PW" restic -r "$LOCAL_REPO" backup --host roxira-prod --tag mac-pull "$TMP" \
    || fail "local restic backup failed"
fi

doit env RESTIC_PASSWORD_FILE="$LOCAL_PW" restic -r "$LOCAL_REPO" forget "${FORGET_SEL[@]}" \
  --keep-daily "${MAC_PULL_KEEP_DAILY:-14}" --keep-weekly "${MAC_PULL_KEEP_WEEKLY:-8}" --keep-monthly "${MAC_PULL_KEEP_MONTHLY:-12}" --prune \
  || log "warn: forget/prune failed"
if [ "$DRY_RUN" != 1 ] && [ "$(date +%u)" = 7 ]; then
  RESTIC_PASSWORD_FILE="$LOCAL_PW" restic -r "$LOCAL_REPO" check --read-data-subset=5% >/dev/null || fail "weekly check failed on local repo"
fi
log "done"
[ "$DRY_RUN" = 1 ] || touch "$DEST/last_ok"
notify OK "Mac copy refreshed in $DEST"
