#!/usr/bin/env bash
# Run on the Mac. Streams the newest local backup set from the OLD server to the NEW server, ssh to ssh, so the
# set (it contains .env files and DB dumps) never touches the Mac disk.
#
#   OLD:/opt/roxira_backups/dr/sets/latest  ->  NEW:/var/lib/roxira/incoming-set/<ts>/   (dir mode 700)
#
# Usage: migrate_pull_set.sh [--dry-run | --apply] [--allow-old] [--old HOST] [--new HOST]
#   default is --dry-run (read-only checks on OLD, prints the plan). Hosts default to $OLD / $NEW (env), user root.
#   Refuses a set older than 2h unless --allow-old (run server_backup.sh run on OLD first).
# Afterwards, on NEW:
#   scripts/ops/backup/restore.sh --from-set /var/lib/roxira/incoming-set/<ts> --full --dry-run
#--end-help--
set -euo pipefail
# shellcheck disable=SC2029  # variables are validated and meant to expand on the client side

MODE=dry
ALLOW_OLD=0
OLD_HOST="${OLD:-}"
NEW_HOST="${NEW:-}"
MAX_AGE_S="${MAX_SET_AGE_S:-7200}"
SETS_DIR="${OLD_SETS_DIR:-/opt/roxira_backups/dr/sets}"
INCOMING="${NEW_INCOMING_DIR:-/var/lib/roxira/incoming-set}"
SSH_OPTS=(-o BatchMode=yes)

die() { echo "ERROR: $*" >&2; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) MODE=dry; shift ;;
    --apply) MODE=apply; shift ;;
    --allow-old) ALLOW_OLD=1; shift ;;
    --old) OLD_HOST="${2:?}"; shift 2 ;;
    --new) NEW_HOST="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,/^#--end-help--$/{/^#--end-help--$/d;p;}' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$OLD_HOST" ] || die "OLD host not set (export OLD=... or --old)"
[ -n "$NEW_HOST" ] || die "NEW host not set (export NEW=... or --new)"
[[ "$OLD_HOST" =~ ^[A-Za-z0-9._-]+$ ]] && [[ "$NEW_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "host names may only contain [A-Za-z0-9._-]"

# Resolve the set on OLD: timestamp directory name + age in seconds (read-only).
info="$(ssh "${SSH_OPTS[@]}" "root@$OLD_HOST" "d=\$(readlink -f '$SETS_DIR/latest') && [ -d \"\$d\" ] && printf '%s %s\n' \"\$(basename \"\$d\")\" \"\$(( \$(date +%s) - \$(stat -c %Y \"\$d/meta/backup_time.txt\") ))\"")" \
  || die "cannot resolve $SETS_DIR/latest on $OLD_HOST (is a set present?)"
read -r TS AGE <<<"$info"
[[ "$TS" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || die "unexpected set name '$TS'"
[[ "$AGE" =~ ^[0-9]+$ ]] || die "unexpected age '$AGE'"
echo "set $TS on $OLD_HOST, age ${AGE}s (limit ${MAX_AGE_S}s)"
if [ "$AGE" -gt "$MAX_AGE_S" ] && [ "$ALLOW_OLD" != 1 ]; then
  die "set is older than $((MAX_AGE_S / 3600))h; take a fresh one on OLD (server_backup.sh run) or pass --allow-old"
fi

DEST="$INCOMING/$TS"
echo "plan: ssh root@$OLD_HOST tar -C $SETS_DIR/$TS -cf - .  |  ssh root@$NEW_HOST tar -C $DEST -xf -   (dest mode 700)"
if [ "$MODE" != apply ]; then
  echo "[dry-run] nothing transferred. Re-run with --apply."
  exit 0
fi

ssh "${SSH_OPTS[@]}" "root@$NEW_HOST" "umask 077 && mkdir -p '$INCOMING' && chmod 700 '$INCOMING' && mkdir '$DEST'" \
  || die "cannot create $DEST on $NEW_HOST (already exists? remove it there by hand if it is a failed attempt)"
ssh "${SSH_OPTS[@]}" "root@$OLD_HOST" "tar -C '$SETS_DIR/$TS' -cf - ." \
  | ssh "${SSH_OPTS[@]}" "root@$NEW_HOST" "umask 077 && tar -C '$DEST' -xf -"
ssh "${SSH_OPTS[@]}" "root@$NEW_HOST" "chmod 700 '$DEST' && du -sh '$DEST' && ls '$DEST'"
echo "done. On NEW: scripts/ops/backup/restore.sh --from-set $DEST --full --dry-run"
