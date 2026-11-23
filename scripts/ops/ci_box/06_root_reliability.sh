#!/bin/bash
# roxira-ci root setup, part 6 (R20-7, #1023): box reliability pack. Owner runs it once:
#   sudo bash scripts/ops/ci_box/06_root_reliability.sh [--dry-run]
# Idempotent: re-running changes nothing that is already in place. --dry-run prints what it would do
# (it needs no root and writes nothing).
# Installs:
#   1. lid switch ignored        /etc/systemd/logind.conf.d/10-roxira-lid.conf
#   2. sleep/suspend/hibernate   masked
#   3. unattended-upgrades       security only, Automatic-Reboot "false"  (/etc/apt/apt.conf.d/52roxira-unattended)
#   4. guarded weekly reboot     roxira-guarded-reboot.timer, Sunday 04:30
#   5. battery charge cap        40-80 percent, only if the firmware exposes it
#   6. restic local backup       /srv/data/backups/restic-box, daily, password in /etc/roxira/restic.pass (root, 600)
#   7. Telegram failure alerts   roxira-notify@.service reading /etc/roxira/telegram.env (root, 600; you create it)
#   8. read-only status          /usr/local/bin/box-reliability-status (no sudo needed to run it)
# It does not touch nftables, ufw, xray, sudoers, or the phone/runner services themselves.
# Revert: see docs/ops/BOX_RELIABILITY.md.
set -euo pipefail

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac
if [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo bash $0   (or add --dry-run)"; exit 1
fi

PROXY="${ROXIRA_PROXY:-http://127.0.0.1:10809}"
RESTIC_REPO=/srv/data/backups/restic-box
RESTIC_PASS=/etc/roxira/restic.pass
LIBDIR=/usr/local/lib/roxira
STATEDIR=/var/lib/roxira
SYSD=/etc/systemd/system
CHANGED_UNITS=0

say() { echo; echo "== $*"; }
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }

