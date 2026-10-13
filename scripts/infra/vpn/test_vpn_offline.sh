#!/usr/bin/env bash
# Offline test: stub binaries via PATH; checks rendering, client mgmt, no secret leakage in logs.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/vpntest.XXXXXX")"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/etc/clients"
cat >"$T/bin/xray" <<'S'
#!/usr/bin/env bash
case "$1" in
  x25519) printf 'PrivateKey: STUBPRIVKEYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nPassword: STUBPUBKEYbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' ;;
  run) grep -q '"protocol": "vless"' "$4" ;;
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
echo "PASS"
