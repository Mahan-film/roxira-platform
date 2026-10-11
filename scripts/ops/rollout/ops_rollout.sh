#!/usr/bin/env bash
# One-shot ops rollout, run ON THE SERVER as root from the repo checkout.
# Dry-run by default (prints what it would do); add --apply to execute. Every step is idempotent,
# never prints secret values, and never bulk-deletes.
#
#   ops_rollout.sh <subcommand> [--apply] [age1...recipient]
#
#   install-tools    apt install restic age jq (only the missing ones)
#   setup-notify     write /etc/roxira/backup.env + monitor.env (600) from the SMTP lines of the repo .env;
#                    pass the age PUBLIC key (age1...) as an argument
#   install-backup   install backup systemd units, enable timers, run one backup, show the status file
#   install-monitor  install roxira-monitor-* units, enable timers, synthetic_check --once (dry, then real)
#   test-mail        send one test email via scripts/ops/backup/notify_email.py
#   prep-nginx       snakeoil cert + nginx/generated + backend mounts (needs the files from PR #527)
#   status           timers, last backup status, disk, last monitor result
set -euo pipefail

ROOT="${ROXIRA_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
ENV_SRC="${ROXIRA_ENV_FILE:-$ROOT/.env}"
ETC="${ROXIRA_ETC_DIR:-/etc/roxira}"
UNIT_DIR="${ROXIRA_UNIT_DIR:-/etc/systemd/system}"
STATE_BACKUP="${BACKUP_STATE_DIR:-/var/lib/roxira-backup}"
STATE_MONITOR="${MONITOR_STATE_DIR:-/var/lib/roxira-monitor}"
APPLY=0
SUB=""
AGE_ARG=""

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# act <cmd...>: run it, or only print it in dry-run
act() { if [ "$APPLY" = 1 ]; then "$@"; else printf '[dry-run] %s\n' "$*"; fi; }

for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    age1*) AGE_ARG="$a" ;;
    install-tools|setup-notify|install-backup|install-monitor|test-mail|prep-nginx|status) SUB="$a" ;;
    *) die "unknown argument: $a (see --help)" ;;
  esac
done
[ -n "$SUB" ] || die "subcommand required (see --help)"
if [ "$APPLY" = 1 ] && [ "$(id -u)" -ne 0 ] && [ -z "${ROXIRA_ALLOW_NONROOT:-}" ]; then die "--apply must run as root"; fi
[ "$APPLY" = 1 ] || say "[rollout] DRY RUN for '$SUB' (use --apply to execute)"

# install_file <mode> <src> <dst>: copy only when content differs
install_file() {
  if [ -f "$3" ] && cmp -s "$2" "$3"; then say "  unchanged: $3"; return 0; fi
  act install -m "$1" "$2" "$3"
}

sub_install_tools() {
  local missing=() t
  for t in restic age jq; do command -v "$t" >/dev/null 2>&1 || missing+=("$t"); done
  if [ "${#missing[@]}" -eq 0 ]; then say "restic, age, jq already installed"; return 0; fi
  say "missing: ${missing[*]}"
  act apt-get update -qq
  act apt-get install -y "${missing[@]}"
}

# merge_env <file> <newlines-file> <keys...>: keep existing lines whose key is not managed, then append new lines
merge_env() {
  local file="$1" new="$2" out pat
  shift 2
  pat="^($(IFS='|'; echo "$*"))="
  out="$(mktemp "${TMPDIR:-/tmp}/rollout.XXXXXX")"
  { [ -f "$file" ] && grep -Ev "$pat" "$file" || true; cat "$new"; } >"$out"
  if [ -f "$file" ] && cmp -s "$out" "$file"; then say "  unchanged: $file"; rm -f "$out"; return 0; fi
  if [ "$APPLY" = 1 ]; then
    [ -f "$file" ] && cp -p "$file" "$file.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    install -m 600 "$out" "$file"
    say "  wrote: $file (mode 600)"
  else
    say "[dry-run] would write $file (mode 600), $(wc -l <"$out") lines"
  fi
  rm -f "$out"
}

