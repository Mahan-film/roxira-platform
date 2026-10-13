#!/usr/bin/env bash
# Headless Xray-core VLESS + XTLS-Vision + REALITY. Dry-run by default.
# Usage: install_xray_reality.sh --host PUBLIC_HOST_OR_IP [--clients a,b] [--port 8443]
#        [--dest www.microsoft.com:443] [--sni www.microsoft.com] [--disable-xui] [--apply]
# Env: XRAY_VERSION, XRAY_SHA256 (override together; sha mismatch fails closed).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
XRAY_VERSION="${XRAY_VERSION:-v25.8.3}"
XRAY_SHA256="${XRAY_SHA256:-7bcc35d375398c0df4b53ee004fb5b42402fcc0d331db5f2e6ac86cfc12b6a33}"  # Xray-linux-arm64-v8a.zip (from release .dgst)
XRAY_ASSET="${XRAY_ASSET:-Xray-linux-arm64-v8a.zip}"
PORT=8443 DEST="www.microsoft.com:443" SNI="" HOST="" CLIENTS="owner" apply=0 disable_xui=0
while [ $# -gt 0 ]; do case "$1" in
  --apply) apply=1 ;; --disable-xui) disable_xui=1 ;;
  --host) HOST="$2"; shift ;; --port) PORT="$2"; shift ;; --dest) DEST="$2"; shift ;;
  --sni) SNI="$2"; shift ;; --clients) CLIENTS="$2"; shift ;;
  *) die "unknown arg: $1" ;; esac; shift; done
[ -n "$SNI" ] || SNI="${DEST%%:*}"
[ -n "$HOST" ] || die "--host (public IP or DNS name clients connect to) is required"
valid_host "$HOST"; valid_host "$SNI"; valid_host "${DEST%%:*}"; valid_port "$PORT"
IFS=, read -r -a CL <<<"$CLIENTS"; for c in "${CL[@]}"; do valid_name "$c"; done

log "plan: xray $XRAY_VERSION ($XRAY_ASSET) port $PORT dest $DEST sni $SNI host $HOST clients ${CLIENTS}"
log "      user xray-vpn, state $ETC, systemd unit xray-vpn.service, ufw allow $PORT/tcp"
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  if [ "$disable_xui" = 1 ] && [ "$apply" = 1 ]; then need_root; systemctl disable --now x-ui
  else
    log "port $PORT is BUSY:"; ss -tlnp | grep ":$PORT " >&2 || true
    log "The restored x-ui service may hold it. To free it, re-run with --disable-xui (runs: systemctl disable --now x-ui)."
    [ "$apply" = 1 ] && exit 1
  fi
fi
[ "$apply" = 1 ] || { log "dry-run: nothing changed. Re-run with --apply."; exit 0; }
need_root
for t in curl unzip openssl ufw systemctl; do command -v "$t" >/dev/null || die "missing tool: $t"; done
if ss -tlnp | grep -q ":$PORT "; then die "port $PORT still busy after x-ui stop"; fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/x.zip" "https://github.com/XTLS/Xray-core/releases/download/$XRAY_VERSION/$XRAY_ASSET"
got="$(sha256sum "$tmp/x.zip" | cut -d' ' -f1)"
[ "$got" = "$XRAY_SHA256" ] || die "SHA256 mismatch for $XRAY_ASSET (expected $XRAY_SHA256, got $got); aborting"
unzip -q -o "$tmp/x.zip" xray geoip.dat geosite.dat -d "$tmp/out"
install -m 755 "$tmp/out/xray" /usr/local/bin/xray
install -d -m 755 /usr/local/share/xray
install -m 644 "$tmp/out/geoip.dat" "$tmp/out/geosite.dat" /usr/local/share/xray/

id xray-vpn >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin xray-vpn
install -d -m 750 -o root -g xray-vpn "$ETC"
install -d -m 700 -o root -g root "$ETC/clients"
[ -f "$ETC/reality.key" ] || gen_reality_keys
for c in "${CL[@]}"; do [ -f "$ETC/clients/$c.uuid" ] || (umask 077; new_uuid >"$ETC/clients/$c.uuid"); done
chmod 600 "$ETC/reality.key" "$ETC/reality.pub" "$ETC/shortids"; chmod 600 "$ETC"/clients/*.uuid
save_settings; chmod 640 "$ETC/settings.env"; chown root:xray-vpn "$ETC/settings.env"
render_config

cat >/etc/systemd/system/xray-vpn.service <<UNIT
[Unit]
Description=Xray VLESS REALITY (Roxira emergency VPN)
After=network-online.target
Wants=network-online.target

[Service]
User=xray-vpn
Group=xray-vpn
Environment=XRAY_LOCATION_ASSET=/usr/local/share/xray
ExecStart=/usr/local/bin/xray run -c $ETC/config.json
Restart=on-failure
RestartSec=3
LimitNOFILE=65535
NoNewPrivileges=true
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
UNIT
ufw allow "$PORT/tcp" comment 'roxira-vpn xray reality' >/dev/null
systemctl daemon-reload; systemctl enable --now xray-vpn.service
sleep 1; systemctl is-active --quiet xray-vpn.service || die "service failed to start; see: journalctl -u xray-vpn -n 20"
log "installed. Share links follow on stdout ONLY (do not redirect to a log file):"
for c in "${CL[@]}"; do print_link "$c"; done
