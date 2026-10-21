#!/usr/bin/env bash
# shellcheck shell=bash
# Shared helpers for the off-site backup scripts (neon_offsite.sh, codeberg_mirror.sh,
# restore_drill.sh). Source it, do not run it. No secret is defined here.
#
# Every log line goes through offsite_tools.py redact, so a connection string or token that
# leaks into a tool's error output is masked before it reaches the journal.

OFFSITE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFSITE_TOOLS="${OFFSITE_TOOLS:-$OFFSITE_LIB_DIR/offsite_tools.py}"
REPO_DIR="${ROXIRA_REPO_DIR:-/opt/roxira_platform}"
SERVER_ENV_FILE="${ROXIRA_SERVER_ENV_FILE:-$REPO_DIR/.env}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/roxira/backup.env}"
OFFSITE_STATE_DIR="${OFFSITE_STATE_DIR:-/var/lib/roxira-offsite}"
DRY_RUN="${DRY_RUN:-0}"

redact() { python3 -I "$OFFSITE_TOOLS" redact; }

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | redact >&2; }
warn() { log "WARN: $*"; }
die() { log "ERROR: $*"; exit 1; }

# env_from_file NAME FILE: print the value of NAME=... in FILE (last wins, quotes stripped).
# Only the requested name is read; the file is never sourced.
env_from_file() {
  local name="$1" file="$2" line val
  [ -r "$file" ] || return 1
  line="$(grep -E "^(export[[:space:]]+)?${name}=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  [ -n "$val" ] || return 1
  printf '%s' "$val"
}

# load_names NAME...: for each name not already in the environment, take it from the server
# .env, then from /etc/roxira/backup.env. Exports it. Values are never printed.
load_names() {
  local n v
  for n in "$@"; do
    if [ -n "${!n:-}" ]; then continue; fi
    v="$(env_from_file "$n" "$SERVER_ENV_FILE" || env_from_file "$n" "$BACKUP_ENV_FILE" || true)"
    if [ -n "$v" ]; then export "$n=$v"; fi
  done
}

# notify_owner TEXT: owner bot (scripts/ops/notify/notify.py). Never raises, never fatal.
notify_owner() {
  local text="$1"
  if [ "$DRY_RUN" = "1" ]; then printf '[dry-run] notify: %s\n' "$text" >&2; return 0; fi
  python3 "$REPO_DIR/scripts/ops/notify/notify.py" "$text" >/dev/null 2>&1 || true
}

# due_since FILE SECONDS: true when FILE is missing or older than SECONDS (throttle for notices).
due_since() {
  local f="$1" secs="$2" now mt
  [ -f "$f" ] || return 0
  now="$(date +%s)"
  mt="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)"
  [ $((now - mt)) -ge "$secs" ]
}

# shq ARGS...: shell-quoted rendering of an argv (for dry-run printing and tests).
shq() { printf '%q ' "$@"; printf '\n'; }

# show_cmd: render a NUL-separated argv from stdin as one quoted line (bash builtin printf %q).
show_cmd() {
  local a out=""
  while IFS= read -r -d '' a; do out+="$(printf '%q ' "$a")"; done
  printf '%s' "$out"
}

# ---- argument builders (pure functions; unit-tested) ------------------------------------------
PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-postgres:17-alpine}"

# The connection string is passed by variable NAME only (docker -e NAME), so it never appears
# in any process argument list.
build_client_run() { # <env-name-with-url> <command...>
  local envname="$1"; shift
  printf '%s\0' docker run --rm -i --network host -e PGCONNECT_TIMEOUT=20 -e "$envname" "$PG_CLIENT_IMAGE" "$@"
}

build_pg_dump_exec() { # <container> <db>
  printf '%s\0' docker exec "$1" sh -c 'exec pg_dump -U "$POSTGRES_USER" -Fc -d "$0"' "$2"
}

# Run inside the client container; the URL is read from the container's environment.
PG_RESTORE_SCRIPT='exec pg_restore --clean --if-exists --no-owner --no-acl --dbname "$NEON_TARGET_URL"'

build_pg_restore_run() { # NUL-separated argv of the restore client (stdin = custom-format dump)
  build_client_run NEON_TARGET_URL sh -c "$PG_RESTORE_SCRIPT"
}

# retention_victims DIR KEEP: list the files to delete (all but the newest KEEP *.dump.age).
retention_victims() {
  local dir="$1" keep="$2" f
  [ -d "$dir" ] || return 0
  # newest first by name (names embed a UTC timestamp)
  # shellcheck disable=SC2012
  ls -1 "$dir" 2>/dev/null | grep -E '^[a-z0-9_]+_20[0-9]{6}T[0-9]{6}Z\.dump\.age$' | sort -r | tail -n +"$((keep + 1))" | while IFS= read -r f; do
    printf '%s/%s\n' "$dir" "$f"
  done
}
