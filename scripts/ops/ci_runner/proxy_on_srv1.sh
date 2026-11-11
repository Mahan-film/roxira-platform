#!/usr/bin/env bash
# Install a loopback-only forward proxy (tinyproxy) on srv1 for the CI runner VM.
# Run ON srv1 as root:  sudo bash proxy_on_srv1.sh [--dry-run]
# Never touches docker containers or nginx. Port 3128 is not in AGENTS.md §7.
set -euo pipefail

PORT="${PROXY_PORT:-3128}"
CONF=/etc/tinyproxy/tinyproxy.conf
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
changed=0

run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

if [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then echo "run as root" >&2; exit 1; fi

# Port must be free, or already owned by tinyproxy (idempotent re-run).
owner=$(ss -tulnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" || true)
if [ -n "$owner" ] && ! grep -q tinyproxy <<<"$owner"; then
  echo "port ${PORT} is occupied by another process, refusing to bind:" >&2
  echo "$owner" >&2
  exit 1
fi

if ! command -v tinyproxy >/dev/null 2>&1; then
  run apt-get update
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y tinyproxy
fi

new_conf=$(cat <<CFG
# Managed by scripts/ops/ci_runner/proxy_on_srv1.sh - local edits are overwritten.
User tinyproxy
Group tinyproxy
Port ${PORT}
Listen 127.0.0.1
Timeout 600
LogFile "/var/log/tinyproxy/tinyproxy.log"
LogLevel Info
PidFile "/run/tinyproxy/tinyproxy.pid"
MaxClients 100
Allow 127.0.0.1
DisableViaHeader Yes
ConnectPort 443
ConnectPort 80
CFG
)

if [ "$DRY" = 1 ]; then
  echo "[dry-run] write ${CONF}:"
  echo "$new_conf"
elif [ ! -f "$CONF" ] || [ "$(cat "$CONF")" != "$new_conf" ]; then
  if [ -f "$CONF" ] && [ ! -f "${CONF}.orig" ]; then cp "$CONF" "${CONF}.orig"; fi
  printf '%s\n' "$new_conf" > "$CONF"
  changed=1
fi

run systemctl enable tinyproxy
if [ "$DRY" = 1 ]; then
  echo "[dry-run] restart tinyproxy if config changed or service inactive"
  exit 0
fi
if [ "$changed" = 1 ] || ! systemctl is-active --quiet tinyproxy; then
  systemctl restart tinyproxy
fi
sleep 1
if ! ss -tln | grep -qE "127\.0\.0\.1:${PORT}[[:space:]]"; then
  echo "proxy not listening on 127.0.0.1:${PORT}" >&2
  exit 1
fi
echo "OK: tinyproxy on 127.0.0.1:${PORT}, log /var/log/tinyproxy/tinyproxy.log"
