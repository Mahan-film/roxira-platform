#!/usr/bin/env bash
# shellcheck disable=SC2016
# Offline test: stub binaries via PATH; checks rendering, client mgmt, no secret leakage in logs.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/vpntest.XXXXXX")"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/etc/clients"
cat >"$T/bin/xray" <<'S'
#!/usr/bin/env bash
case "$1" in
  x25519) printf 'PrivateKey: STUBPRIVKEYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nPassword: STUBPUBKEYbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' ;;
  run) grep -q '"protocol": "vless"' "$4" && { ! command -v python3 >/dev/null || python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$4"; } ;;
  version) echo "Xray 1.0.0 (stub)" ;;
esac
S
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'echo "systemctl $*" >>"$STUBLOG"' >"$T/bin/systemctl"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" STUBLOG="$T/stub.log" ROXIRA_VPN_ETC="$T/etc" ROXIRA_VPN_SKIP_ROOT=1
. "$D/lib.sh"
PORT=8443 DEST="www.microsoft.com:443" SNI="www.microsoft.com" HOST="vpn.example.test"
save_settings; gen_reality_keys
new_uuid >"$ETC/clients/alice.uuid"
render_config
grep -q '"port": 8443' "$ETC/config.json"
grep -q '"serverNames": \["www.microsoft.com"\]' "$ETC/config.json"
grep -q 'STUBPRIVKEY' "$ETC/config.json"
out="$T/out.log"
"$D/vpn_client.sh" add bob >"$out" 2>"$T/err.log"
grep -q '^vless://.*@vpn.example.test:8443?.*pbk=STUBPUBKEY' "$out"
[ "$("$D/vpn_client.sh" list | wc -l | tr -d " ")" = 2 ]
# alice's secret must not appear in bob's add output
if grep -q "$(cat "$ETC/clients/alice.uuid")" "$out"; then echo "FAIL leak"; exit 1; fi
# no secrets in stderr/stub logs
for s in "$(cat "$ETC/clients/bob.uuid")" "$(cat "$ETC/clients/alice.uuid")" STUBPRIVKEY; do
  if grep -q "$s" "$T/err.log" "$STUBLOG"; then echo "FAIL secret in log"; exit 1; fi; done
bobid="$(cat "$ETC/clients/bob.uuid")"
"$D/vpn_client.sh" remove bob 2>/dev/null
if grep -q "$bobid" "$ETC/config.json"; then echo "FAIL bob remains"; exit 1; fi
[ "$("$D/vpn_client.sh" list | wc -l | tr -d " ")" = 1 ]

# ---- multi-path: path 2 (second REALITY) + path 3 (XHTTP via Cloudflare) ----
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$T/bin/ufw"; chmod +x "$T/bin/ufw"
printf '%s\n' '#!/usr/bin/env bash' 'exit 1' >"$T/bin/ss"; chmod +x "$T/bin/ss"   # nothing listens: all ports free
export NGINX_VHOST_DIR="$T/nginx"
printf '%s\n' '#!/usr/bin/env bash' 'echo "docker $*" >>"$STUBLOG"' >"$T/bin/docker"; chmod +x "$T/bin/docker"
"$D/add_paths.sh" --xhttp-host cdn.example.test 2>"$T/dry.log"
grep -q 'dry-run' "$T/dry.log"
[ ! -e "$ETC/reality2.key" ] && [ ! -e "$NGINX_VHOST_DIR" ] || { echo "FAIL dry-run wrote files"; exit 1; }
"$D/add_paths.sh" --xhttp-host cdn.example.test --apply 2>"$T/add.log" || { cat "$T/add.log"; exit 1; }
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$ETC/config.json"
[ "$(grep -c '"protocol": "vless"' "$ETC/config.json")" = 3 ]
grep -q '"port": 9443' "$ETC/config.json"
grep -q '"dest": "dl.google.com:443"' "$ETC/config.json"
grep -q '"network": "xhttp"' "$ETC/config.json"
[ "$(grep -c 'xtls-rprx-vision' "$ETC/config.json")" = 2 ]   # alice only, on the two REALITY inbounds
[ "$(grep -c '"privateKey"' "$ETC/config.json")" = 2 ]
k1="$(cat "$ETC/reality.key")"; k2="$(cat "$ETC/reality2.key")"
grep -q "$k1" "$ETC/config.json" && grep -q "$k2" "$ETC/config.json"
grep -q 'ufw' /dev/null || true
vh="$NGINX_VHOST_DIR/roxira-vpn-xhttp.conf"
grep -q 'server_name cdn.example.test;' "$vh"
grep -q "location \^~ $(cat "$ETC/xhttp.path") " "$vh"
grep -q 'proxy_pass http://host.docker.internal:10443;' "$vh"
# path 2 must not reuse path 1 dest / reserved ports must be refused
if "$D/add_paths.sh" --dest2 www.microsoft.com:443 2>/dev/null; then echo "FAIL same dest accepted"; exit 1; fi
for bad in 8000 3002 8443; do
  if "$D/add_paths.sh" --port2 $bad 2>/dev/null; then echo "FAIL port $bad accepted"; exit 1; fi; done