sub_setup_notify() {
  [ -r "$ENV_SRC" ] || die "cannot read $ENV_SRC"
  local smtp age="" key n bk mon pw
  smtp="$(mktemp "${TMPDIR:-/tmp}/rollout.XXXXXX")"; bk="$(mktemp "${TMPDIR:-/tmp}/rollout.XXXXXX")"; mon="$(mktemp "${TMPDIR:-/tmp}/rollout.XXXXXX")"
  chmod 600 "$smtp" "$bk" "$mon"
  for key in BACKUP_SMTP_USER BACKUP_SMTP_PASS BACKUP_NOTIFY_TO; do
    n="$(grep -c "^${key}=" "$ENV_SRC" || true)"
    [ "$n" = 1 ] || die "$key must appear exactly once in $ENV_SRC (found $n)"
    if [ "$key" = BACKUP_SMTP_PASS ]; then
      # Gmail shows App Passwords with spaces; an unquoted space breaks `. file` sourcing, so store it compact.
      pw="$(grep "^${key}=" "$ENV_SRC" | cut -d= -f2-)"
      pw="${pw#[\"\']}"; pw="${pw%[\"\']}"
      pw="$(printf '%s' "$pw" | tr -d '[:space:]')"
      if [[ "$pw" =~ ^[A-Za-z0-9]+$ ]]; then printf '%s=%s\n' "$key" "$pw" >>"$smtp"; else printf "%s='%s'\n" "$key" "${pw//\'/}" >>"$smtp"; fi
      say "BACKUP_SMTP_PASS length after removing spaces: ${#pw}"
    else
      grep "^${key}=" "$ENV_SRC" >>"$smtp"
    fi
  done
  say "found BACKUP_SMTP_USER, BACKUP_SMTP_PASS, BACKUP_NOTIFY_TO in $ENV_SRC (values not shown)"
  if [ -n "$AGE_ARG" ]; then
    [[ "$AGE_ARG" =~ ^age1[0-9a-z]{50,}$ ]] || die "argument is not an age public key (age1...)"
    age="$AGE_ARG"
  elif [ -r "$ETC/backup.env" ] && grep -q '^BACKUP_AGE_RECIPIENT=.' "$ETC/backup.env"; then
    say "no age key argument; keeping the BACKUP_AGE_RECIPIENT already in $ETC/backup.env"
  else
    say "WARNING: no age1... public key given; the weekly config bundle will be skipped until you re-run with it"
  fi
  act install -d -m 700 "$ETC"
  { cat "$smtp"; echo "BACKUP_ALLOW_LOCAL_ONLY=1"; echo "RESTIC_PASSWORD_FILE=$ETC/restic.pass"
    [ -z "$age" ] || echo "BACKUP_AGE_RECIPIENT=$age"; } >"$bk"
  cat "$smtp" >"$mon"
  local keys=(BACKUP_SMTP_USER BACKUP_SMTP_PASS BACKUP_NOTIFY_TO BACKUP_ALLOW_LOCAL_ONLY RESTIC_PASSWORD_FILE)
  [ -z "$age" ] || keys+=(BACKUP_AGE_RECIPIENT)
  merge_env "$ETC/backup.env" "$bk" "${keys[@]}"
  merge_env "$ETC/monitor.env" "$mon" BACKUP_SMTP_USER BACKUP_SMTP_PASS BACKUP_NOTIFY_TO
  rm -f "$smtp" "$bk" "$mon"
}

enable_units() { # <glob prefix> <timer names...>
  local f
  for f in "$@"; do
    [ -f "$ROOT/deploy/systemd/$f" ] || die "missing unit $ROOT/deploy/systemd/$f"
  done
  for f in "$@"; do install_file 644 "$ROOT/deploy/systemd/$f" "$UNIT_DIR/$f"; done
  act systemctl daemon-reload
  for f in "$@"; do
    case "$f" in *.timer) act systemctl enable --now "$f" ;; esac
  done
}

