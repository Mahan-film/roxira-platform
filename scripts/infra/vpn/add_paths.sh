#!/usr/bin/env bash
# Add independent paths next to the existing REALITY inbound (path 1). Dry-run by default.
#   path 2: a second VLESS+Vision+REALITY inbound on its own port and dest (own key pair)
#   path 3: VLESS over XHTTP behind Cloudflare (nginx on :443 proxies one secret path to Xray),
#           the fallback when the server IP/port is blocked but Cloudflare is reachable
# Usage: add_paths.sh [--port2 9443] [--dest2 dl.google.com:443] [--sni2 NAME] [--no-reality2]
#        [--xhttp-host HOST] [--xhttp-port 10443] [--apply]      add or update paths
#        add_paths.sh --remove [--apply]                          roll back to path 1 only
# Env: NGINX_VHOST_DIR (default /opt/roxira_platform/nginx/sandboxes), NGINX_CONTAINER (roxira_nginx_prod),
#      XHTTP_CERT / XHTTP_KEY (paths inside the nginx container; default the self-signed catch-all cert,
#      which needs Cloudflare SSL mode "Full", not "Full (strict)").
set -euo pipefail
. "$(dirname "$0")/lib.sh"
NGINX_VHOST_DIR="${NGINX_VHOST_DIR:-/opt/roxira_platform/nginx/sandboxes}"
NGINX_CONTAINER="${NGINX_CONTAINER:-roxira_nginx_prod}"
XHTTP_CERT="${XHTTP_CERT:-/etc/nginx/ssl-default/snakeoil.crt}"
XHTTP_KEY="${XHTTP_KEY:-/etc/nginx/ssl-default/snakeoil.key}"
VHOST="$NGINX_VHOST_DIR/roxira-vpn-xhttp.conf"
apply=0 remove=0 want_r2=1 n_port2=9443 n_dest2="dl.google.com:443" n_sni2="" n_xhost="" n_xport=10443
while [ $# -gt 0 ]; do case "$1" in
  --apply) apply=1 ;; --remove) remove=1 ;; --no-reality2) want_r2=0 ;;
  --port2) n_port2="$2"; shift ;; --dest2) n_dest2="$2"; shift ;; --sni2) n_sni2="$2"; shift ;;
  --xhttp-host) n_xhost="$2"; shift ;; --xhttp-port) n_xport="$2"; shift ;;
  *) die "unknown arg: $1" ;; esac; shift; done
load_settings
old_port2="$PORT2" old_xport="$XHTTP_PORT"
nginx_reload() { command -v docker >/dev/null 2>&1 || { log "note: docker not found; reload nginx yourself"; return 0; }
  docker exec "$NGINX_CONTAINER" nginx -t >/dev/null 2>&1 || return 1
  docker exec "$NGINX_CONTAINER" nginx -s reload >/dev/null 2>&1; }

if [ "$remove" = 1 ]; then
  log "plan: remove paths 2 and 3 (port2=${PORT2:-none} xhttp=${XHTTP_PORT:-none}); path 1 stays; keys and path secret are kept"
  [ "$apply" = 1 ] || { log "dry-run: nothing changed. Re-run with --apply."; exit 0; }
  need_root
  PORT2="" DEST2="" SNI2="" XHTTP_PORT="" XHTTP_HOST=""
  save_settings; render_config; restart_xray
  [ -z "$old_port2" ] || ufw delete allow "$old_port2/tcp" >/dev/null 2>&1 || log "note: remove ufw rule for $old_port2 manually"
  [ -z "$old_xport" ] || ufw delete allow from 172.16.0.0/12 to any port "$old_xport" proto tcp >/dev/null 2>&1 || log "note: remove ufw rule for $old_xport manually"
  if [ -f "$VHOST" ]; then rm -f "$VHOST"; nginx_reload || log "WARNING: nginx test failed after removing the vhost; check manually"; fi
  log "removed. Re-import subscriptions on the phone."; exit 0
fi

if [ "$want_r2" = 1 ]; then
  [ -n "$n_sni2" ] || n_sni2="${n_dest2%%:*}"
  valid_dest "$n_dest2"; valid_host "${n_dest2%%:*}"; valid_host "$n_sni2"
  [ "$n_port2" = "$old_port2" ] || valid_new_port "$n_port2"
  [ "${n_dest2%%:*}" != "${DEST%%:*}" ] || die "path 2 dest must differ from path 1 dest ($DEST)"
  if [ "$n_port2" != "$old_port2" ] && port_busy "$n_port2"; then die "port $n_port2 is busy (ss -tulnp | grep $n_port2)"; fi
