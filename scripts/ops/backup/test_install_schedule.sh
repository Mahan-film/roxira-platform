#!/usr/bin/env bash
# Offline test for install_schedule.sh: apply then rollback in a scratch unit dir with a fake systemctl.
# Run: bash scripts/ops/backup/test_install_schedule.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/ins.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
mkdir -p "$T/units" "$T/save"
printf '#!/bin/sh\necho "systemctl $*" >>"%s/calls"\n' "$T" >"$T/sc"; chmod +x "$T/sc"
echo "OLD-RUN-TIMER" >"$T/units/roxira-backup-dr-run.timer"
echo "OLD-TG-TIMER" >"$T/units/roxira-telegram-offsite.timer"
printf 'A=1\nBACKUP_R2_ENDPOINT=https://x\nBACKUP_R2_BUCKET=b\nBACKUP_R2_ACCESS_KEY_ID=k\nBACKUP_R2_SECRET_ACCESS_KEY=s\nBACKUP_AGE_RECIPIENT=age1x\n' >"$T/backup.env"
export BACKUP_ENV_FILE="$T/backup.env" UNIT_DIR="$T/units" SCHEDULE_SAVE_DIR="$T/save" SYSTEMCTL="$T/sc" SCHEDULE_TEST=1

bash "$HERE/install_schedule.sh" >"$T/dry.out" 2>&1
check "dry-run changes nothing" "! grep -q BACKUP_KEEP '$T/backup.env' && grep -q OLD-RUN-TIMER '$T/units/roxira-backup-dr-run.timer' && [ ! -e '$T/units/roxira-cleanup.timer' ]"

bash "$HERE/install_schedule.sh" --apply >"$T/apply.out" 2>&1
check "apply installs the daily run timer" "grep -q 'OnCalendar=\*-\*-\* 01:07:00' '$T/units/roxira-backup-dr-run.timer'"
check "apply installs the hourly pgcfg timer" "grep -q ':37:00' '$T/units/roxira-backup-dr-pgcfg.timer'"
check "apply installs the 6-hourly telegram timer" "grep -q '04/6:15:00' '$T/units/roxira-telegram-offsite.timer'"
check "apply installs the cleanup timer" "grep -q '01/2 05:40' '$T/units/roxira-cleanup.timer'"
check "apply saved the old units" "grep -rq OLD-RUN-TIMER '$T/save'"
check "apply enabled all five timers" "[ \$(grep -c 'systemctl enable' '$T/calls') = 5 ]"

check "apply writes the 2-set retention to backup.env" "grep -q 'BACKUP_KEEP_HOURLY=2' '$T/backup.env' && grep -q 'BACKUP_KEEP_DAILY=0' '$T/backup.env'"
bash "$HERE/install_schedule.sh" --apply >/dev/null 2>&1
check "a second apply does not duplicate the block" "[ \$(grep -c BACKUP_KEEP_HOURLY '$T/backup.env') = 1 ]"

bash "$HERE/install_schedule.sh" --rollback >"$T/rb.out" 2>&1
check "rollback restores the old run timer" "grep -q OLD-RUN-TIMER '$T/units/roxira-backup-dr-run.timer'"
check "rollback restores the old telegram timer" "grep -q OLD-TG-TIMER '$T/units/roxira-telegram-offsite.timer'"
check "rollback removes the retention block, keeps other lines" "! grep -q BACKUP_KEEP '$T/backup.env' && grep -q 'A=1' '$T/backup.env'"
check "rollback removes the new units" "[ ! -e '$T/units/roxira-cleanup.timer' ] && [ ! -e '$T/units/roxira-backup-dr-pgcfg.service' ]"

# --- refusals: nothing may change ---
snap() { cat "$T/units/"* "$T/backup.env" 2>/dev/null | cksum; ls "$T/save" | wc -l; }
bash "$HERE/install_schedule.sh" --apply >/dev/null 2>&1   # installed state
before="$(snap)"
cp "$T/backup.env" "$T/backup.env.good"
grep -v BACKUP_R2_ENDPOINT "$T/backup.env.good" >"$T/backup.env"
rc=0; bash "$HERE/install_schedule.sh" --apply >"$T/o1.txt" 2>&1 || rc=$?
check "apply refuses without BACKUP_R2_ENDPOINT" "[ $rc != 0 ] && grep -q 'BACKUP_R2_ENDPOINT is not set' '$T/o1.txt'"
grep -v BACKUP_AGE_RECIPIENT "$T/backup.env.good" >"$T/backup.env"
rc=0; bash "$HERE/install_schedule.sh" --apply >"$T/o1.txt" 2>&1 || rc=$?
check "apply refuses without BACKUP_AGE_RECIPIENT" "[ $rc != 0 ] && grep -q 'BACKUP_AGE_RECIPIENT is not set' '$T/o1.txt'"
mv "$T/backup.env.good" "$T/backup.env"
rc=0; BACKUP_ENV_FILE="$T/missing.env" bash "$HERE/install_schedule.sh" --apply >"$T/o1.txt" 2>&1 || rc=$?
check "apply refuses when backup.env is absent (no silent skip of retention)" "[ $rc != 0 ] && grep -q 'not readable' '$T/o1.txt'"
check "refusals changed nothing" "[ \"\$(snap)\" = \"$before\" ]"
rc=0; BACKUP_ENV_FILE="$T/missing.env" bash "$HERE/install_schedule.sh" >"$T/o1.txt" 2>&1 || rc=$?
check "dry-run also exits non-zero and says apply would refuse" "[ $rc != 0 ] && grep -q 'would refuse' '$T/o1.txt'"

# --- rollback must never remove a unit it cannot restore ---
rm -rf "$T/save"; mkdir -p "$T/save/20200101T000000Z"   # empty dir, no manifest (the old failure mode)
rc=0; bash "$HERE/install_schedule.sh" --rollback >"$T/o2.txt" 2>&1 || rc=$?
check "rollback refuses an empty save dir" "[ $rc != 0 ] && [ -e '$T/units/roxira-cleanup.timer' ] && [ -e '$T/units/roxira-backup-dr-run.timer' ]"
printf 'saved roxira-backup-dr-run.timer\nabsent roxira-cleanup.timer\n' >"$T/save/20200101T000000Z/manifest"
rc=0; bash "$HERE/install_schedule.sh" --rollback >"$T/o2.txt" 2>&1 || rc=$?
check "rollback refuses a manifest whose saved file is missing, and changes nothing" "[ $rc != 0 ] && [ -e '$T/units/roxira-cleanup.timer' ] && grep -q 'OnCalendar' '$T/units/roxira-backup-dr-run.timer'"

# --- repeated apply with identical units creates no save dir ---
rm -rf "$T/save"; mkdir "$T/save"
bash "$HERE/install_schedule.sh" --apply >"$T/o3.txt" 2>&1
check "apply on an already installed system saves nothing" "[ \$(ls '$T/save' | wc -l) = 0 ] && grep -q 'nothing to save' '$T/o3.txt'"
[ "$fail" = 0 ] || cat "$T/apply.out" 2>/dev/null
exit "$fail"
