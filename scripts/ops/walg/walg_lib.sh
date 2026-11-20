#!/usr/bin/env bash
# shellcheck shell=bash
# Shared helpers for the WAL-G scripts (row T204). Source it, do not run it. No secrets are defined here.
# The env file (default /etc/roxira/walg.env, root 0600) is sourced by name only and never printed.

WALG_ENV_FILE="${WALG_ENV_FILE:-/etc/roxira/walg.env}"
WALG_CONTAINER="${WALG_CONTAINER:-roxira_postgres_prod}"
# Same state dir as the existing backups, so the same status-file pattern (key='value') and alerting apply.
WALG_STATE_DIR="${BACKUP_STATE_DIR:-/var/lib/roxira-backup}"
WALG_FLAG_DIR="${WALG_FLAG_DIR:-$WALG_STATE_DIR/walg}"       # bind-mounted into the container as /walg-state
WALG_STATUS_FILE="$WALG_STATE_DIR/walg.env"                  # read by the report / monitoring
WALG_BASE_FILE="$WALG_STATE_DIR/walg_base.env"               # written only by walg_nightly.sh
export WALG_STATUS_FILE WALG_BASE_FILE
WALG_RETAIN_FULL="${WALG_RETAIN_FULL:-7}"
WALG_MAX_ARCHIVE_AGE_MIN="${WALG_MAX_ARCHIVE_AGE_MIN:-30}"
WALG_MAX_BASE_AGE_H="${WALG_MAX_BASE_AGE_H:-30}"
DRY_RUN="${DRY_RUN:-0}"
SCRIPT_DIR_WALG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY_PY="${NOTIFY_PY:-$SCRIPT_DIR_WALG/../notify/notify.py}"

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

load_walg_env() {
  if [ -r "$WALG_ENV_FILE" ]; then
    local line key val
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      case "$line" in '' | '#'*) continue ;; esac
      [[ "$line" =~ ^(WALG_|AWS_|PG|POSTGRES_)[A-Z0-9_]*= ]] || die "env file has an invalid line (expected KEY=VALUE with WALG_/AWS_/PG/POSTGRES_)"
      # shellcheck disable=SC2016  # literal match on purpose
      case "$line" in *'$'* | *'`'*) die "env file contains forbidden shell metacharacters (\$ or backtick)" ;; esac
      key="${line%%=*}"
      val="${line#*=}"
      export "$key=$val"
    done <"$WALG_ENV_FILE"
  elif [ "$DRY_RUN" = "1" ]; then
    log "WARN: $WALG_ENV_FILE not readable (ok for --dry-run)"
  else
    die "env file $WALG_ENV_FILE not readable; copy deploy/backup/walg.env.example there (chmod 600)"
  fi
}

# env_write FILE KEY=VALUE...: atomically rewrite a small status file (same pattern as server_backup.sh).
env_write() {
  local f="$1" kv tmp="$1.new"
  shift
  : >"$tmp"
  for kv in "$@"; do printf "%s='%s'\n" "${kv%%=*}" "$(printf '%s' "${kv#*=}" | tr -d "'\n")" >>"$tmp"; done
  mv "$tmp" "$f"
}

# alert SUBJECT MESSAGE: subjects containing FAILED go to Telegram at once (cooldown 1 h per subject in
# notify.py); anything else only into the digest. Same routing as alert() in server_backup.sh.
alert() {
  local text
  text="$2 (host $(hostname), see docs/ops/WALG.md)"
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] alert: $1"; return 0; fi
  case "$1" in
    *FAILED*) python3 "$NOTIFY_PY" --urgent "backup:$1" "$1: $text" >/dev/null 2>&1 || log "WARN: urgent notice not sent: $1" ;;
    *) python3 "$NOTIFY_PY" --queue alert backup "$1" "$text" >/dev/null 2>&1 || log "WARN: digest queue not written: $1" ;;
  esac
}

# walg_exec <args...>: run wal-g inside the postgres container as the postgres user (env comes from env_file).
# Only these subcommands may run; anything else is refused.
walg_exec() {
  case "${1:-}" in
    backup-push | backup-list | delete | wal-push | wal-fetch | backup-fetch) ;;
    *) die "wal-g subcommand not allowed: ${1:-<none>}" ;;
  esac
  docker exec -u postgres "$WALG_CONTAINER" wal-g "$@"
}
