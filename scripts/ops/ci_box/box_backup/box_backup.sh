#!/bin/bash
# box_backup.sh: restic backup of the box's OWN data (lane state, config templates, phone-stack config, status
# markers) to the data disk, plus an optional off-box copy. User level (mahanfilms), no root, no secrets.
#
#   box_backup.sh [--dry-run]   default: print what would be backed up (paths, sizes, secret-scan result), change nothing
#   box_backup.sh --apply       run the backup, retention, check, off-box copy and write the freshness marker
#   box_backup.sh --status      read-only report (marker, snapshot count, repo size)
#
# Configuration: ~/.config/roxira-box-backup/backup.conf (see box-backup.conf.example). Secrets live ONLY in
# mode-600 files outside the repo: restic.pass (repo password) and offbox.env (S3/B2 credentials).
# Not configured yet (no password file, repo dir missing, restic missing): a clear message and exit 0, marker SKIP.
# The root-level restic job from 06_root_reliability.sh (/etc, root-owned files) is separate and untouched.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=box_backup_lib.sh
. "$HERE/box_backup_lib.sh"

MODE=dry
for a in "$@"; do
  case "$a" in
    --apply) MODE=apply ;;
    --dry-run) MODE=dry ;;
    --status) MODE=status ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "usage: $0 [--dry-run|--apply|--status]" >&2; exit 2 ;;
  esac
done
load_conf
TAG=box-user
KEEP=(--keep-daily 7 --keep-weekly 4 --keep-monthly 6)
SCAN="$HERE/secret_scan.py"

rp() { restic -r "$REPOSITORY" --password-file "$PASSWORD_FILE" "$@"; }
ro() { restic -r "$OFFBOX_REPOSITORY" --password-file "$OFFBOX_PASSWORD_FILE" "$@"; }

skip() { # reason, fix-hint
  say "SKIP: $1"
  [ -z "${2:-}" ] || say "  fix: $2"
  [ "$MODE" = apply ] && write_marker SKIP "$1"
  exit 0
}

# ------------------------------------------------------------------ status
if [ "$MODE" = status ]; then
  say "last run:      $(cat "$STATE/backup.last" 2>/dev/null || echo never)"
  say "off-box:       $(cat "$STATE/backup.offbox.last" 2>/dev/null || echo 'not configured / never')"
  say "last drill:    $(cat "$STATE/backup-drill.last" 2>/dev/null || echo never)"
  say "repository:    $REPOSITORY"
  if command -v restic >/dev/null && secret_file_ok "$PASSWORD_FILE" && [ -f "$REPOSITORY/config" ]; then
    say "snapshots:     $(rp snapshots --tag "$TAG" --compact 2>/dev/null | tail -1)"
    say "repo size:     $(du -sh "$REPOSITORY" 2>/dev/null | cut -f1)"
  fi
  exit 0
fi

# ------------------------------------------------------------------ file list + secret scan (read-only)
TMPL="$(mktemp -d "${TMPDIR:-/tmp}/box-backup.XXXXXX")"
trap 'rm -rf "$TMPL"' EXIT
list_files | sort -z -u > "$TMPL/all.lst"
python3 -I "$SCAN" < "$TMPL/all.lst" > "$TMPL/clean.lst" 2> "$TMPL/scan.err" || true
n_all=$(tr -cd '\0' < "$TMPL/all.lst" | wc -c)
n_clean=$(tr -cd '\0' < "$TMPL/clean.lst" | wc -c)
n_drop=$((n_all - n_clean))
bytes=$(xargs -0 -r stat -c '%s' < "$TMPL/clean.lst" 2>/dev/null | awk '{s+=$1} END{print s+0}')
[ -n "$bytes" ] || bytes=0

