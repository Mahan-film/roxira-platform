#!/usr/bin/env bash
# Stop cron jobs that the 2026-10-30 load audit judged useless (docs/infra/SERVER_LOAD_AUDIT_2026-10-30.md §3).
#
#   stop_useless_jobs.sh                 dry run: list what would move, change nothing (default)
#   stop_useless_jobs.sh --apply         move the cron.d files into a timestamped backup dir and
#                                        comment the tech-scout line in root's crontab
#   stop_useless_jobs.sh --rollback DIR  put everything from backup DIR back
#
# Nothing is deleted: files are moved, never removed, and every run prints the exact undo command.
# Each cron.d file is only moved when its content still matches the job the audit looked at.
#
# Rollback of root's crontab only removes the marker from the lines this script disabled, so edits made
# since then are kept. A copy of the old crontab stays in the backup dir for reference.
#
# Env (tests only): JOBS_ROOT prefix for /etc and /var/backups; JOBS_NO_CRONTAB=1 skips root's crontab;
# CRONTAB_CMD replaces the crontab command.
set -euo pipefail

ROOT="${JOBS_ROOT:-}"
CRON_D="$ROOT/etc/cron.d"
BACKUP_BASE="$ROOT/var/backups/roxira-disabled-jobs"
CRONTAB_CMD="${CRONTAB_CMD:-crontab}"
MARK="#DISABLED-by-stop_useless_jobs# "

# file<TAB>pattern that must still be in it (the audited command)
TARGETS=(
  "roxira_agent_mesh|agent_mesh_daemon.py"
  "roxira_mesh_cron|agent_mesh_daemon.py"
  "roxira_swarm_qa|swarm_qa_worker.py"
  "roxira_social_marketing|run_daily_campaign.sh"
)
CRONTAB_PATTERN="daily_tech_scout.sh"

MODE="dry-run" ROLLBACK_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) MODE="dry-run" ;;
    --apply) MODE="apply" ;;
    --rollback) MODE="rollback"; ROLLBACK_DIR="${2?--rollback needs a backup dir}"; shift ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }

if [ "$MODE" = "rollback" ]; then
  [ -d "$ROLLBACK_DIR" ] || { say "no such backup dir: $ROLLBACK_DIR" >&2; exit 2; }
  for f in "$ROLLBACK_DIR"/*; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    if [ "$name" = "root.crontab" ]; then
      continue  # reference copy only; the crontab is restored line by line below
    else
      if [ -e "$CRON_D/$name" ]; then say "skip $name (already exists)"; continue; fi
      cp -p "$f" "$CRON_D/$name"
      say "restored $CRON_D/$name"
    fi
  done
  if [ "${JOBS_NO_CRONTAB:-0}" != "1" ] && command -v "$CRONTAB_CMD" >/dev/null 2>&1; then
    current="$("$CRONTAB_CMD" -l 2>/dev/null || true)"
    if printf '%s\n' "$current" | grep -qF "$MARK"; then
      printf '%s\n' "$current" | sed "s|^$MARK||" | "$CRONTAB_CMD" -
      say "re-enabled the crontab lines this script had disabled"
    fi
  fi
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_BASE/$STAMP"
moved=0
[ "$MODE" = "apply" ] && mkdir -p "$DEST"

for t in "${TARGETS[@]}"; do
  name="${t%%|*}" pattern="${t#*|}"
  path="$CRON_D/$name"
  if [ ! -f "$path" ]; then say "absent    $path"; continue; fi
  if ! grep -q "$pattern" "$path"; then say "CHANGED   $path no longer runs $pattern, leaving it"; continue; fi
  if [ "$MODE" = "apply" ]; then
    mv "$path" "$DEST/$name"
    say "moved     $path -> $DEST/$name"
  else
    say "would move $path ($(grep -vc '^#' "$path") active lines)"
  fi
  moved=$((moved + 1))
done

if [ "${JOBS_NO_CRONTAB:-0}" != "1" ] && command -v "$CRONTAB_CMD" >/dev/null 2>&1; then
  current="$("$CRONTAB_CMD" -l 2>/dev/null || true)"
  if printf '%s\n' "$current" | grep -v '^#' | grep -q "$CRONTAB_PATTERN"; then
    if [ "$MODE" = "apply" ]; then
      printf '%s\n' "$current" > "$DEST/root.crontab"
      printf '%s\n' "$current" | sed "s|^\([^#].*$CRONTAB_PATTERN.*\)$|$MARK\1|" | "$CRONTAB_CMD" -
      say "commented the $CRONTAB_PATTERN line in root's crontab"
    else
      say "would comment the $CRONTAB_PATTERN line in root's crontab"
    fi
    moved=$((moved + 1))
  else
    say "absent    $CRONTAB_PATTERN in root's crontab"
  fi
fi

if [ "$MODE" = "apply" ]; then
  say "done: $moved item(s). Undo with: bash $0 --rollback $DEST"
else
  say "dry run: $moved item(s) would change. Apply with: bash $0 --apply"
fi
