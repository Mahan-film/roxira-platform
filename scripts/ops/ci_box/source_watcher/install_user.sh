#!/usr/bin/env bash
# Install the source watcher as a systemd --user timer. Run as the box user (mahanfilms), no sudo.
#   bash scripts/ops/ci_box/source_watcher/install_user.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
share="$HOME/.local/share/roxira-source-watcher"
conf="$HOME/.config/roxira-source-watcher"
unit="$HOME/.config/systemd/user"
mkdir -p "$share" "$conf" "$unit" "$HOME/.local/state/roxira-source-watcher"

# Copy the code out of the repo so the unit never runs a half-edited worktree.
install -m 0644 "$repo/scripts/legal/source_watcher.py" "$share/source_watcher.py"
# The source list and extra CA files are repo-controlled: always refresh them. env stays as the owner left it.
install -m 0644 "$repo/config/source_watcher.json" "$conf/sources.json"
mkdir -p "$conf/ca"
install -m 0644 "$repo"/config/ca/*.crt "$conf/ca/"
[ -f "$conf/env" ] || install -m 0600 "$here/env.example" "$conf/env"
install -m 0644 "$here/daily_report.sh" "$share/daily_report.sh"
install -m 0644 "$here"/roxira-source-watcher*.service "$here"/roxira-source-watcher*.timer "$unit/"

systemctl --user daemon-reload
systemctl --user enable --now roxira-source-watcher.timer roxira-source-watcher-report.timer
echo "Installed. Mode follows SOURCE_WATCHER_ARGS in $conf/env (empty = dry-run)."
echo "  Run once now:   systemctl --user start roxira-source-watcher.service"
echo "  Logs/report:    journalctl --user -u roxira-source-watcher -n 40; ls $HOME/.local/state/roxira-source-watcher/reports"
echo "  Mode:           --commit by default (owner decision of 2026-11-23); empty SOURCE_WATCHER_ARGS = dry-run"
echo "  Kill switch:    touch $conf/STOP   (remove to resume)"