sub_install_backup() {
  [ -r "$ETC/backup.env" ] || [ "$APPLY" = 0 ] || die "$ETC/backup.env missing: run setup-notify first"
  command -v jq >/dev/null || [ "$APPLY" = 0 ] || die "jq missing: run install-tools first"
  local units=()
  for f in "$ROOT"/deploy/systemd/roxira-backup-dr-*.service "$ROOT"/deploy/systemd/roxira-backup-dr-*.timer; do
    units+=("$(basename "$f")")
  done
  enable_units "${units[@]}"
  act chmod +x "$ROOT"/scripts/ops/backup/*.sh
  if [ "$APPLY" = 1 ]; then
    say "running one backup now"
    "$ROOT/scripts/ops/backup/server_backup.sh" run || say "backup run exited non-zero (see status below)"
    say "--- $STATE_BACKUP/status.env"
    cat "$STATE_BACKUP/status.env" 2>/dev/null || say "(no status file)"
  else
    say "[dry-run] would run: server_backup.sh run, then print $STATE_BACKUP/status.env"
    "$ROOT/scripts/ops/backup/server_backup.sh" --dry-run run 2>&1 | sed -n '1,12p' || true
  fi
}

sub_install_monitor() {
  local units=() f
  for f in "$ROOT"/deploy/systemd/roxira-monitor-*; do [ -e "$f" ] && units+=("$(basename "$f")"); done
  if [ "${#units[@]}" -eq 0 ] || [ ! -f "$ROOT/scripts/ops/monitor/synthetic_check.py" ]; then
    say "skip: monitoring files (PR #531) are not in this checkout; git pull first"; return 0
  fi
  [ -r "$ETC/monitor.env" ] || [ "$APPLY" = 0 ] || die "$ETC/monitor.env missing: run setup-notify first"
  enable_units "${units[@]}"
  if [ "$APPLY" = 1 ]; then
    say "synthetic check: dry run, then real run"
    ( set -a; . "$ETC/monitor.env"; set +a
      python3 "$ROOT/scripts/ops/monitor/synthetic_check.py" --once --dry-run || true
      python3 "$ROOT/scripts/ops/monitor/synthetic_check.py" --once || true )
  else
    say "[dry-run] would run synthetic_check.py --once --dry-run, then --once (env from $ETC/monitor.env)"
  fi
}

sub_test_mail() {
  local body rc=0
  body="$(mktemp "${TMPDIR:-/tmp}/rollout.XXXXXX")"
  printf 'Roxira test email from %s at %s.\nIf you can read this, backup/monitor mail works.\n' "$(hostname)" "$(date -u)" >"$body"
  if [ "$APPLY" = 0 ]; then
    say "[dry-run] would send one test email using $ETC/backup.env"
    ( set -a; [ -r "$ETC/backup.env" ] && . "$ETC/backup.env"; set +a
      python3 "$ROOT/scripts/ops/backup/notify_email.py" --subject "[roxira] test mail" --body-file "$body" --dry-run ) || true
    rm -f "$body"; return 0
  fi
  [ -r "$ETC/backup.env" ] || die "$ETC/backup.env missing: run setup-notify first"
  ( set -a; . "$ETC/backup.env"; set +a
    python3 "$ROOT/scripts/ops/backup/notify_email.py" --subject "[roxira] test mail" --body-file "$body" ) || rc=$?
  rm -f "$body"
  case "$rc" in
    0) say "test mail sent: check the inbox" ;;
    3) say "mail not configured: BACKUP_SMTP_USER / BACKUP_SMTP_PASS / BACKUP_NOTIFY_TO missing. Run setup-notify." ;;
    4) say "HINT: SMTP authentication failed. Check the 16-char App Password and that 2-Step Verification is on."
       say "راهنما: رمز برنامه (App Password) ۱۶ کاراکتری را بررسی کنید و مطمئن شوید تأیید دومرحله‌ای (2-Step Verification) فعال است."
       return 1 ;;
    *) say "test mail failed (exit $rc); see the error above"; return 1 ;;
  esac
}

sub_prep_nginx() {
  local g="$ROOT/scripts/ops/nginx/gen_snakeoil_cert.sh" p="$ROOT/scripts/ops/prep_backend_mounts.sh"
  if [ ! -f "$g" ] || [ ! -f "$p" ]; then say "skip: #527 not merged yet"; return 0; fi
  if [ "$APPLY" = 1 ]; then
    bash "$g"
    mkdir -p "$ROOT/nginx/generated"
    [ -e "$ROOT/nginx/generated/.keep.conf" ] || : >"$ROOT/nginx/generated/.keep.conf"
    bash "$p" --apply
  else
    say "[dry-run] bash $g"
    say "[dry-run] mkdir -p $ROOT/nginx/generated && placeholder .keep.conf"
    bash "$p" 2>&1 | sed -n '1,15p' || true
  fi
}

sub_status() {
  say "--- timers"; systemctl list-timers --no-pager 2>/dev/null | grep -E 'NEXT|roxira' || say "(no roxira timers)"
  say "--- last backup ($STATE_BACKUP/status.env)"
  grep -E '^(LAST_RESULT|LAST_OK|LAST_RUN_END|BACKUP_MODE|DISK_PCT|STAGE_BYTES|LAST_ERROR|WARNINGS)=' "$STATE_BACKUP/status.env" 2>/dev/null || say "(none)"
  say "--- local sets"; ls -1 /opt/roxira_backups/dr/sets 2>/dev/null | tail -5 || true
  say "--- disk"; df -h / /opt 2>/dev/null | sort -u
  say "--- last monitor result ($STATE_MONITOR)"
  if [ -d "$STATE_MONITOR" ]; then ls -l --time-style=long-iso "$STATE_MONITOR" 2>/dev/null | tail -n +2; else say "(none)"; fi
  journalctl -u roxira-monitor-synthetic.service -n 3 --no-pager 2>/dev/null | cut -c1-200 || true
}

case "$SUB" in
  install-tools) sub_install_tools ;;
  setup-notify) sub_setup_notify ;;
  install-backup) sub_install_backup ;;
  install-monitor) sub_install_monitor ;;
  test-mail) sub_test_mail ;;
  prep-nginx) sub_prep_nginx ;;
  status) sub_status ;;
esac