# links and subscription: one link per path, distinct keys, no secret in stderr
"$D/subscription.sh" alice --plain >"$T/sub.plain" 2>"$T/sub.err"
[ "$(wc -l <"$T/sub.plain" | tr -d ' ')" = 3 ]
grep -q ':9443?.*pbk=STUBPUBKEY' "$T/sub.plain"
grep -q '@cdn.example.test:443?.*type=xhttp.*host=cdn.example.test&path=%2Fx-' "$T/sub.plain"
"$D/subscription.sh" alice --write >"$T/sub.b64" 2>/dev/null
dec="$(base64 -d <"$T/sub.b64" 2>/dev/null || base64 -D <"$T/sub.b64")"
[ "$dec" = "$(cat "$T/sub.plain")" ]
[ "$(stat -c %a "$ETC/subscription/alice.txt" 2>/dev/null || stat -f %Lp "$ETC/subscription/alice.txt")" = 600 ]
if grep -qE "$(cat "$ETC/clients/alice.uuid")|$(cat "$ETC/xhttp.path")" "$T/add.log" "$T/sub.err" "$STUBLOG"; then echo "FAIL secret in log"; exit 1; fi
# rotate path 2 (ss stub: 9444 only listens after a restart, like a real xray)
printf '%s\n' '#!/usr/bin/env bash' 'echo "systemctl $*" >>"$STUBLOG"; [ "$1" != restart ] || touch "$STUBLOG.restarted"' >"$T/bin/systemctl"
printf '%s\n' '#!/usr/bin/env bash' 'printf "tcp LISTEN 0 4096 *:8443 *\ntcp LISTEN 0 4096 *:9443 *\ntcp LISTEN 0 4096 *:10443 *\n"; [ ! -e "$STUBLOG.restarted" ] || printf "tcp LISTEN 0 4096 *:9444 *\n"' >"$T/bin/ss"
chmod +x "$T/bin/systemctl" "$T/bin/ss"; rm -f "$STUBLOG.restarted"
"$D/rotate.sh" --port2 9444 --dest2 www.apple.com:443 --keys2 --apply >/dev/null 2>&1
grep -q '"port": 9444' "$ETC/config.json"; grep -q '"dest": "www.apple.com:443"' "$ETC/config.json"

