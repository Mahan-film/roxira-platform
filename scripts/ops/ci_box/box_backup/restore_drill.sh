#!/bin/bash
# restore_drill.sh: prove the backup can be restored. Restores the latest snapshot into a SCRATCH directory,
# verifies a random sample against the sha256 manifest written at backup time, checks the sqlite copy, deletes
# the scratch dir. Never writes outside the scratch dir, never touches live paths, never prints secrets.
#
#   restore_drill.sh [--repo primary|offbox] [--sample N] [--target DIR] [--keep]
#
#   --repo    which repository to test (default primary; offbox needs OFFBOX_REPOSITORY in backup.conf)
#   --sample  how many files to checksum (default 25; all files when fewer exist)
#   --target  scratch dir (must not exist or be empty, never / or a live path); default under ~/.local/state
#   --keep    keep the restored tree for inspection (it holds config copies: delete it afterwards)
# Exit 0 = PASS, 1 = FAIL. Writes ~/.local/state/roxira-box/backup-drill.last ("OK <ts> ..." or "FAIL <ts> ...").
# Verification is against the manifest INSIDE the snapshot, not the live files (state files drift after the backup).
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=box_backup_lib.sh
. "$HERE/box_backup_lib.sh"
load_conf

WHICH=primary SAMPLE=25 TARGET="" KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) WHICH="${2:?}"; shift 2 ;;
    --sample) SAMPLE="${2:?}"; shift 2 ;;
    --target) TARGET="${2:?}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "usage: $0 [--repo primary|offbox] [--sample N] [--target DIR] [--keep]" >&2; exit 2 ;;
  esac
done
case "$SAMPLE" in ''|*[!0-9]*) die "--sample must be a number" ;; esac

command -v restic >/dev/null || die "restic is not installed (sudo apt install restic)"
case "$WHICH" in
  primary) REPO="$REPOSITORY"; PASS="$PASSWORD_FILE"; EXTRA=() ;;
  offbox)
    [ -n "$OFFBOX_REPOSITORY" ] || die "no OFFBOX_REPOSITORY configured"
    REPO="$OFFBOX_REPOSITORY"; PASS="$OFFBOX_PASSWORD_FILE"; EXTRA=()
    if is_remote "$REPO"; then
      load_offbox_env || die "off-box credentials unavailable"
    fi ;;
  *) die "--repo must be primary or offbox" ;;
esac
secret_file_ok "$PASS" || die "password file missing or not mode 600: $PASS"

mkdir -p "$STATE" "$WORK"
[ -n "$TARGET" ] || TARGET="$WORK/drill/$(date -u +%Y%m%dT%H%M%SZ)"
case "$TARGET" in /|/etc*|/usr*|/bin*|/sbin*|/lib*|/var*|/boot*|/srv/data|"$HOME"|"$HOME/") die "refusing scratch target $TARGET" ;; esac
case "$TARGET" in /*) ;; *) die "--target must be an absolute path" ;; esac
if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then die "scratch target is not empty: $TARGET"; fi
mkdir -p "$TARGET"
cleanup() { [ "$KEEP" = 1 ] || rm -rf "$TARGET"; }
trap cleanup EXIT
fail() { say "DRILL FAIL ($WHICH): $*" >&2; printf 'FAIL %s %s\n' "$(stamp)" "$*" > "$STATE/backup-drill.last"; exit 1; }

say "restoring latest $WHICH snapshot into scratch dir $TARGET"
restic -r "$REPO" --password-file "$PASS" restore latest --tag box-user --target "$TARGET" -q || fail "restic restore"

MAN=$(find "$TARGET" -name MANIFEST.sha256 -type f | head -1)
[ -n "$MAN" ] || fail "no MANIFEST.sha256 in the snapshot"
total=$(wc -l < "$MAN")
[ "$total" -gt 0 ] || fail "manifest is empty"

ok=0 bad=0 missing=0
while IFS= read -r line; do
  sum=${line%% *}; path=${line#*  }
  f="$TARGET$path"
  if [ ! -f "$f" ]; then missing=$((missing+1)); say "  missing: $path" >&2; continue; fi
  if [ "$(sha256sum < "$f" | cut -d' ' -f1)" = "$sum" ]; then ok=$((ok+1)); else bad=$((bad+1)); say "  MISMATCH: $path" >&2; fi
done < <(shuf -n "$SAMPLE" "$MAN")

db=$(find "$TARGET" -name taskq.db -type f | head -1 || true)
if [ -n "$db" ]; then
  r=$(python3 -I -c 'import sqlite3,sys; print(sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True).execute("pragma integrity_check").fetchone()[0])' "$db") || r=error
  [ "$r" = ok ] || fail "restored taskq.db fails integrity_check"
fi
[ "$bad" = 0 ] && [ "$missing" = 0 ] || fail "sample of $((ok+bad+missing)) of $total files: $bad mismatched, $missing missing"
printf 'OK %s repo=%s sample=%s of %s\n' "$(stamp)" "$WHICH" "$ok" "$total" > "$STATE/backup-drill.last"
say "DRILL OK ($WHICH): $ok of $total manifest files verified by sha256$( [ -n "$db" ] && echo ', taskq.db integrity ok')"
[ "$KEEP" = 0 ] && say "scratch dir removed" || say "scratch dir kept: $TARGET (delete it: rm -rf '$TARGET')"
