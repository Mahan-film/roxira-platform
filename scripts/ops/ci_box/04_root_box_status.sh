#!/bin/bash
# roxira-ci root setup, part 4: read-only box-status for the box hub, plus a narrow sudoers file.
# Run once as root:  sudo bash scripts/ops/ci_box/04_root_box_status.sh
# Installs:
#   /usr/local/bin/box-status       root-owned, 0755, read-only report (no secrets, no env values)
#   /etc/sudoers.d/box-hub          0440, lets mahanfilms run only box-status and box-proxy status|test
# Revert: rm /usr/local/bin/box-status /etc/sudoers.d/box-hub
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0"; exit 1; }

echo "== /usr/local/bin/box-status"
TMP_BIN=$(mktemp)
cat > "$TMP_BIN" <<'STATUS'
#!/bin/bash
# box-status: read-only health report for roxira-ci. Takes no arguments; ignores any given.
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
echo "== services"
printf 'xray:   %s\n' "$(systemctl is-active xray 2>/dev/null || true)"
printf 'docker: %s\n' "$(systemctl is-active docker 2>/dev/null || true)"
RUID=$(id -u runner 2>/dev/null || echo 1001)
printf 'runner: %s\n' "$(sudo -u runner XDG_RUNTIME_DIR=/run/user/$RUID systemctl --user is-active actions-runner 2>/dev/null || true)"
echo "== disk"
df -h / /srv/data 2>/dev/null
echo "== temperature"
sensors 2>/dev/null | grep -E '^(Package id [0-9]+|Core [0-9]+):' || echo "sensors unavailable"
echo "== pending updates"
apt list --upgradable 2>/dev/null | grep -c upgradable || true
[ -f /var/run/reboot-required ] && echo "reboot required" || echo "no reboot required"
STATUS
install -m 0755 -o root -g root "$TMP_BIN" /usr/local/bin/box-status
rm -f "$TMP_BIN"

echo "== /etc/sudoers.d/box-hub"
TMP_SUDO=$(mktemp)
cat > "$TMP_SUDO" <<'SUDOERS'
mahanfilms ALL=(root) NOPASSWD: /usr/local/bin/box-status, /usr/local/bin/box-proxy status, /usr/local/bin/box-proxy test
SUDOERS
if visudo -cf "$TMP_SUDO"; then
  install -m 0440 -o root -g root "$TMP_SUDO" /etc/sudoers.d/box-hub
  rm -f "$TMP_SUDO"
else
  rm -f "$TMP_SUDO"; echo "sudoers rejected by visudo; nothing installed"; exit 1
fi
visudo -c >/dev/null && echo "sudoers OK"

echo "== check"
sudo -l -U mahanfilms | grep -E 'box-(status|proxy)' || true
/usr/local/bin/box-status