# ---- health: one line per path, no secrets ----
printf '%s\n' '#!/usr/bin/env bash' 'printf "tcp LISTEN 0 4096 *:8443 *\ntcp LISTEN 0 4096 *:9444 *\ntcp LISTEN 0 4096 *:10443 *\n"' >"$T/bin/ss"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$T/bin/journalctl"
printf '%s\n' '#!/usr/bin/env bash' 'echo 200' >"$T/bin/curl"
chmod +x "$T/bin/ss" "$T/bin/journalctl" "$T/bin/curl"
printf '%s\n' '#!/usr/bin/env bash' 'exit 1' >"$T/bin/openssl.off"   # openssl absent from stubs: probe path skipped
printf '#!/usr/bin/env bash\ncase "$1" in s_client) echo x;; x509) case "$*" in *-checkhost*) case "${@: -1}" in dl.google.com|www.microsoft.com|www.apple.com) echo "Hostname ${@: -1} does match certificate";; *) echo "does NOT match certificate";; esac;; *) echo "subject=CN=other.example";; esac;; *) exec /usr/bin/openssl "$@";; esac\n' >"$T/bin/openssl"
chmod +x "$T/bin/openssl"
printf '%s\n' '#!/usr/bin/env bash' 'shift; exec "$@"' >"$T/bin/timeout"; chmod +x "$T/bin/timeout"
SNI_STUB=microsoft.com "$D/health.sh" >"$T/h.out" 2>"$T/h.err" || { cat "$T/h.err"; echo "FAIL health"; exit 1; }
grep -q 'OK   path 1 reality' "$T/h.err"; grep -q 'OK   path 2 reality' "$T/h.err"; grep -q 'OK   path 3 xhttp/cdn' "$T/h.err"
if grep -qE "$(cat "$ETC/xhttp.path")|$(cat "$ETC/clients/alice.uuid")|vless://" "$T/h.err" "$T/h.out"; then echo "FAIL health leak"; exit 1; fi
printf '%s\n' '#!/usr/bin/env bash' 'printf "tcp LISTEN 0 4096 *:8443 *\n"' >"$T/bin/ss"
if "$D/health.sh" >/dev/null 2>"$T/h2.err"; then echo "FAIL health should fail with path 2/3 down"; exit 1; fi
grep -q 'FAIL path 2 reality' "$T/h2.err"; grep -q 'FAIL path 3 xhttp/cdn xray port' "$T/h2.err"

