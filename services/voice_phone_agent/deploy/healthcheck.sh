#!/bin/bash
# Phone stack health check for roxira-ci. Prints OK/FAIL lines only (no env, keys, numbers or IPs).
# Run as root (sudo phone-stack status) or as a docker-group user. Exit 1 when any check fails.
set -u
CONTAINERS=${PHONE_CONTAINERS:-"lk-redis lk-server lk-sip lk-sabanet-bridge"}
UNITS="voice-ai-tts voice-ai-agent"
BRIDGE=${PHONE_SIP_BRIDGE:-lk-sabanet-bridge}
fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }

for c in $CONTAINERS; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then ok "container $c"; else bad "container $c"; fi
done
for u in $UNITS; do
  s=$(systemctl is-active "$u" 2>/dev/null); [ "$s" = active ] && ok "unit $u" || bad "unit $u ($s)"
done

code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' --noproxy '*' http://127.0.0.1:7880/ 2>/dev/null)
[ "$code" = 200 ] && ok "livekit http" || bad "livekit http ($code)"

code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' --noproxy '*' http://127.0.0.1:5055/health 2>/dev/null)
[ "$code" = 200 ] && ok "tts sidecar health" || bad "tts sidecar health ($code)"

# Synthetic path: sidecar -> proxy -> Microsoft TTS -> mp3 bytes back.
bytes=$(curl -s -m 25 --noproxy '*' -H 'Content-Type: application/json' \
  -d '{"text":"سلام، آزمون سلامت خط تلفن."}' http://127.0.0.1:5055/tts 2>/dev/null | wc -c)
[ "${bytes:-0}" -gt 1000 ] && ok "synthetic tts path (${bytes} bytes)" || bad "synthetic tts path (${bytes:-0} bytes)"

# SIP registration of the carrier bridge, one word. Only the status word is printed.
reg=$(docker exec "$BRIDGE" asterisk -rx 'pjsip show registrations' 2>/dev/null \
  | grep -oE 'Registered|Unregistered|Rejected|Failed|Stopped|Retry Wait' | head -1 | tr -d ' ')
[ -n "$reg" ] || reg=none
[ "$reg" = Registered ] && ok "sip registration $reg" || bad "sip registration $reg"

# Carrier contact qualify (OPTIONS every qualify_frequency s keep the carrier's UDP/NAT path open;
# without it inbound INVITEs are dropped by the host firewall). Only the status word is printed:
# the Contact lines carry the carrier address, so they never leave this pipe.
AOR=${PHONE_SIP_AOR:-sabanet_aor}
qual=$(docker exec "$BRIDGE" asterisk -rx 'pjsip show contacts' 2>/dev/null \
  | grep -E "^[[:space:]]*Contact:[[:space:]]+$AOR/" \
  | grep -owE 'Avail|Unavail|NonQual|Unknown|Created|Removed' | head -1)
[ -n "$qual" ] || qual=none
[ "$qual" = Avail ] && ok "carrier contact qualify $qual" || bad "carrier contact qualify $qual"

# Cost and abuse caps audit (T298 / R30)
COST_SCRIPT="/usr/local/lib/phone-stack/check_phone_costs.py"
[ -f "$COST_SCRIPT" ] || COST_SCRIPT="$(dirname "$0")/../../../scripts/ops/ci_box/check_phone_costs.py"
if [ -f "$COST_SCRIPT" ]; then
  if python3 "$COST_SCRIPT" --check 2>/dev/null; then
    ok "phone cost and abuse caps"
  else
    bad "phone cost or abuse cap alert triggered"
  fi
fi

exit $fail
