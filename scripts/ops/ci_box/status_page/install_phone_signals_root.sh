#!/usr/bin/env bash
# Install the phone SIGNALS producer on the box (owner runs it once, as root). Dry-run by default.
#   sudo bash install_phone_signals_root.sh            # dry-run: prints the plan, changes nothing
#   sudo bash install_phone_signals_root.sh --apply    # install and start the timer
# What it does: copies phone_probes.py to /usr/local/lib/roxira-phone (root-owned), installs a system service + timer that
# run it every 5 minutes as the new system user "roxira-phone" (no login, no home) with the extra groups adm + systemd-journal (read access to the ufw log and the system
# journal only; sandboxed, no network, writes only /var/lib/roxira-phone/phone-signals.json, mode 644, counters only).
# It does NOT touch ufw, nftables, sudoers, /etc/xray or the phone containers/units, and it adds no existing user to any group.
# The lane user's status page and alerts read the json file; until it exists the firewall/call probes stay off.
# Undo:
#   systemctl disable --now roxira-phone-signals.timer
#   rm -f /etc/systemd/system/roxira-phone-signals.{service,timer}; rm -rf /usr/local/lib/roxira-phone /var/lib/roxira-phone
#   systemctl daemon-reload; userdel roxira-phone
set -euo pipefail

APPLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  ""|--dry-run) ;;
  -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
  *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac

SRC="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/roxira-phone
UNITS=/etc/systemd/system

say() { if [ "$APPLY" = 1 ]; then echo "+ $*"; else echo "[dry-run] would: $*"; fi; }
do_() { if [ "$APPLY" = 1 ]; then "$@"; fi; }

if [ "$APPLY" = 1 ] && [ "$(id -u)" -ne 0 ]; then echo "run as root: sudo bash $0 --apply" >&2; exit 1; fi
[ "$APPLY" = 1 ] || echo "DRY-RUN: nothing is changed. Add --apply to install."
for f in phone_probes.py roxira-phone-signals.service roxira-phone-signals.timer; do
  [ -f "$SRC/$f" ] || { echo "missing $SRC/$f" >&2; exit 1; }
done
getent group adm >/dev/null && getent group systemd-journal >/dev/null || { echo "groups adm/systemd-journal missing" >&2; exit 1; }

if ! getent passwd roxira-phone >/dev/null; then say "useradd --system --user-group --no-create-home --shell /usr/sbin/nologin roxira-phone"; do_ useradd --system --user-group --no-create-home --shell /usr/sbin/nologin roxira-phone; fi
say "install -d -m 0755 $LIB"; do_ install -d -m 0755 "$LIB"
say "install -m 0644 phone_probes.py -> $LIB/phone_probes.py (root-owned, so nobody can edit what runs)"; do_ install -m 0644 -o root -g root "$SRC/phone_probes.py" "$LIB/phone_probes.py"
for u in roxira-phone-signals.service roxira-phone-signals.timer; do
  say "install -m 0644 $u -> $UNITS/$u"; do_ install -m 0644 -o root -g root "$SRC/$u" "$UNITS/$u"
done
say "systemctl daemon-reload"; do_ systemctl daemon-reload
say "systemctl enable --now roxira-phone-signals.timer"; do_ systemctl enable --now roxira-phone-signals.timer
say "systemctl start roxira-phone-signals.service (first run now)"; do_ systemctl start roxira-phone-signals.service

cat <<TXT

Check:  systemctl status roxira-phone-signals.service --no-pager | head -5; cat /var/lib/roxira-phone/phone-signals.json
Optional (root, never in git): put PHONE_CARRIER_CIDRS=<carrier networks> in /etc/roxira-phone/signals.env (mode 600) to count only carrier drops.
Undo:   systemctl disable --now roxira-phone-signals.timer; rm -f $UNITS/roxira-phone-signals.{service,timer}; rm -rf $LIB /var/lib/roxira-phone; systemctl daemon-reload; userdel roxira-phone
TXT
