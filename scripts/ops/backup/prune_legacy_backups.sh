#!/usr/bin/env bash
# One-time cleanup of the LEGACY hourly backups written by scripts/auto_backup_daemon.sh:
#   /opt/roxira_backups/postgres_YYYYMMDD_HHMMSS.sql.gz   (keep newest 24)
#   /opt/roxira_backups/qdrant_YYYYMMDD_HHMMSS.tar.gz     (keep newest 2)
#
# AGENTS.md section 6: read-only dry-run by default (exact counts, bytes, oldest/newest), then --apply,
# which needs the file count typed on /dev/tty. Deletes one validated regular file at a time with
# `rm -f --`; never recurses, never touches subdirectories (so never /opt/roxira_backups/dr).
#
# Usage: prune_legacy_backups.sh [--dry-run] [--apply] [--dir DIR] [--keep-pg N] [--keep-qdrant N]
#                                [--skip-dr-check]
# Test hooks (env): ROXIRA_PRUNE_TTY (default /dev/tty), ROXIRA_DR_STATUS_FILE.
set -euo pipefail

DIR="/opt/roxira_backups"
KEEP_PG=24
KEEP_QDRANT=2
APPLY=0
SKIP_DR_CHECK=0
TTY="${ROXIRA_PRUNE_TTY:-/dev/tty}"
DR_STATUS="${ROXIRA_DR_STATUS_FILE:-/var/lib/roxira-backup/status.env}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
is_uint() { [[ "$1" =~ ^[0-9]+$ ]]; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --skip-dr-check) SKIP_DR_CHECK=1 ;;
    --dir) DIR="${2:?--dir needs a path}"; shift ;;
    --keep-pg) KEEP_PG="${2:?}"; shift ;;
    --keep-qdrant) KEEP_QDRANT="${2:?}"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
if ! is_uint "$KEEP_PG" || ! is_uint "$KEEP_QDRANT"; then die "--keep-pg/--keep-qdrant must be integers"; fi
[ -d "$DIR" ] || die "directory not found: $DIR"
DIR="$(cd "$DIR" && pwd -P)"
case "$DIR" in
  / | */dr | */dr/*) die "refusing to operate on $DIR" ;;
esac

PG_RE='^postgres_[0-9]{8}_[0-9]{6}\.sql\.gz$'
QD_RE='^qdrant_[0-9]{8}_[0-9]{6}\.tar\.gz$'

fsize() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }
human() { awk -v b="${1:-0}" 'BEGIN{split("B KiB MiB GiB TiB",u," ");i=1;while(b>=1024&&i<5){b/=1024;i++}printf "%.1f %s",b,u[i]}'; }

# collect <regex> <glob-prefix> <glob-suffix>: sorted (oldest first) names of strictly matching regular files
collect() {
  local re="$1" pre="$2" suf="$3" f b
  for f in "$DIR"/"$pre"*"$suf"; do
    [ -e "$f" ] || continue
    b="$(basename "$f")"
    [[ "$b" =~ $re ]] || continue
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    printf '%s\n' "$b"
  done | LC_ALL=C sort
}

DEL=()      # files to delete (names)
DEL_BYTES=0
report() { # <label> <keep> <regex> <pre> <suf>
  local label="$1" keep="$2" all=() n total=0 i b sz
  while IFS= read -r b; do [ -n "$b" ] && all+=("$b"); done < <(collect "$3" "$4" "$5")
  n="${#all[@]}"
  for b in ${all[@]+"${all[@]}"}; do total=$((total + $(fsize "$DIR/$b"))); done
  printf '%s: %d files, %s total (keep newest %d)\n' "$label" "$n" "$(human "$total")" "$keep"
  if [ "$n" -gt 0 ]; then printf '  oldest: %s\n  newest: %s\n' "${all[0]}" "${all[$((n - 1))]}"; fi
  local ndel=$((n - keep)) dbytes=0
  [ "$ndel" -gt 0 ] || ndel=0
  for ((i = 0; i < ndel; i++)); do
    b="${all[$i]}"; sz="$(fsize "$DIR/$b")"
    DEL+=("$b"); dbytes=$((dbytes + sz))
  done
  DEL_BYTES=$((DEL_BYTES + dbytes))
  if [ "$ndel" -gt 0 ]; then
    printf '  to delete: %d files, %s (%s .. %s)\n' "$ndel" "$(human "$dbytes")" "${all[0]}" "${all[$((ndel - 1))]}"
  else
    printf '  to delete: 0 files\n'
  fi
}

echo "Directory: $DIR   (never touched: $DIR/dr and every subdirectory)"
report "postgres legacy" "$KEEP_PG" "$PG_RE" postgres_ .sql.gz
report "qdrant legacy" "$KEEP_QDRANT" "$QD_RE" qdrant_ .tar.gz
COUNT="${#DEL[@]}"
echo
printf 'TOTAL to delete: %d files, %d bytes (%s)\n' "$COUNT" "$DEL_BYTES" "$(human "$DEL_BYTES")"
echo "Revert strategy: none for deleted files; newest ${KEEP_PG} pg + ${KEEP_QDRANT} qdrant stay, the DR sets and the Mac/e-mail copies cover the rest."

if [ "$APPLY" != 1 ]; then
  echo "Dry run only. Re-run with --apply to delete."
  exit 0
fi
[ "$COUNT" -gt 0 ] || { echo "Nothing to delete."; exit 0; }

if [ "$SKIP_DR_CHECK" != 1 ]; then
  [ -r "$DR_STATUS" ] || die "DR status file $DR_STATUS not readable; the DR backup has not run (use --skip-dr-check only if you verified it)"
  grep -q "^LAST_RESULT='OK'" "$DR_STATUS" || die "DR backup LAST_RESULT is not OK in $DR_STATUS; refusing to delete legacy backups"
fi

printf 'Type the number of files to delete (%d) to confirm: ' "$COUNT" >&2
ANSWER=""
if ! IFS= read -r ANSWER <"$TTY"; then die "cannot read confirmation from $TTY"; fi
[ "$ANSWER" = "$COUNT" ] || die "confirmation '$ANSWER' does not match $COUNT; nothing deleted"

deleted=0
for b in "${DEL[@]}"; do
  if [[ "$b" =~ $PG_RE || "$b" =~ $QD_RE ]] && [ -f "$DIR/$b" ] && [ ! -L "$DIR/$b" ]; then
    rm -f -- "$DIR/$b"
    deleted=$((deleted + 1))
  fi
done
echo "Deleted $deleted files ($(human "$DEL_BYTES"))."
df -h "$DIR" | tail -1
