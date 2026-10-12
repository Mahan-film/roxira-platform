#!/usr/bin/env bash
# shellcheck shell=bash
# Shared helpers for the Roxira backup / restore scripts. Source it, do not run it.
# Secrets are never defined here: everything comes from the environment file
# (default /etc/roxira/backup.env, mode 0600, root only) and the restic password file.

DRY_RUN="${DRY_RUN:-0}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/roxira/backup.env}"

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
warn() { log "WARN: $*"; }
die() { log "ERROR: $*"; exit 1; }

# run <cmd...>: execute, or only print under --dry-run.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

# step <text>: announce a numbered phase (also printed in dry-run).
step() { printf '\n=== %s ===\n' "$*" >&2; }

# load_env: source the env file when present (names only live there).
load_env() {
  if [ -r "$BACKUP_ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$BACKUP_ENV_FILE"
    set +a
  elif [ "$DRY_RUN" = "1" ]; then
    warn "env file $BACKUP_ENV_FILE not readable (ok for --dry-run)"
  else
    die "env file $BACKUP_ENV_FILE not readable; copy deploy/backup/backup.env.example there (chmod 600)"
  fi
  export RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/etc/roxira/restic.pass}"
}

# configured_repos: print the names of the configured restic repositories.
# "sftp" = Hetzner Storage Box (primary offsite), "s3" = optional S3-compatible.
configured_repos() {
  if [ -n "${BACKUP_SB_USER:-}" ] && [ -n "${BACKUP_SB_HOST:-}" ]; then echo sftp; fi
  if [ -n "${BACKUP_S3_ENDPOINT:-}" ] && [ -n "${BACKUP_S3_BUCKET:-}" ]; then echo s3; fi
  if [ -n "${BACKUP_LOCAL_REPO:-}" ]; then echo local; fi
}

# restic_on <sftp|s3|local> <restic args...>: run restic against one repository.
# Credentials are exported only inside the subshell.
# shellcheck disable=SC2030,SC2031
restic_on() {
  local which="$1"
  shift
  case "$which" in
    sftp)
      (
        export RESTIC_REPOSITORY="sftp:${BACKUP_SB_USER}@${BACKUP_SB_HOST}:${BACKUP_SB_PATH:-roxira-restic}"
        exec restic \
          -o "sftp.command=ssh -p ${BACKUP_SB_PORT:-23} -i ${BACKUP_SB_KEY:-/root/.ssh/storagebox_backup} -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${BACKUP_SB_USER}@${BACKUP_SB_HOST} -s sftp" \
          "$@"
      )
      ;;
    s3)
      (
        export RESTIC_REPOSITORY="s3:${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-roxira}"
        export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID not set}"
        export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY not set}"
        exec restic "$@"
      )
      ;;
    local)
      (
        export RESTIC_REPOSITORY="${BACKUP_LOCAL_REPO}"
        exec restic "$@"
      )
      ;;
    *) die "unknown repository '$which'" ;;
  esac
}

# disk_pct <path>: integer percent used of the filesystem holding <path>.
disk_pct() {
  { df -P "$1" 2>/dev/null || true; } | awk 'NR==2 {gsub("%","",$5); print $5+0}'
}

# free_gb <path>: integer GiB available on the filesystem holding <path>.
free_gb() {
  { df -Pk "$1" 2>/dev/null || true; } | awk 'NR==2 {print int($4/1048576)}'
}

# human <bytes>
human() {
  awk -v b="${1:-0}" 'BEGIN{split("B KiB MiB GiB TiB",u," ");i=1;while(b>=1024&&i<5){b/=1024;i++}printf "%.1f %s",b,u[i]}'
}
