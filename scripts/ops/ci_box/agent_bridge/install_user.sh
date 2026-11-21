#!/usr/bin/env bash
# Install the agent bridge as a systemd --user timer. Run as the box user (mahanfilms), no sudo.
#   bash scripts/ops/ci_box/agent_bridge/install_user.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
share="$HOME/.local/share/roxira-bridge"
conf="$HOME/.config/roxira-bridge"
unit="$HOME/.config/systemd/user"
mkdir -p "$share" "$conf" "$unit" "$HOME/.local/state/roxira-bridge"

# Copy the script out of the repo so a write-mode agent cannot edit the code that runs it.
install -m 0644 "$here/bridge.py" "$share/bridge.py"
[ -f "$conf/bridge.toml" ] || install -m 0600 "$here/bridge.example.toml" "$conf/bridge.toml"
[ -f "$conf/env" ] || install -m 0600 "$here/env.example" "$conf/env"
install -m 0644 "$here/roxira-bridge.service" "$here/roxira-bridge.timer" "$unit/"

systemctl --user daemon-reload
# The first timer run sets a baseline (WAVE comments older than that run are ignored), so post
# the first WAVE only after the journal shows "baseline set".
if grep -q '<port>' "$conf/env"; then
  # A run with the placeholder fails with "gh api failed: error connecting to http".
  systemctl --user enable roxira-bridge.timer
  echo "Timer enabled but NOT started: set the proxy port in $conf/env, then:"
  echo "  systemctl --user start roxira-bridge.timer"
else
  systemctl --user enable --now roxira-bridge.timer
fi

echo
echo "Installed. Next:"
echo "  1. Edit $conf/env: put the real local proxy port in (the <port> placeholder is not valid)."
echo "  2. OWNER STEP (needs sudo, once): sudo loginctl enable-linger $USER"
echo "  3. Kill switch: touch $conf/STOP   (remove the file to resume)"
echo "  4. Logs: journalctl --user -u roxira-bridge -f"