# put FILE MODE  (content on stdin): write only when different.
put() {
  local f="$1" mode="$2" tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/roxira.XXXXXX")
  cat > "$tmp"
  if [ -f "$f" ] && cmp -s "$tmp" "$f"; then
    echo "unchanged: $f"
  elif [ "$DRY" = 1 ]; then
    echo "[dry-run] would write $f (mode $mode)"
  else
    mkdir -p "$(dirname "$f")"
    install -m "$mode" -o root -g root "$tmp" "$f"
    echo "wrote: $f"
    case "$f" in "$SYSD"/*) CHANGED_UNITS=1 ;; esac
  fi
  rm -f "$tmp"
}

run install -d -m 755 "$LIBDIR" "$STATEDIR"
run install -d -m 750 /etc/roxira

# ---------------------------------------------------------------- 1. lid
say "1. lid switch: ignore (laptop runs with the lid closed)"
put /etc/systemd/logind.conf.d/10-roxira-lid.conf 644 <<'CONF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
CONF
# logind re-reads its config on SIGHUP; this does not end sessions.
if [ "$DRY" = 1 ]; then echo "[dry-run] would: systemctl kill -s HUP systemd-logind"
else systemctl kill -s HUP systemd-logind 2>/dev/null || echo "note: logind reload failed; the setting applies at next boot"; fi

# ---------------------------------------------------------------- 2. sleep
say "2. mask sleep, suspend, hibernate"
for t in sleep.target suspend.target hibernate.target hybrid-sleep.target; do
  if [ "$(systemctl is-enabled "$t" 2>/dev/null || true)" = masked ]; then echo "already masked: $t"
  else run systemctl mask "$t"; fi
done

# ---------------------------------------------------------------- 3. unattended-upgrades
say "3. unattended-upgrades: security only, no automatic reboot"
if dpkg -s unattended-upgrades >/dev/null 2>&1; then echo "package present"
else run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q unattended-upgrades; fi
# '#clear' drops the default origin list from 50unattended-upgrades, so only -security stays.
put /etc/apt/apt.conf.d/52roxira-unattended 644 <<'CONF'
#clear Unattended-Upgrade::Allowed-Origins;
Unattended-Upgrade::Allowed-Origins {
        "${distro_id}:${distro_codename}-security";
        "${distro_id}ESMApps:${distro_codename}-apps-security";
        "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "false";
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

# ---------------------------------------------------------------- 4. guarded reboot
say "4. guarded weekly reboot (Sunday 04:30)"
put "$LIBDIR/guarded-reboot.sh" 755 <<'JOB'
#!/bin/bash
# Reboot only when ALL hold: reboot-required exists, no CI job is running, no phone call is active.
# '--check' prints the decision and never reboots. Every decision is logged to the journal and
# /var/lib/roxira/last-reboot-check.
set -u
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
STATE=/var/lib/roxira/last-reboot-check
decide() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee "$STATE"; logger -t roxira-reboot "$*"; }

[ -f /var/run/reboot-required ] || { decide "skip: no reboot required"; exit 0; }

# CI: the GitHub runner starts a Runner.Worker process only while a job runs.
if pgrep -f 'Runner\.Worker' >/dev/null 2>&1; then decide "skip: a runner job is active"; exit 0; fi

# Phone: phone-stack status output is not machine readable, so ask the containers directly.
# - asterisk container found and 'core show channels count' parses: reboot only at 0 active calls.
# - LiveKit/asterisk containers are up but calls cannot be counted: assume a call may be active, skip.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  # Match on name OR image: the containers are named lk-*, so a name-only filter finds nothing and
  # silently skips the active-call guard.
  found=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -i -E 'livekit|asterisk' || true)
  if [ -n "$found" ]; then
    count=""
    for c in $(echo "$found" | grep -i asterisk | awk '{print $1}' || true); do
      out=$(docker exec "$c" asterisk -rx 'core show channels count' 2>/dev/null || true)
      n=$(echo "$out" | sed -n 's/^\([0-9][0-9]*\) active call.*/\1/p' | head -1)
      [ -n "$n" ] && count=$(( ${count:-0} + n ))
    done
    if [ -z "$count" ]; then decide "skip: phone containers are up and the call count is unknown"; exit 0; fi
    if [ "$count" -gt 0 ]; then decide "skip: $count active call(s)"; exit 0; fi
  fi
fi

if [ "${1:-}" = "--check" ]; then decide "check only: would reboot now"; exit 0; fi
decide "rebooting now (reboot required, no runner job, no active call)"
exec systemctl reboot
JOB
put "$SYSD/roxira-guarded-reboot.service" 644 <<UNIT
[Unit]
Description=Reboot if required and the box is idle (runner and phone)
OnFailure=roxira-notify@%n.service
[Service]
Type=oneshot
ExecStart=$LIBDIR/guarded-reboot.sh
UNIT
put "$SYSD/roxira-guarded-reboot.timer" 644 <<'UNIT'
[Unit]
Description=Weekly guarded reboot
[Timer]
OnCalendar=Sun *-*-* 04:30:00
Persistent=false
[Install]
WantedBy=timers.target
UNIT

# ---------------------------------------------------------------- 5. battery
say "5. battery charge cap 40-80 percent"
BAT_FOUND=0
for b in /sys/class/power_supply/BAT*; do
  [ -e "$b/charge_control_end_threshold" ] && BAT_FOUND=1
done
if [ "$BAT_FOUND" = 1 ]; then
  put "$LIBDIR/battery-cap.sh" 755 <<'JOB'
#!/bin/bash
# Charge between 40 and 80 percent where the firmware allows it.
for b in /sys/class/power_supply/BAT*; do
  [ -w "$b/charge_control_end_threshold" ] || continue
  # start threshold first when present, so end >= start always holds
  [ -w "$b/charge_control_start_threshold" ] && echo 40 > "$b/charge_control_start_threshold"
  echo 80 > "$b/charge_control_end_threshold"
  echo "$(basename "$b"): cap set to $(cat "$b/charge_control_start_threshold" 2>/dev/null || echo '-')-$(cat "$b/charge_control_end_threshold")"
done
JOB
  put "$SYSD/roxira-battery-cap.service" 644 <<UNIT
[Unit]
Description=Battery charge cap 40-80 percent
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$LIBDIR/battery-cap.sh
[Install]
WantedBy=multi-user.target
UNIT
else
  echo "NOTE: no /sys/class/power_supply/BAT*/charge_control_end_threshold on this machine."
  echo "      The firmware does not expose a charge cap (HP laptops often need a BIOS 'Battery Care' option)."
  echo "      Nothing installed for the battery. Re-run this script after a BIOS change."
fi

# ---------------------------------------------------------------- 6. restic
say "6. restic backup of /etc, box scripts and ~mahanfilms/.config"
if have restic; then echo "restic present: $(restic version 2>/dev/null | head -1)"
else run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q restic; fi

if [ -f "$RESTIC_PASS" ]; then
  echo "password file exists: $RESTIC_PASS (not shown)"
elif [ "$DRY" = 1 ]; then
  echo "[dry-run] would generate $RESTIC_PASS (root, 600) and print it ONCE for the owner"
else
  umask 077
  head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$RESTIC_PASS"
  chmod 600 "$RESTIC_PASS"; chown root:root "$RESTIC_PASS"
  echo
  echo "################ OWNER ACTION, shown only once ################"
  echo "The restic repository password was just generated. Copy it into your password manager NOW."
  echo "Without it the backups cannot be restored. Never commit it, never paste it into chat."
  echo "Password: $(cat "$RESTIC_PASS")"
  echo "(Still readable later by root only: sudo cat $RESTIC_PASS)"
  echo "################################################################"
  echo
fi

if grep -q ' /srv/data ' /proc/mounts 2>/dev/null; then
  if [ "$DRY" = 1 ]; then echo "[dry-run] would init $RESTIC_REPO when missing"
  elif [ -f "$RESTIC_REPO/config" ]; then echo "restic repo exists: $RESTIC_REPO"
  else
    install -d -m 700 "$RESTIC_REPO"
    restic -r "$RESTIC_REPO" --password-file "$RESTIC_PASS" init
  fi
else
  echo "WARN: /srv/data is not mounted here; the restic repo is not initialised (expected on the Mac dry-run)."
fi

put "$LIBDIR/box-backup.sh" 755 <<JOB
#!/bin/bash
# Daily restic backup of box configuration. Root only. Writes $STATEDIR/last-backup on success.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export RESTIC_REPOSITORY=$RESTIC_REPO RESTIC_PASSWORD_FILE=$RESTIC_PASS
grep -q ' /srv/data ' /proc/mounts || { echo "/srv/data not mounted"; exit 1; }
PATHS=(/etc /usr/local/bin /usr/local/lib/roxira /usr/local/lib/phone-stack /usr/local/share/xray /home/mahanfilms/.config)
EXIST=(); for p in "\${PATHS[@]}"; do [ -e "\$p" ] && EXIST+=("\$p"); done
restic backup --tag box --exclude-caches \\
  --exclude '**/.cache' --exclude '**/node_modules' --exclude '**/docker' --exclude '**/__pycache__' \\
  --exclude '/etc/ssl/private' \\
  "\${EXIST[@]}"
restic forget --tag box --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check --read-data-subset=2%
echo "\$(date -u +%Y-%m-%dT%H:%M:%SZ) OK snapshots=\$(restic snapshots --tag box --compact | tail -1)" > $STATEDIR/last-backup
chmod 644 $STATEDIR/last-backup
JOB
put "$SYSD/roxira-box-backup.service" 644 <<UNIT
[Unit]
Description=restic backup of box configuration
After=network-online.target
OnFailure=roxira-notify@%n.service
[Service]
Type=oneshot
ExecStart=$LIBDIR/box-backup.sh
Nice=10
IOSchedulingClass=idle
UNIT
put "$SYSD/roxira-box-backup.timer" 644 <<'UNIT'
[Unit]
Description=Daily box configuration backup
[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=10min
Persistent=true
[Install]
WantedBy=timers.target
UNIT

# ---------------------------------------------------------------- 7. telegram
say "7. Telegram alerts on failure (template unit roxira-notify@<unit>.service)"
put /etc/roxira/telegram.env.example 644 <<'ENV'
# Copy to /etc/roxira/telegram.env, fill in, then: chmod 600 /etc/roxira/telegram.env  (root only).
# Placeholders only. Never commit the real file.
TELEGRAM_BOT_TOKEN=123456:REPLACE_ME
TELEGRAM_CHAT_ID=REPLACE_ME
ENV
put "$LIBDIR/notify-telegram.sh" 755 <<JOB
#!/bin/bash
# notify-telegram.sh <text...>  Sends one message through the local proxy. Token comes from the
# environment (EnvironmentFile), is passed to curl on stdin, never on the command line.
set -u
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
: "\${TELEGRAM_BOT_TOKEN:?missing TELEGRAM_BOT_TOKEN in /etc/roxira/telegram.env}"
: "\${TELEGRAM_CHAT_ID:?missing TELEGRAM_CHAT_ID in /etc/roxira/telegram.env}"
msg="\$(hostname): \$*"
printf 'url = "https://api.telegram.org/bot%s/sendMessage"\\n' "\$TELEGRAM_BOT_TOKEN" | \\
  curl -fsS -m 30 -x $PROXY -K - --data-urlencode "chat_id=\$TELEGRAM_CHAT_ID" \\
       --data-urlencode "text=\$msg" -o /dev/null && echo "alert sent"
JOB
put "$SYSD/roxira-notify@.service" 644 <<UNIT
[Unit]
Description=Telegram alert: %i failed
[Service]
Type=oneshot
EnvironmentFile=/etc/roxira/telegram.env
ExecStart=$LIBDIR/notify-telegram.sh "unit %i failed"
UNIT
# OnFailure drop-ins for the box services we own. xray is deliberately left alone.
for u in docker voice-ai-agent voice-ai-tts; do
  put "$SYSD/$u.service.d/10-roxira-onfailure.conf" 644 <<'UNIT'
[Unit]
OnFailure=roxira-notify@%n.service
UNIT
done
if [ ! -f /etc/roxira/telegram.env ]; then
  echo "OWNER STEP: create /etc/roxira/telegram.env from telegram.env.example, then chmod 600 (alerts stay silent until then)."
fi

# ---------------------------------------------------------------- 8. status
say "8. read-only status: box-reliability-status"
put /usr/local/bin/box-reliability-status 755 <<'JOB'
#!/bin/bash
# Read-only reliability report. Needs no root; reads only world-readable files.
echo "== battery cap"
found=0
for b in /sys/class/power_supply/BAT*; do
  [ -r "$b/charge_control_end_threshold" ] || continue
  found=1
  printf '%s: charge %s-%s percent\n' "$(basename "$b")" "$(cat "$b/charge_control_start_threshold" 2>/dev/null || echo '-')" "$(cat "$b/charge_control_end_threshold")"
done
[ "$found" = 1 ] || echo "no charge cap exposed by the firmware"
echo "== last backup (restic)"
cat /var/lib/roxira/last-backup 2>/dev/null || echo "none yet"
echo "== last upgrade (apt)"
grep -h '^Start-Date' /var/log/apt/history.log 2>/dev/null | tail -1 || true
echo "== guarded reboot"
cat /var/lib/roxira/last-reboot-check 2>/dev/null || echo "no check yet"
systemctl list-timers 'roxira-*' --no-pager 2>/dev/null | head -6 || true
[ -f /var/run/reboot-required ] && echo "reboot required" || echo "no reboot required"
JOB

# ---------------------------------------------------------------- activate
say "activate"
if [ "$CHANGED_UNITS" = 1 ] || [ "$DRY" = 1 ]; then run systemctl daemon-reload; fi
run systemctl enable --now roxira-guarded-reboot.timer roxira-box-backup.timer
[ "$BAT_FOUND" = 1 ] && run systemctl enable --now roxira-battery-cap.service
echo
echo "Next owner steps:"
echo "  1. Store the restic password (printed above on first run) in your password manager."
echo "  2. Create /etc/roxira/telegram.env (see telegram.env.example), chmod 600."
echo "  3. Test the alert:  sudo systemctl start roxira-notify@test.service   (one Telegram message)"
echo "  4. First backup now: sudo systemctl start roxira-box-backup.service ; box-reliability-status"
echo "RELIABILITY DONE"
