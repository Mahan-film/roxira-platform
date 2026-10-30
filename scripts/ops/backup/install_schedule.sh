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
  last="$(find "$SAVE_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1)"
  [ -n "$last" ] || { log "ERROR: no saved unit files under $SAVE_ROOT"; exit 1; }
  log "restoring unit files from $last"
  for t in "${NEW_TIMERS[@]}"; do $SYSTEMCTL disable --now "$t" 2>/dev/null || true; done
  for f in "$last"/*; do
    [ -f "$f" ] || continue
    install -m 644 "$f" "$UNIT_DIR/$(basename "$f")"
  done
  for u in roxira-backup-dr-pgcfg.service roxira-backup-dr-pgcfg.timer roxira-backup-dr-drill.service \
    roxira-backup-dr-drill.timer roxira-cleanup.service roxira-cleanup.timer; do
    [ -e "$last/$u" ] || rm -f -- "$UNIT_DIR/$u"   # these did not exist before the install
  done
  $SYSTEMCTL daemon-reload
  $SYSTEMCTL restart roxira-backup-dr-run.timer roxira-telegram-offsite.timer
  log "rolled back: run timer hourly, telegram daily, pgcfg/drill/cleanup timers removed"
  exit 0
fi

for f in "${SRC[@]}"; do [ -r "$f" ] || { log "ERROR: missing $f (is the repo on srv1 up to date?)"; exit 1; }; done
log "preflight: ports and tools"
for t in age python3 docker; do command -v "$t" >/dev/null || log "WARNING: $t not found on PATH"; done
command -v age-keygen >/dev/null || log "WARNING: age-keygen missing, the restore drill will fail (apt install age)"
if [ -r /etc/roxira/backup.env ]; then
  grep -qE '^(BACKUP_R2_ENDPOINT|BACKUP_S3_ENDPOINT)=.+' /etc/roxira/backup.env \
    || log "WARNING: no R2 endpoint in /etc/roxira/backup.env (BACKUP_R2_* or BACKUP_S3_*): pgcfg will report NOT_CONFIGURED"
  grep -qE '^BACKUP_AGE_RECIPIENT=.+' /etc/roxira/backup.env || log "WARNING: BACKUP_AGE_RECIPIENT not set: pgcfg/drill/offsite will refuse to run"
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log "saving current unit files to $SAVE_ROOT/$stamp"
run install -d -m 700 "$SAVE_ROOT/$stamp"
for f in "${SRC[@]}"; do
  u="$(basename "$f")"
  if [ -e "$UNIT_DIR/$u" ]; then run cp -p "$UNIT_DIR/$u" "$SAVE_ROOT/$stamp/$u"; fi
done
for f in "${SRC[@]}"; do run install -m 644 "$f" "$UNIT_DIR/$(basename "$f")"; done
run $SYSTEMCTL daemon-reload
for t in "${ALL_TIMERS[@]}"; do run $SYSTEMCTL enable "$t"; run $SYSTEMCTL restart "$t"; done

log "cleanup dry run (nothing is deleted):"
bash "$REPO/scripts/ops/cleanup_2d.sh" --dry-run || true
if [ "$MODE" = "--dry-run" ]; then
  log "dry-run only. Apply with: sudo bash $0 --apply"
else
  log "installed. Check: systemctl list-timers 'roxira-backup-dr*' 'roxira-telegram*' 'roxira-cleanup*'"
  log "first R2 copy now: systemctl start roxira-backup-dr-pgcfg.service; then the drill: systemctl start roxira-backup-dr-drill.service"
  log "rollback: sudo bash $0 --rollback"
fi