# ---- update_xray: checksum gate, install, automatic rollback, manual rollback ----
rm -f "$T/bin/curl"   # real curl for file:// downloads
mkdir -p "$T/rel/v9.9.9" "$T/zipsrc" "$T/binstall" "$T/share"
printf '#!/usr/bin/env bash\ncase "$1" in version) echo "Xray 9.9.9 (new)";; run) exit 0;; esac\n' >"$T/zipsrc/xray"
chmod +x "$T/zipsrc/xray"; echo g >"$T/zipsrc/geoip.dat"; echo g >"$T/zipsrc/geosite.dat"
(cd "$T/zipsrc" && zip -q "$T/rel/v9.9.9/Xray-linux-64.zip" xray geoip.dat geosite.dat)
sha="$(sha256_of "$T/rel/v9.9.9/Xray-linux-64.zip")"
printf '#!/usr/bin/env bash\ncase "$1" in version) echo "Xray 1.0.0 (old)";; run) exit 0;; esac\n' >"$T/binstall/xray"; chmod +x "$T/binstall/xray"
echo og >"$T/share/geoip.dat"
export XRAY_INSTALL_DIR="$T/binstall" XRAY_SHARE_DIR="$T/share" XRAY_DOWNLOAD_BASE="file://$T/rel" ROXIRA_VPN_WAIT=1
printf '%s\n' '#!/usr/bin/env bash' 'case "$1" in is-active) [ ! -e "$STUBFAIL" ] || ! grep -q "(new)" "$XRAY_INSTALL_DIR/xray";; *) echo "systemctl $*" >>"$STUBLOG";; esac' >"$T/bin/systemctl"
printf '%s\n' '#!/usr/bin/env bash' 'printf "tcp LISTEN 0 4096 *:8443 *\ntcp LISTEN 0 4096 *:9444 *\ntcp LISTEN 0 4096 *:10443 *\n"' >"$T/bin/ss"
chmod +x "$T/bin/systemctl" "$T/bin/ss"
export STUBFAIL="$T/failflag"
# dry-run changes nothing; missing/wrong sha refuses
"$D/update_xray.sh" --version v9.9.9 --asset Xray-linux-64.zip --sha256 "$sha" 2>/dev/null
grep -q old < <("$T/binstall/xray" version)
if "$D/update_xray.sh" --version v9.9.9 --asset Xray-linux-64.zip 2>/dev/null; then echo "FAIL no sha accepted"; exit 1; fi
if "$D/update_xray.sh" --version v9.9.9 --asset Xray-linux-64.zip --sha256 "$(printf 0%.0s $(seq 64))" --apply 2>/dev/null; then echo "FAIL bad sha accepted"; exit 1; fi
grep -q old < <("$T/binstall/xray" version)
# successful update keeps the old binary
"$D/update_xray.sh" --version v9.9.9 --asset Xray-linux-64.zip --sha256 "$sha" --apply 2>"$T/up.log" || { cat "$T/up.log"; exit 1; }
grep -q new < <("$T/binstall/xray" version); grep -q old < <("$ETC/prev/xray" version)
# manual rollback restores the old binary
"$D/update_xray.sh" --rollback --apply 2>/dev/null
grep -q old < <("$T/binstall/xray" version)
# update whose health check fails (new binary never becomes active) -> automatic rollback
touch "$STUBFAIL"
if "$D/update_xray.sh" --version v9.9.9 --asset Xray-linux-64.zip --sha256 "$sha" --apply 2>/dev/null; then echo "FAIL expected failure"; exit 1; fi
grep -q old < <("$T/binstall/xray" version)
# ---- rotate safety: collisions, dest format, failed config / failed restart restore state ----
if "$D/rotate.sh" --port 9444 --apply >/dev/null 2>&1; then echo "FAIL port collision with path 2 accepted"; exit 1; fi
if "$D/rotate.sh" --port2 10443 --apply >/dev/null 2>&1; then echo "FAIL port collision with xhttp accepted"; exit 1; fi
if "$D/rotate.sh" --dest www.example.test --apply >/dev/null 2>&1; then echo "FAIL dest without port accepted"; exit 1; fi
before="$(cat "$ETC/reality.key")"; cfg_before="$(cat "$ETC/config.json")"
cp "$T/bin/xray" "$T/xray.good"; printf '#!/usr/bin/env bash\ncase "$1" in run) exit 1;; esac\n' >"$T/bin/xray"; chmod +x "$T/bin/xray"
if "$D/rotate.sh" --keys --dest www.apple.com:443 --apply >/dev/null 2>&1; then echo "FAIL rotate with rejected config succeeded"; exit 1; fi
cp "$T/xray.good" "$T/bin/xray"
[ "$(cat "$ETC/reality.key")" = "$before" ] && [ "$(cat "$ETC/config.json")" = "$cfg_before" ] || { echo "FAIL state not restored after rejected config"; exit 1; }
grep -q '^DEST=www.microsoft.com:443' "$ETC/settings.env" || { echo "FAIL settings not restored"; exit 1; }
ls "$ETC"/backup/* >/dev/null   # backups exist
touch "$STUBFAIL"; sed -i.bak 's/(new)/(old)/' "$T/binstall/xray" 2>/dev/null || true; rm -f "$T/binstall/xray.bak"
# make restart "never come up": is-active stub fails while flag exists and binary is "new"
printf '#!/usr/bin/env bash\ncase "$1" in is-active) [ ! -e "$STUBFAIL2" ];; *) echo "systemctl $*" >>"$STUBLOG";; esac\n' >"$T/bin/systemctl"; chmod +x "$T/bin/systemctl"
export STUBFAIL2="$T/fail2"; touch "$STUBFAIL2"; rm -f "$STUBFAIL"
if "$D/rotate.sh" --keys --apply >/dev/null 2>&1; then echo "FAIL rotate with dead service succeeded"; exit 1; fi
[ "$(cat "$ETC/reality.key")" = "$before" ] || { echo "FAIL keys not restored after failed restart"; exit 1; }
rm -f "$STUBFAIL2"

# ---- rollback of the added paths: back to the single-inbound config, vhost gone ----
"$D/add_paths.sh" --remove --apply 2>/dev/null
[ "$(grep -c '"protocol": "vless"' "$ETC/config.json")" = 1 ]
[ ! -e "$NGINX_VHOST_DIR/roxira-vpn-xhttp.conf" ]
[ "$("$D/subscription.sh" alice --plain 2>/dev/null | wc -l | tr -d ' ')" = 1 ]
echo "PASS"
