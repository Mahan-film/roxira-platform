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
export UNIT_DIR="$T/units" SCHEDULE_SAVE_DIR="$T/save" SYSTEMCTL="$T/sc" SCHEDULE_TEST=1

bash "$HERE/install_schedule.sh" >"$T/dry.out" 2>&1
check "dry-run changes nothing" "grep -q OLD-RUN-TIMER '$T/units/roxira-backup-dr-run.timer' && [ ! -e '$T/units/roxira-cleanup.timer' ]"

bash "$HERE/install_schedule.sh" --apply >"$T/apply.out" 2>&1
check "apply installs the daily run timer" "grep -q 'OnCalendar=\*-\*-\* 01:07:00' '$T/units/roxira-backup-dr-run.timer'"
check "apply installs the hourly pgcfg timer" "grep -q ':37:00' '$T/units/roxira-backup-dr-pgcfg.timer'"
check "apply installs the 6-hourly telegram timer" "grep -q '04/6:15:00' '$T/units/roxira-telegram-offsite.timer'"
check "apply installs the cleanup timer" "grep -q '01/2 05:40' '$T/units/roxira-cleanup.timer'"
check "apply saved the old units" "grep -rq OLD-RUN-TIMER '$T/save'"
check "apply enabled all five timers" "[ \$(grep -c 'systemctl enable' '$T/calls') = 5 ]"

bash "$HERE/install_schedule.sh" --rollback >"$T/rb.out" 2>&1
check "rollback restores the old run timer" "grep -q OLD-RUN-TIMER '$T/units/roxira-backup-dr-run.timer'"
check "rollback restores the old telegram timer" "grep -q OLD-TG-TIMER '$T/units/roxira-telegram-offsite.timer'"
check "rollback removes the new units" "[ ! -e '$T/units/roxira-cleanup.timer' ] && [ ! -e '$T/units/roxira-backup-dr-pgcfg.service' ]"
exit "$fail"