if [ "$MODE" = dry ]; then
  say "== box_backup dry-run (nothing written). Use --apply to run."
  say "config file:   $CFG_FILE $( [ -f "$CFG_FILE" ] && echo '(present)' || echo '(absent: defaults)')"
  say "repository:    $REPOSITORY"
  say "password file: $PASSWORD_FILE $(secret_file_ok "$PASSWORD_FILE" && echo '(ok, mode 600, contents never shown)' || echo '(MISSING or not mode 600)')"
  say "off-box:       ${OFFBOX_REPOSITORY:-none configured}"
  say "restic:        $(command -v restic >/dev/null && restic version | head -1 || echo 'MISSING (owner: sudo apt install restic)')"
  say "files:         $n_clean selected, $n_drop dropped by the secret scan, ~$bytes bytes"
  say "-- selected paths (top-level directories and files):"
  xargs -0 -r -n1 < "$TMPL/clean.lst" | sed -e "s#^$HOME#~#" | awk -F/ '{ if (NF>4) print $1"/"$2"/"$3"/"$4"/"$5; else print $0 }' | sort | uniq -c | sort -rn | head -40
  [ ! -s "$TMPL/scan.err" ] || { say "-- secret scan dropped (names only):"; sed 's/^/   /' "$TMPL/scan.err"; }
  say "-- would run:"
  say "   stage taskq.db (sqlite online backup) + MANIFEST.sha256 into $WORK/stage"
  say "   restic -r $REPOSITORY backup --tag $TAG --files-from-raw <list>"
  say "   restic forget --tag $TAG --group-by host,tags ${KEEP[*]} --prune ; restic check (+2% data on Sundays)"
  [ -z "$OFFBOX_REPOSITORY" ] || say "   restic copy -> $OFFBOX_REPOSITORY (init with --copy-chunker-params when new), forget --prune there too"
  say "   marker: $STATE/backup.last"
  exit 0
fi

# ------------------------------------------------------------------ apply: preconditions (no-op when not configured)
command -v restic >/dev/null || skip "restic is not installed" "sudo apt install restic"
secret_file_ok "$PASSWORD_FILE" || skip "restic password file missing, empty or not mode 600: $PASSWORD_FILE" \
  "umask 077; mkdir -p $(dirname "$PASSWORD_FILE"); head -c 32 /dev/urandom | base64 | tr -d '\\n=' > $PASSWORD_FILE   # then copy it into your password manager"
if ! is_remote "$REPOSITORY"; then
  if [ ! -d "$REPOSITORY" ]; then
    if mkdir -p "$REPOSITORY" 2>/dev/null; then chmod 700 "$REPOSITORY"
    else skip "repository directory $REPOSITORY does not exist and cannot be created" \
      "sudo install -d -o $(id -un) -g $(id -gn) -m 700 $REPOSITORY"; fi
  fi
  [ -w "$REPOSITORY" ] || skip "repository directory $REPOSITORY is not writable" "sudo chown $(id -un) $REPOSITORY"
