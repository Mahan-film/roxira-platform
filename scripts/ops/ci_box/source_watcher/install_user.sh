#!/usr/bin/env bash
# Install the source watcher as a systemd --user timer in DRY-RUN mode. Run as the box user (mahanfilms), no sudo.
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
[ -f "$conf/sources.json" ] || install -m 0644 "$repo/config/source_watcher.json" "$conf/sources.json"
[ -f "$conf/env" ] || install -m 0600 "$here/env.example" "$conf/env"
install -m 0644 "$here/roxira-source-watcher.service" "$here/roxira-source-watcher.timer" "$unit/"

systemctl --user daemon-reload
systemctl --user enable --now roxira-source-watcher.timer
echo "Installed in DRY-RUN mode (SOURCE_WATCHER_ARGS empty in $conf/env)."
echo "  Run once now:   systemctl --user start roxira-source-watcher.service"
echo "  Logs/report:    journalctl --user -u roxira-source-watcher -n 40; ls $HOME/.local/state/roxira-source-watcher/reports"
echo "  Go live later:  set SOURCE_WATCHER_ARGS=--commit in $conf/env (owner decision after reviewing reports)"
echo "  Kill switch:    touch $conf/STOP   (remove to resume)"
