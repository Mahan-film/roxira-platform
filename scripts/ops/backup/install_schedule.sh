#!/usr/bin/env bash
# Install (or roll back) the 2026-10-30 backup schedule and the 2-day cleanup timer on srv1. Runs ON the server as root.
# Dry-run by default. See docs/ops/BACKUP_SCHEDULE_2026-10-30.md.
#
#   install_schedule.sh              dry-run: print the plan, run cleanup_2d.sh in dry-run mode, change nothing
#   install_schedule.sh --apply      save the current unit files, install the new ones, enable the timers
#   install_schedule.sh --rollback   restore the saved unit files and disable the new timers
#
# What changes:
#   roxira-backup-dr-run.timer        hourly :07 -> daily 01:07 UTC   (full local set, 2 kept)
#   roxira-backup-dr-pgcfg.{service,timer}  NEW hourly :37  (age-encrypted Postgres + configs -> R2)
#   roxira-backup-dr-drill.{service,timer}  NEW weekly Sun 05:10 (restore drill)
#   roxira-telegram-offsite.timer     daily 04:15 -> every 6 hours
#   roxira-cleanup.{service,timer}    NEW every 2 days 05:40 (cleanup_2d.sh)
# Untouched: report 06:30, check Sunday 04:30, neon 02:41, qdrant replica 03:10, /etc/roxira/backup.env.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
SAVE_ROOT="${SCHEDULE_SAVE_DIR:-/var/lib/roxira-backup/unit-backup}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
ENV_FILE="${BACKUP_ENV_FILE:-/etc/roxira/backup.env}"
MARK_BEGIN="# BEGIN roxira-schedule-2026-10-30"
MARK_END="# END roxira-schedule-2026-10-30"

# source path -> unit name
SRC=(
  "$REPO/deploy/systemd/roxira-backup-dr-run.timer"
  "$REPO/deploy/systemd/roxira-backup-dr-pgcfg.service"
  "$REPO/deploy/systemd/roxira-backup-dr-pgcfg.timer"
  "$REPO/deploy/systemd/roxira-backup-dr-drill.service"
  "$REPO/deploy/systemd/roxira-backup-dr-drill.timer"
  "$HERE/roxira-telegram-offsite.service"
  "$HERE/roxira-telegram-offsite.timer"
  "$REPO/scripts/ops/cleanup/roxira-cleanup.service"
  "$REPO/scripts/ops/cleanup/roxira-cleanup.timer"
)
NEW_TIMERS=(roxira-backup-dr-pgcfg.timer roxira-backup-dr-drill.timer roxira-cleanup.timer)
ALL_TIMERS=(roxira-backup-dr-run.timer roxira-telegram-offsite.timer "${NEW_TIMERS[@]}")

MODE="${1:---dry-run}"
case "$MODE" in --dry-run | --apply | --rollback) ;; *) echo "usage: $0 [--dry-run | --apply | --rollback]" >&2; exit 2 ;; esac
log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
run() { if [ "$MODE" = "--dry-run" ]; then printf 'dry-run: %s\n' "$*"; else "$@"; fi; }
[ "$MODE" = "--dry-run" ] || [ "$(id -u)" = 0 ] || [ "${SCHEDULE_TEST:-0}" = 1 ] || { log "ERROR: needs root"; exit 1; }

if [ "$MODE" = "--rollback" ]; then
  # The OLDEST save with a manifest is the state before the first install; a repeated --apply never becomes the target.
  last=""
  while IFS= read -r d; do
    [ -f "$d/manifest" ] && { last="$d"; break; }
  done < <(find "$SAVE_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  [ -n "$last" ] || { log "ERROR: no saved state with a manifest under $SAVE_ROOT; nothing is changed"; exit 1; }
  # Validate everything first: a unit that cannot be restored is never removed, and nothing changes on any error.
  while read -r kind u; do
    case "$kind" in
      saved) [ -f "$last/$u" ] || { log "ERROR: $last/$u is listed but missing; nothing is changed"; exit 1; } ;;
      absent | env) ;;
      *) log "ERROR: bad manifest line '$kind $u'; nothing is changed"; exit 1 ;;
    esac
  done <"$last/manifest"
  log "restoring from $last"
  for t in "${NEW_TIMERS[@]}"; do $SYSTEMCTL disable --now "$t" 2>/dev/null || true; done
  while read -r kind u; do
    case "$kind" in
      saved) install -m 644 "$last/$u" "$UNIT_DIR/$u" ;;
      absent) rm -f -- "$UNIT_DIR/$u" ;;   # did not exist before the install, and the manifest says so
    esac
  done <"$last/manifest"
  # drop the retention block so the hourly timer keeps its old 6 + 3 sets again
  if [ -f "$ENV_FILE" ]; then
    python3 - "$ENV_FILE" "$MARK_BEGIN" "$MARK_END" <<'PY'