fi
grep -q ' /srv/data ' /proc/mounts 2>/dev/null || case "$REPOSITORY" in /srv/data/*) skip "/srv/data is not mounted" "mount the data disk" ;; esac

mkdir -p "$STATE" "$WORK"
exec 9> "$WORK/backup.lock"
flock -n 9 || { say "another backup run holds the lock, exiting"; exit 0; }
LOG="$STATE/backup.log"
fail() { say "FAIL: $*" | tee -a "$LOG" >&2; write_marker FAIL "$*"; exit 1; }
trap 'rm -rf "$TMPL"' EXIT

# ------------------------------------------------------------------ stage: consistent sqlite copy + manifest
STAGE="$WORK/stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"
DB="$HOME/.roxira-agents/taskq.db"
if [ -f "$DB" ]; then
  python3 -I - "$DB" "$STAGE/taskq.db" <<'PY' || fail "sqlite backup of taskq.db"
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
assert dst.execute("pragma integrity_check").fetchone()[0] == "ok"
PY
  printf '%s\0' "$STAGE/taskq.db" >> "$TMPL/clean.lst"
fi
xargs -0 -r sha256sum < "$TMPL/clean.lst" > "$STAGE/MANIFEST.sha256" || fail "manifest"
printf '%s\0' "$STAGE/MANIFEST.sha256" >> "$TMPL/clean.lst"
cp "$TMPL/scan.err" "$STAGE/SCAN_DROPPED.txt" 2>/dev/null || true
printf '%s\0' "$STAGE/SCAN_DROPPED.txt" >> "$TMPL/clean.lst"

# ------------------------------------------------------------------ backup + retention + check
rp cat config >/dev/null 2>&1 || { say "initialising repository $REPOSITORY"; rp init >/dev/null || fail "restic init"; }
say "$(stamp) backup start: $n_clean files, $n_drop dropped by secret scan" | tee -a "$LOG"
rp backup --tag "$TAG" --files-from-raw "$TMPL/clean.lst" -q >>"$LOG" 2>&1 || fail "restic backup (see $LOG)"
rp forget --tag "$TAG" --group-by host,tags "${KEEP[@]}" --prune -q >>"$LOG" 2>&1 || fail "restic forget/prune"
rp check -q >>"$LOG" 2>&1 || fail "restic check"
[ "$(date +%u)" != 7 ] || rp check --read-data-subset=2% -q >>"$LOG" 2>&1 || fail "restic check --read-data-subset"
snaps=$(rp snapshots --tag "$TAG" --json | python3 -I -c 'import json,sys; print(len(json.load(sys.stdin)))')
repo_size=$(du -sk "$REPOSITORY" 2>/dev/null | cut -f1 || echo 0)
write_marker OK "snapshots=$snaps files=$n_clean skipped=$n_drop"
printf '{"status":"OK","time":"%s","snapshots":%s,"files":%s,"skipped_by_secret_scan":%s,"repo_kib":%s}\n' \
  "$(stamp)" "$snaps" "$n_clean" "$n_drop" "${repo_size:-0}" > "$STATE/backup.status.json"
say "$(stamp) OK snapshots=$snaps files=$n_clean skipped=$n_drop" | tee -a "$LOG"
[ "$n_drop" = 0 ] || say "WARN: $n_drop file(s) were dropped by the secret scan, see $STAGE/SCAN_DROPPED.txt (names only)" | tee -a "$LOG"

# ------------------------------------------------------------------ off-box copy (second repo; failure fails the unit)
if [ -z "$OFFBOX_REPOSITORY" ]; then
  echo "OFF $(stamp) no off-box repository configured" > "$STATE/backup.offbox.last"
  exit 0
fi
offfail() { say "FAIL off-box: $*" | tee -a "$LOG" >&2; echo "FAIL $(stamp) $*" > "$STATE/backup.offbox.last"; exit 1; }
secret_file_ok "$OFFBOX_PASSWORD_FILE" || offfail "off-box password file missing or not mode 600"
if is_remote "$OFFBOX_REPOSITORY"; then
  load_offbox_env 2>"$TMPL/envmsg" || offfail "$(cat "$TMPL/envmsg")"
else
  # Second local disk: the directory must already exist (created by the owner on the mounted disk, so an
  # unmounted disk is never silently replaced by a folder on the root disk) and sit on another filesystem.
  [ -d "$OFFBOX_REPOSITORY" ] && [ -w "$OFFBOX_REPOSITORY" ] || offfail "$OFFBOX_REPOSITORY is missing or not writable (second disk mounted?)"
  [ "$(stat -c %d "$OFFBOX_REPOSITORY")" != "$(stat -c %d "$REPOSITORY")" ] || offfail "$OFFBOX_REPOSITORY is on the same filesystem as the primary repository, so it is not an off-box copy"
fi
ro cat config >/dev/null 2>&1 || {
  say "initialising off-box repository" | tee -a "$LOG"
  ro init --from-repo "$REPOSITORY" --from-password-file "$PASSWORD_FILE" --copy-chunker-params >>"$LOG" 2>&1 || offfail "init"
}
ro copy --from-repo "$REPOSITORY" --from-password-file "$PASSWORD_FILE" --tag "$TAG" -q >>"$LOG" 2>&1 || offfail "restic copy"
ro forget --tag "$TAG" --group-by host,tags "${KEEP[@]}" --prune -q >>"$LOG" 2>&1 || offfail "forget/prune"
ro check -q >>"$LOG" 2>&1 || offfail "check"
echo "OK $(stamp) snapshots=$(ro snapshots --tag "$TAG" --json | python3 -I -c 'import json,sys; print(len(json.load(sys.stdin)))')" > "$STATE/backup.offbox.last"
say "$(stamp) off-box OK" | tee -a "$LOG"
