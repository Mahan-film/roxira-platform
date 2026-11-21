#!/usr/bin/env bash
# Install the merge gate for the CURRENT user (run as mahanfilms on the box). No root needed.
# Needs `gh auth status` to be logged in (as mahansudo) and `loginctl enable-linger $USER` once (root).
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
app="$HOME/roxira-merge-gate"
cfg="$HOME/.config/roxira-merge-gate"
units="$HOME/.config/systemd/user"
mkdir -p "$app" "$cfg" "$units"
install -m 0755 "$src/merge_gate.py" "$app/merge_gate.py"
install -m 0755 "$src/check_main_push.py" "$app/check_main_push.py"
# Notification helper (Telegram via NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID from ~/.config/roxira-merge-gate/notify.env).
install -m 0644 "$src/../../notify/notify.py" "$app/notify.py"
[ -f "$cfg/notify.env" ] || install -m 0600 /dev/null "$cfg/notify.env"
[ -f "$cfg/merge_gate.toml" ] || install -m 0600 "$src/merge_gate.example.toml" "$cfg/merge_gate.toml"
install -m 0644 "$src/roxira-merge-gate.service" "$src/roxira-merge-gate.timer" \
  "$src/roxira-check-main-push.service" "$src/roxira-check-main-push.timer" "$units/"
systemctl --user daemon-reload
systemctl --user enable --now roxira-merge-gate.timer roxira-check-main-push.timer
echo "installed. Config: $cfg/merge_gate.toml (dry_run = true until the flip)"
echo "logs:   journalctl --user -u roxira-merge-gate -f"
echo "stop:   touch ~/.local/state/roxira-merge-gate/KILL   (or systemctl --user disable --now roxira-merge-gate.timer)"
