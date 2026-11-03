#!/usr/bin/env bash
# Installs the fleet resume agent (launchd, every 5 minutes) for the current user.
#   bash scripts/dev/install_fleet_launchd.sh [--uninstall]
# It runs `fleet.py tick` from the main checkout: queued jobs start, rate-limited jobs resume once their
# cooldown ends, reviews and merges advance. It exits at once when nothing is due. Logs: ~/Library/Logs/roxira-fleet.log
set -euo pipefail
label="ir.roxira.fleet"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$domain/$label" 2>/dev/null || true
  rm -f "$plist"; echo "removed $label"; exit 0
fi
checkout="${FLEET_CHECKOUT:-$HOME/Developer/roxira-platform}"
script="$checkout/scripts/dev/fleet.py"
[ -f "$script" ] || { echo "missing $script (merge the fleet PR into the main checkout first)" >&2; exit 2; }
py="$(command -v python3)"
"$py" -c 'import yaml' 2>/dev/null || { echo "$py has no pyyaml: pip install pyyaml" >&2; exit 2; }
# XML-escape every value interpolated into the plist (paths may legally contain & < >)
x() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
xpy="$(x "$py")"; xscript="$(x "$script")"; xcheckout="$(x "$checkout")"; xhome="$(x "$HOME")"
mkdir -p "$HOME/.roxira-fleet/logs" "$HOME/Library/LaunchAgents"
cat >"$plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$xpy</string><string>$xscript</string><string>tick</string></array>
  <key>WorkingDirectory</key><string>$xcheckout</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$xhome</string>
    <key>PATH</key><string>$xhome/.opencode/bin:$xhome/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$xhome/Library/Logs/roxira-fleet.log</string>
  <key>StandardErrorPath</key><string>$xhome/Library/Logs/roxira-fleet.log</string>
</dict></plist>
P
plutil -lint "$plist" >/dev/null
launchctl bootout "$domain/$label" 2>/dev/null || true
launchctl bootstrap "$domain" "$plist"
echo "installed $plist (every 5 min). Check: launchctl print $domain/$label | head"