fi
if [ -n "$n_xhost" ]; then
  valid_host "$n_xhost"; [ "$n_xhost" != "$HOST" ] || die "--xhttp-host must be a Cloudflare-proxied hostname, not the direct server host"
  [ "$n_xport" = "$old_xport" ] || valid_new_port "$n_xport"
  if [ "$n_xport" != "$old_xport" ] && port_busy "$n_xport"; then die "port $n_xport is busy (ss -tulnp | grep $n_xport)"; fi
fi
[ "$want_r2" = 1 ] || [ -n "$n_xhost" ] || die "nothing to add: give --xhttp-host and/or leave path 2 enabled"
if [ "$want_r2" = 1 ]; then log "plan: path 2 REALITY port $n_port2 dest $n_dest2 sni $n_sni2 (own key pair), ufw allow $n_port2/tcp"; fi
if [ -n "$n_xhost" ]; then
  log "plan: path 3 XHTTP host $n_xhost -> Xray 0.0.0.0:$n_xport (ufw: only docker nets 172.16.0.0/12), nginx vhost $VHOST, reload container $NGINX_CONTAINER"
  log "      Cloudflare: proxied (orange cloud) DNS record for $n_xhost -> server IP, SSL mode Full"
fi
log "      backup of settings.env and config.json goes to $ETC/backup/<time>/ first"
[ "$apply" = 1 ] || { log "dry-run: nothing changed. Re-run with --apply."; exit 0; }
need_root
for t in ufw systemctl openssl; do command -v "$t" >/dev/null || die "missing tool: $t"; done
bk="$(backup_state)"
if [ "$want_r2" = 1 ]; then
  [ -f "$ETC/reality2.key" ] || gen_reality_keys 2
  chmod 600 "$ETC/reality2.key" "$ETC/reality2.pub" "$ETC/shortids2"
  PORT2="$n_port2" DEST2="$n_dest2" SNI2="$n_sni2"
fi
if [ -n "$n_xhost" ]; then
  [ -f "$ETC/xhttp.path" ] || (umask 077; printf '/x-%s\n' "$(openssl rand -hex 12)" >"$ETC/xhttp.path")
  chmod 600 "$ETC/xhttp.path"
  XHTTP_PORT="$n_xport" XHTTP_HOST="$n_xhost"
fi
save_settings; chmod 640 "$ETC/settings.env"; [ "${ROXIRA_VPN_SKIP_ROOT:-0}" = 1 ] || chown root:xray-vpn "$ETC/settings.env"
if ! ( render_config ); then restore_state "$bk"; die "config rejected; previous state restored from $bk"; fi
if [ "$want_r2" = 1 ] && [ "$n_port2" != "$old_port2" ]; then
  ufw allow "$n_port2/tcp" comment 'roxira-vpn xray reality 2' >/dev/null
  [ -z "$old_port2" ] || ufw delete allow "$old_port2/tcp" >/dev/null 2>&1 || true
fi
if [ -n "$n_xhost" ] && [ "$n_xport" != "$old_xport" ]; then
  ufw allow from 172.16.0.0/12 to any port "$n_xport" proto tcp comment 'roxira-vpn xhttp from nginx' >/dev/null
  [ -z "$old_xport" ] || ufw delete allow from 172.16.0.0/12 to any port "$old_xport" proto tcp >/dev/null 2>&1 || true
fi
restart_xray
sleep 1; systemctl is-active --quiet xray-vpn.service || die "xray-vpn failed to start; roll back with: $0 --remove --apply (backup in $bk)"
if [ -n "$n_xhost" ]; then
  xp="$(cat "$ETC/xhttp.path")"
  install -d -m 755 "$NGINX_VHOST_DIR"
  (umask 037; cat >"$VHOST" <<NGX
# Managed by scripts/infra/vpn/add_paths.sh. Remove with: add_paths.sh --remove --apply
server {
    listen 443 ssl;
    server_name $n_xhost;
    ssl_certificate     $XHTTP_CERT;
    ssl_certificate_key $XHTTP_KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 0;
    location ^~ $xp {
        proxy_pass http://host.docker.internal:$n_xport;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        client_body_timeout 1h;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
    location / { return 444; }
}
NGX
  )
  nginx_reload || { rm -f "$VHOST"; die "nginx rejected the vhost (removed it). Xray paths are up; fix nginx or run: $0 --remove --apply"; }
fi
log "done. Print the client link set (stdout only): sudo $(dirname "$0")/subscription.sh NAME"
