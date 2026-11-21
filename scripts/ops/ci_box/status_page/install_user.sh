#!/usr/bin/env bash
# Install the box status page and failure alerts for the CURRENT user (the box lane user). No sudo, nothing outside $HOME.
#   bash install_user.sh               # dry-run (default): prints the plan, changes nothing
#   bash install_user.sh --apply       # install files and enable the three user units
#   bash install_user.sh --apply --no-enable   # copy files only, enable nothing
# Idempotent: unchanged files are skipped, the two env files are created once and never overwritten.
# Touches only: ~/.local/share/roxira-status, ~/.local/state/roxira-status, ~/.config/roxira-status,
#               ~/.config/systemd/user/roxira-status-*.{service,timer}
# Undo (also printed at the end):
#   systemctl --user disable --now roxira-status-collect.timer roxira-status-alert.timer roxira-status-web.service
#   rm -f ~/.config/systemd/user/roxira-status-*; systemctl --user daemon-reload
#   rm -rf ~/.local/share/roxira-status ~/.local/state/roxira-status ~/.config/roxira-status
set -euo pipefail

APPLY=0 ENABLE=1
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --no-enable) ENABLE=0 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

SRC="$(cd "$(dirname "$0")" && pwd)"
OPS="$(cd "$SRC/../.." && pwd)"
LANE_PACK="$(cd "$SRC/../lane_runner" && pwd)"
SHARE="$HOME/.local/share/roxira-status"
BIN="$SHARE/bin"
WWW="$SHARE/www"
STATE="$HOME/.local/state/roxira-status"
CONF="$HOME/.config/roxira-status"
UNITS="$HOME/.config/systemd/user"

say() { if [ "$APPLY" = 1 ]; then echo "+ $*"; else echo "[dry-run] would: $*"; fi; }
do_() { if [ "$APPLY" = 1 ]; then "$@"; fi; }

[ "$(id -u)" -ne 0 ] || { echo "run as the box lane user, not root" >&2; exit 1; }
[ "$APPLY" = 1 ] || echo "DRY-RUN: nothing is changed. Add --apply to install."

for d in "$BIN" "$WWW" "$STATE" "$CONF" "$UNITS"; do
  [ -d "$d" ] || { say "mkdir $d"; do_ mkdir -p "$d"; }
done
if [ "$APPLY" = 1 ]; then chmod 700 "$CONF" "$STATE"; fi

put() { # put <mode> <src> <dst>: copy only when different
  if [ -f "$3" ] && cmp -s "$2" "$3"; then echo "= unchanged $3"; return; fi
  say "install -m $1 $2 -> $3"; do_ install -m "$1" "$2" "$3"
}
# The code is copied out of the repo so editing the checkout cannot change what the timers run.
put 0644 "$SRC/box_status.py" "$BIN/box_status.py"
put 0644 "$SRC/box_alert.py" "$BIN/box_alert.py"
put 0644 "$OPS/monitor/monitor_common.py" "$BIN/monitor_common.py"
put 0644 "$OPS/notify/notify.py" "$BIN/notify.py"
put 0644 "$LANE_PACK/lane_budgets.box.json" "$BIN/lane_budgets.box.json"
for u in roxira-status-collect.service roxira-status-collect.timer roxira-status-alert.service roxira-status-alert.timer roxira-status-web.service; do
  put 0644 "$SRC/$u" "$UNITS/$u"
done
[ -f "$CONF/status.env" ] || { say "create $CONF/status.env (mode 600, optional settings)"; do_ install -m 0600 "$SRC/status.env.example" "$CONF/status.env"; }
[ -f "$CONF/telegram.env.example" ] || { say "write $CONF/telegram.env.example (template, no values)"; do_ install -m 0600 "$SRC/telegram.env.example" "$CONF/telegram.env.example"; }
[ -f "$CONF/telegram.env" ] || echo "! $CONF/telegram.env is missing: alerts stay OFF (a logged warning, no error) until the owner creates it (mode 600)."

if [ "$ENABLE" = 1 ]; then
  say "systemctl --user daemon-reload"; do_ systemctl --user daemon-reload
  say "first collection now (writes $WWW/index.html)"; do_ systemctl --user start roxira-status-collect.service || echo "! first collection failed; see journalctl --user -u roxira-status-collect"
  say "systemctl --user enable --now roxira-status-collect.timer roxira-status-alert.timer roxira-status-web.service"
  do_ systemctl --user enable --now roxira-status-collect.timer roxira-status-alert.timer roxira-status-web.service
fi

cat <<TXT

Page:    http://127.0.0.1:8088/   (loopback). For the LAN set STATUS_BIND=<box LAN address> in $CONF/status.env, then
         systemctl --user restart roxira-status-web.service. Never bind a public address; no port is opened in any firewall by this installer.
Alerts:  put TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in $CONF/telegram.env (chmod 600, see telegram.env.example), then
         python3 $BIN/box_alert.py --send-test      (one test message)   and   python3 $BIN/box_alert.py --dry-run
Needs:   loginctl enable-linger $USER   (admin, once; the existing lane pack asks for it too) so the timers run without a login.
Undo:    systemctl --user disable --now roxira-status-collect.timer roxira-status-alert.timer roxira-status-web.service
         rm -f $UNITS/roxira-status-*; systemctl --user daemon-reload; rm -rf $SHARE $STATE $CONF
TXT
