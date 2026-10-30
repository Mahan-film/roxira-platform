#!/usr/bin/env bash
# Move agent checks (workbench.sh) from Docker on srv1 to Daytona sandboxes (docs/factory/DAYTONA.md).
#
#   enable_daytona_workbench.sh              dry run: report what would be written (default)
#   enable_daytona_workbench.sh --apply      add WORKBENCH_BACKEND=daytona and DAYTONA_API_KEY to the
#                                            taskq service env file, then restart roxira-taskq
#   enable_daytona_workbench.sh --rollback   restore the previous env file, then restart roxira-taskq
#
# The key is copied from the srv1 .env by this script and is never printed. The env file keeps mode 0600.
# When Daytona cannot start a sandbox, workbench.sh falls back to local checks by itself.
#
# Env (tests only): ROXIRA_ENV_FILE, TASKQ_ENV_FILE, NO_RESTART=1.
set -euo pipefail

SRC_ENV="${ROXIRA_ENV_FILE:-/opt/roxira_platform/.env}"
DST_ENV="${TASKQ_ENV_FILE:-/etc/roxira/taskq.env}"
BACKUP="$DST_ENV.pre-daytona"
KEYS_RE='^(WORKBENCH_BACKEND|DAYTONA_API_KEY|WORKBENCH_DAYTONA_MAX)='
MODE="dry-run"
case "${1:-}" in
  "" | --dry-run) ;;
  --apply) MODE="apply" ;;
  --rollback) MODE="rollback" ;;
  -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

restart() {
  if [ "${NO_RESTART:-0}" = "1" ]; then echo "restart skipped (NO_RESTART=1)"; return; fi
  systemctl restart roxira-taskq
  systemctl --no-pager status roxira-taskq | head -n 5
}

if [ "$MODE" = "rollback" ]; then
  [ -f "$BACKUP" ] || { echo "no backup at $BACKUP" >&2; exit 2; }
  tmp="$(mktemp "$DST_ENV.XXXXXX")"
  chmod 0600 "$tmp"
  grep -vE "$KEYS_RE" "$DST_ENV" > "$tmp" || true
  grep -E "$KEYS_RE" "$BACKUP" >> "$tmp" || true
  cat "$tmp" > "$DST_ENV"
  rm -f "$tmp" "$BACKUP"
  echo "restored the Daytona variables in $DST_ENV to their earlier values (other lines untouched)"
  restart
  exit 0
fi

[ -f "$SRC_ENV" ] || { echo "missing $SRC_ENV" >&2; exit 2; }
key="$(grep -E '^DAYTONA_API_KEY=' "$SRC_ENV" | head -n 1 | cut -d= -f2- || true)"
[ -n "$key" ] || { echo "DAYTONA_API_KEY not found in $SRC_ENV" >&2; exit 2; }

echo "source key        : DAYTONA_API_KEY present in $SRC_ENV (${#key} chars, not shown)"
echo "target env file   : $DST_ENV"
echo "will set          : WORKBENCH_BACKEND=daytona, DAYTONA_API_KEY=<hidden>, WORKBENCH_DAYTONA_MAX=2 (if unset)"
if [ "$MODE" = "dry-run" ]; then
  echo "dry run: nothing written. Apply with: bash $0 --apply"
  exit 0
fi

mkdir -p "$(dirname "$DST_ENV")"
[ -f "$DST_ENV" ] || install -m 0600 /dev/null "$DST_ENV"
# keep the FIRST backup: a second --apply must not overwrite the pre-Daytona state
[ -f "$BACKUP" ] || cp -p "$DST_ENV" "$BACKUP"
tmp="$(mktemp "$DST_ENV.XXXXXX")"
chmod 0600 "$tmp"
grep -vE '^(WORKBENCH_BACKEND|DAYTONA_API_KEY)=' "$DST_ENV" > "$tmp" || true
{
  echo "WORKBENCH_BACKEND=daytona"
  echo "DAYTONA_API_KEY=$key"
} >> "$tmp"
grep -q '^WORKBENCH_DAYTONA_MAX=' "$tmp" || echo "WORKBENCH_DAYTONA_MAX=2" >> "$tmp"
cat "$tmp" > "$DST_ENV"
rm -f "$tmp"
chmod 0600 "$DST_ENV"
echo "written. Undo with: bash $0 --rollback"
restart
