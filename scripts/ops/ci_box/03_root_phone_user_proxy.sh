#!/bin/bash
# roxira-ci root setup, part 3: voice user, box-proxy gains "install" (config JSON on stdin).
set -u
echo "== phone user (the name 'voice' is a system group on Ubuntu)"
U=phone
id $U >/dev/null 2>&1 || useradd -m -s /bin/bash $U
install -d -m 700 -o $U -g $U /home/$U/.ssh
install -m 600 -o $U -g $U /home/mahan/.ssh/authorized_keys /home/$U/.ssh/authorized_keys
usermod -aG docker $U; loginctl enable-linger $U
[ -d /srv/data/voice ] && mv /srv/data/voice /srv/data/phone 2>/dev/null; install -d -m 750 -o $U -g $U /srv/data/phone
id $U
echo "== box-proxy install"
cat > /usr/local/bin/box-proxy <<'TOGGLE'
#!/bin/bash
# box-proxy install|on|off|status|test
set -e
DROP=/etc/systemd/system/docker.service.d/proxy.conf
CFG=/etc/xray/config.json
case "${1:-status}" in
  install) TMP=$(mktemp --suffix=.json); cat > "$TMP"
       XRAY_LOCATION_ASSET=/usr/local/share/xray /usr/local/bin/xray run -test -config "$TMP" >/dev/null 2>&1 \
         || { rm -f "$TMP"; echo "config rejected by xray -test"; exit 1; }
       install -m 640 -o root -g xray "$TMP" "$CFG"; rm -f "$TMP"; echo "config installed";;
  on)  [ -s $CFG ] || { echo "no $CFG"; exit 1; }
       systemctl restart xray; sleep 2
       mkdir -p "$(dirname $DROP)"
       printf '[Service]\nEnvironment=HTTP_PROXY=http://127.0.0.1:10809\nEnvironment=HTTPS_PROXY=http://127.0.0.1:10809\nEnvironment=NO_PROXY=localhost,127.0.0.1,192.168.0.0/16,ghcr.io,quay.io,public.ecr.aws\n' > $DROP
       systemctl daemon-reload; systemctl restart docker; echo "proxy ON";;
  off) rm -f $DROP; systemctl daemon-reload; systemctl restart docker; systemctl stop xray || true; echo "proxy OFF";;
  test) curl -s -o /dev/null -m 15 -w "via proxy: registry-1.docker.io %{http_code}\n" -x http://127.0.0.1:10809 https://registry-1.docker.io/v2/ || echo "proxy test failed";;
  status) systemctl is-active xray || true; [ -f $DROP ] && echo "docker via proxy" || echo "docker direct";;
esac
TOGGLE
chmod 755 /usr/local/bin/box-proxy
echo "SETUP3 DONE"