import sys
path, begin, end = sys.argv[1:]
out, skip = [], False
for line in open(path).read().splitlines(keepends=True):
    if line.strip() == begin:
        skip = True
    elif line.strip() == end:
        skip = False
    elif not skip:
        out.append(line)
open(path, "w").write("".join(out))
PY
  fi
  $SYSTEMCTL daemon-reload
  $SYSTEMCTL restart roxira-backup-dr-run.timer roxira-telegram-offsite.timer
  log "rolled back: run timer hourly, telegram daily, pgcfg/drill/cleanup timers removed"
  exit 0
fi

for f in "${SRC[@]}"; do [ -r "$f" ] || { log "ERROR: missing $f (is the repo on srv1 up to date?)"; exit 1; }; done

log "preflight"
ERRORS=0
err() { log "ERROR: $*"; ERRORS=$((ERRORS + 1)); }
for t in age age-keygen python3 docker; do command -v "$t" >/dev/null || log "WARNING: $t not found on PATH (the drill and uploads need age, age-keygen, python3, docker)"; done
if [ ! -r "$ENV_FILE" ]; then
  err "$ENV_FILE is not readable: the 2-set retention cannot be written and R2/age settings cannot be checked"
else
  for n in BACKUP_R2_ENDPOINT BACKUP_R2_BUCKET BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY BACKUP_AGE_RECIPIENT; do
    grep -qE "^(export[[:space:]]+)?${n}=.+" "$ENV_FILE" || err "$n is not set in $ENV_FILE"
  done
fi
if [ "$ERRORS" -gt 0 ]; then
  if [ "$MODE" = "--apply" ]; then
    log "refusing to install: without these the daily run would be the only copy and the report would be STALE. Nothing was changed."
    exit 1
  fi
  log "dry-run: --apply would refuse until the errors above are fixed"
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dir="$SAVE_ROOT/$stamp"
manifest=""
for f in "${SRC[@]}"; do
  u="$(basename "$f")"
  if [ ! -e "$UNIT_DIR/$u" ]; then manifest+="absent $u"$'\n'
  elif ! cmp -s "$f" "$UNIT_DIR/$u"; then manifest+="saved $u"$'\n'
  fi
done
if [ -f "$ENV_FILE" ] && ! grep -qF "$MARK_BEGIN" "$ENV_FILE"; then manifest+="env backup.env"$'\n'; fi
if [ -n "$manifest" ]; then
  log "saving what will change to $dir"
  run install -d -m 700 "$dir"
  while read -r kind u; do
    case "$kind" in
      saved) run cp -p "$UNIT_DIR/$u" "$dir/$u" ;;
      env) run cp -p "$ENV_FILE" "$dir/backup.env" ;;
    esac
  done <<<"$manifest"
  if [ "$MODE" = "--apply" ]; then printf '%s' "$manifest" >"$dir/manifest"; fi
else
  log "units and retention already installed; nothing to save"
fi
for f in "${SRC[@]}"; do run install -m 644 "$f" "$UNIT_DIR/$(basename "$f")"; done
# Retention follows the schedule: 2 local sets only once the run timer is daily (the script default stays 6 + 3).
if [ -f "$ENV_FILE" ] && ! grep -qF "$MARK_BEGIN" "$ENV_FILE"; then
  if [ "$MODE" = "--apply" ]; then
    printf '\n%s\nBACKUP_KEEP_HOURLY=2\nBACKUP_KEEP_DAILY=0\n%s\n' "$MARK_BEGIN" "$MARK_END" >>"$ENV_FILE"
  else
    printf 'dry-run: append BACKUP_KEEP_HOURLY=2 / BACKUP_KEEP_DAILY=0 block to %s\n' "$ENV_FILE"
  fi
fi
run $SYSTEMCTL daemon-reload
for t in "${ALL_TIMERS[@]}"; do run $SYSTEMCTL enable "$t"; run $SYSTEMCTL restart "$t"; done

log "cleanup dry run (nothing is deleted):"
bash "$REPO/scripts/ops/cleanup_2d.sh" --dry-run || true
if [ "$MODE" = "--dry-run" ]; then
  log "dry-run only. Apply with: sudo bash $0 --apply"
  [ "$ERRORS" = 0 ] || exit 1
else
  log "installed. Check: systemctl list-timers 'roxira-backup-dr*' 'roxira-telegram*' 'roxira-cleanup*'"
  log "first R2 copy now: systemctl start roxira-backup-dr-pgcfg.service; then the drill: systemctl start roxira-backup-dr-drill.service"
  log "rollback: sudo bash $0 --rollback"
fi
