#!/usr/bin/env bash
# Install the JIT pool controller for the CURRENT user (mahanfilms on the box). No root needed.
# Needs the gh login (mahansudo, repo admin) and linger. The runner side comes from 08_root_ci_pool.sh.
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
app="$HOME/roxira-jit"
cfg="$HOME/.config/roxira-jit"
units="$HOME/.config/systemd/user"
mkdir -p "$app" "$cfg" "$units"
install -m 0755 "$src/jit_pool.py" "$app/jit_pool.py"
[ -f "$cfg/jit_pool.toml" ] || install -m 0600 "$src/jit_pool.example.toml" "$cfg/jit_pool.toml"
install -m 0644 "$src/roxira-jit-pool.service" "$src/roxira-jit-pool.timer" "$units/"
systemctl --user daemon-reload
systemctl --user enable --now roxira-jit-pool.timer
echo "installed. Config: $cfg/jit_pool.toml (dry_run = true until the launchers are alive)"
echo "status: python3 $app/jit_pool.py --status"
echo "logs:   journalctl --user -u roxira-jit-pool -f"
echo "stop:   touch $cfg/STOP     hold new CI jobs (load shedding): touch $cfg/HOLD"
