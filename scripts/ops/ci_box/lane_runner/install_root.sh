#!/usr/bin/env bash
# Box lane runner, part 2 of 2 (ROOT, admin only, once): installs ONE narrow root-owned wrapper and ONE sudoers line.
# Dry-run by default (prints the wrapper and the sudoers line, changes nothing). Add --apply, as root, to install.
#   sudo install_root.sh --lane-user <linux user that runs the lanes> [--apply]
# The wrapper accepts only these verbs and no other argument: linger-on, linger-off, status. It exists so the lane
# user can make its systemd user units survive logout (loginctl enable-linger for that ONE user). It does not touch
# nftables, ufw, /etc/xray, docker or any other user. The lane user cannot edit it (root-owned, mode 755).
set -euo pipefail

APPLY=0 LANE_USER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --lane-user) LANE_USER="${2?}"; shift ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$LANE_USER" ] || { echo "--lane-user is required" >&2; exit 2; }
case "$LANE_USER" in root | *[!a-z0-9_-]* | '') echo "refusing lane user '$LANE_USER'" >&2; exit 2 ;; esac
id "$LANE_USER" >/dev/null 2>&1 || { echo "no such user: $LANE_USER" >&2; exit 2; }

WRAPPER=/usr/local/sbin/roxira-lane-root
SUDOERS=/etc/sudoers.d/roxira-lane-root
CONTENT="#!/bin/bash
# Installed by scripts/ops/ci_box/lane_runner/install_root.sh. Fixed user, fixed verbs, no free arguments.
set -eu
U=$LANE_USER
case \"\${1:-}\" in
  linger-on) [ \$# -eq 1 ] && exec /usr/bin/loginctl enable-linger \"\$U\" ;;
  linger-off) [ \$# -eq 1 ] && exec /usr/bin/loginctl disable-linger \"\$U\" ;;
  status) [ \$# -eq 1 ] && exec /usr/bin/loginctl show-user \"\$U\" -p Linger -p State ;;
esac
echo \"usage: roxira-lane-root linger-on|linger-off|status\" >&2
exit 2"
LINE="$LANE_USER ALL=(root) NOPASSWD: $WRAPPER"

if [ "$APPLY" = 0 ]; then
  echo "[dry-run] would write $WRAPPER (root:root 755):"
  printf '%s\n' "$CONTENT"
  echo "[dry-run] would write $SUDOERS (root:root 440), validated with visudo -cf:"
  echo "$LINE"
  echo "Nothing changed. Re-run with --apply as root."
  exit 0
fi

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.s"' EXIT
printf '%s\n' "$CONTENT" >"$TMP"
bash -n "$TMP"
install -o root -g root -m 755 "$TMP" "$WRAPPER"
printf '%s\n' "$LINE" >"$TMP.s"
visudo -cf "$TMP.s"
install -o root -g root -m 440 "$TMP.s" "$SUDOERS"
echo "installed $WRAPPER and $SUDOERS"
echo "undo: rm $WRAPPER $SUDOERS"
