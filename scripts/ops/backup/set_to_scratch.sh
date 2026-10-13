#!/usr/bin/env bash
# Adapter: turn a LOCAL backup set (server_backup.sh, BACKUP_ALLOW_LOCAL_ONLY mode) into the scratch layout that
# restore.sh steps 3-7 read after a restic restore:
#   <scratch>/<fs paths from configs.tar.gz>     e.g. <scratch>/opt/roxira_platform/.env, <scratch>/etc/cron.d
#   <scratch><STAGE_REL> -> <set dir>            symlink; gives <stage>/pg, qdrant, redis, volumes, meta
# Only writes inside <scratch>; the set directory is never modified.
#
# Usage: set_to_scratch.sh [--dry-run] SETDIR SCRATCH [STAGE_REL]
#   STAGE_REL defaults to ${BACKUP_LOCAL_DIR:-/opt/roxira_backups/dr}/stage (same as restore.sh).
#--end-help--
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,/^#--end-help--$/{/^#--end-help--$/d;p;}' "$0"; exit 0 ;;
    *) args+=("$1"); shift ;;
  esac
done
[ "${#args[@]}" -ge 2 ] && [ "${#args[@]}" -le 3 ] || die "usage: set_to_scratch.sh [--dry-run] SETDIR SCRATCH [STAGE_REL]"
SETDIR="${args[0]}"
SCRATCH="${args[1]}"
STAGE_REL="${args[2]:-${BACKUP_LOCAL_DIR:-/opt/roxira_backups/dr}/stage}"

case "$SCRATCH" in ''|/|/etc|/opt|/var|/root|/usr) die "refusing unsafe scratch dir '$SCRATCH'" ;; esac
case "$STAGE_REL" in /*) ;; *) die "STAGE_REL must be absolute (got '$STAGE_REL')" ;; esac
[ -d "$SETDIR" ] || die "set dir $SETDIR not found"
REAL_SET="$(cd "$SETDIR" && pwd -P)"
TARBALL="$REAL_SET/configs/configs.tar.gz"

[ -s "$TARBALL" ] || die "$TARBALL missing or empty: not a complete local set"
[ -d "$REAL_SET/pg" ] || [ -d "$REAL_SET/qdrant" ] || die "set has neither pg/ nor qdrant/: refusing"

log "set: $REAL_SET (backup_time: $(head -1 "$REAL_SET/meta/backup_time.txt" 2>/dev/null || echo unknown); repo_head: $(head -c 12 "$REAL_SET/meta/repo_head.txt" 2>/dev/null || echo unknown))"
log "contents: pg dumps $(find "$REAL_SET/pg" -name '*.dump' 2>/dev/null | wc -l | tr -d ' '), qdrant snapshots $(find "$REAL_SET/qdrant" -name '*.snapshot' 2>/dev/null | wc -l | tr -d ' '), redis $([ -s "$REAL_SET/redis/dump.rdb" ] && echo yes || echo no)"

# Refuse tarballs with parent-directory traversal (the real one is made by server_backup.sh, but be strict anyway).
LISTING="$(tar -tzf "$TARBALL")" || die "cannot read $TARBALL"
if printf '%s\n' "$LISTING" | grep -Eq '(^|/)\.\.(/|$)'; then die "configs.tar.gz contains '..' paths; refusing to extract"; fi

if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] mkdir -p $SCRATCH (mode 700)"
  echo "[dry-run] tar -xzf $TARBALL -C $SCRATCH   ($(printf '%s\n' "$LISTING" | wc -l | tr -d ' ') entries; top level: $(printf '%s\n' "$LISTING" | cut -d/ -f1-2 | sort -u | tr '\n' ' '))"
  echo "[dry-run] ln -sfn $REAL_SET $SCRATCH$STAGE_REL"
  exit 0
fi

mkdir -p "$SCRATCH"
chmod 700 "$SCRATCH"
tar -xzf "$TARBALL" -C "$SCRATCH"
mkdir -p "$(dirname "$SCRATCH$STAGE_REL")"
if [ -e "$SCRATCH$STAGE_REL" ] && [ ! -L "$SCRATCH$STAGE_REL" ]; then
  die "$SCRATCH$STAGE_REL exists and is not a symlink; use a fresh scratch dir"
fi
ln -sfn "$REAL_SET" "$SCRATCH$STAGE_REL"
log "scratch ready: configs extracted into $SCRATCH, stage -> $SCRATCH$STAGE_REL"
