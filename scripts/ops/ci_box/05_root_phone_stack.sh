#!/bin/bash
# roxira-ci root setup, part 5: Smart Judge phone stack under user "phone" (#959 T231).
# Run once as root, from the box hub's clone after the PR merged and `git fetch` ran:
#   sudo bash /home/mahanfilms/roxira-platform/scripts/ops/ci_box/05_root_phone_stack.sh
# What it does (prints file names and variable NAMES only, never contents or values):
#   1. extracts ~phone/voice-ai-bundle.tar.gz into /srv/data/phone/voice-ai (owner root, mode 700)
#      and keeps qualify_frequency=20 under the carrier AOR in its pjsip.conf (carrier NAT path)
#   2. moves ~phone/voice-ai-agent.env to /srv/data/phone/agent/.env (mode 600, owner phone)
#   3. builds the agent from origin/main services/voice_phone_agent into /srv/data/phone/agent
#      (npm ci && npm run build), creates the edge-tts venv, installs ffmpeg
#   4. installs voice-ai-agent / voice-ai-tts units (user phone), enabled, not started
#   5. installs root-owned /usr/local/bin/phone-stack up|down|status|logs and its health check
#   6. installs /etc/sudoers.d/phone-stack (validated with visudo -cf)
# Then: sudo phone-stack up && sudo phone-stack status
# Revert: phone-stack down; rm /usr/local/bin/phone-stack /etc/sudoers.d/phone-stack
#         /etc/systemd/system/voice-ai-{agent,tts}.service /usr/local/lib/phone-stack -r
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0"; exit 1; }

U=phone
UHOME=$(getent passwd $U | cut -d: -f6)
BASE=/srv/data/phone
STACK=$BASE/voice-ai
AGENT=$BASE/agent
VENV=$BASE/venv
REPO=${REPO:-/home/mahanfilms/roxira-platform}
BUNDLE=$UHOME/voice-ai-bundle.tar.gz
ENVSRC=$UHOME/voice-ai-agent.env
PROXY=http://127.0.0.1:10809
as_phone() { sudo -u $U -H env HTTPS_PROXY=$PROXY HTTP_PROXY=$PROXY https_proxy=$PROXY http_proxy=$PROXY \
  NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 "$@"; }

install -d -m 750 -o $U -g $U $BASE

echo "== 1. bundle -> $STACK"
if [ -f "$BUNDLE" ]; then
  LIST=$(tar -tzf "$BUNDLE")
  if echo "$LIST" | grep -qE '(^/|(^|/)\.\.(/|$))'; then echo "bundle has absolute or .. paths; refusing"; exit 1; fi
  echo "$LIST"
  STRIP=0
  first=$(echo "$LIST" | head -1 | cut -d/ -f1)
  if [ -n "$first" ] && [ "$first" != . ] && ! echo "$LIST" | grep -vqE "^$first(/|$)"; then STRIP=1; fi
  # Root-owned: the root wrapper runs docker compose on these files, so user phone must not edit them.
  install -d -m 700 -o root -g root $STACK
  tar -xzf "$BUNDLE" -C $STACK --no-same-owner --no-same-permissions --strip-components=$STRIP
  # Containers run as non-root users (Asterisk in lk-sabanet-bridge) and read their bind-mounted
  # configs directly, so the files must be world-readable. $STACK itself stays root:root 700,
  # so no host user other than root can reach them; nothing is writable except by root.
  chown -R root:root $STACK; chmod -R go-w,a+rX $STACK; chmod 700 $STACK
else
  echo "no bundle at ~$U (already extracted?)"; [ -d $STACK ] || { echo "and $STACK missing"; exit 1; }
fi

echo "== 1b. carrier qualify in the bundle's pjsip.conf"
# Carrier INVITEs come back over the UDP conntrack/NAT entry the REGISTER opened; ufw input is DROP,
# so once that entry expires inbound calls are dropped (pjsip keep_alive_interval covers TCP only).
# qualify_frequency=20 makes Asterisk send OPTIONS to the carrier every 20 s, keeping the path open.
# Written in place with `cat tmp > file`: the live file is a single-file bind mount, where sed -i
# (rename) fails with "Resource busy". Never print the file: it holds the carrier password.
# ensure_qualify <file> <aor>: exactly one qualify_frequency=20 right under [<aor>].
# Returns 0 = changed, 1 = already so, 2 = could not edit (the file is left untouched).
ensure_qualify() {
  local f=$1 aor=$2 t rc=1
  t=$(mktemp) || return 2
  awk -v aor="$aor" '
    /^[[:space:]]*\[/ {
      insec = ($0 ~ ("^[[:space:]]*\\[" aor "\\]"))
      print
      if (insec && !done) { print "qualify_frequency=20"; done = 1 }
      next
    }
    insec && /^[[:space:]]*qualify_frequency[[:space:]]*=/ { next }
    { print }
  ' "$f" > "$t" && [ -s "$t" ] || { rm -f "$t"; return 2; }
  if ! cmp -s "$t" "$f"; then cat "$t" > "$f" || rc=2; [ $rc = 2 ] || rc=0; fi
  rm -f "$t"
  return $rc
}
AOR=${PHONE_SIP_AOR:-sabanet_aor}
# grep exits 1 for a pjsip.conf without the section; `|| true` keeps set -e/pipefail from aborting here.
PJSIP=$(find $STACK -maxdepth 4 -type f -name pjsip.conf -exec grep -lE "^[[:space:]]*\[$AOR\]" {} + 2>/dev/null | head -1 || true)
if [ -z "$PJSIP" ]; then
  echo "WARN: no pjsip.conf with [$AOR] in the bundle; carrier qualify not set"
else
  qrc=0; ensure_qualify "$PJSIP" "$AOR" || qrc=$?
  case $qrc in
    0) echo "qualify_frequency=20 set under [$AOR] in ${PJSIP#$STACK/} (applies when the bridge container restarts)" ;;
    1) echo "qualify_frequency=20 already under [$AOR] in ${PJSIP#$STACK/}" ;;
    *) echo "WARN: could not edit ${PJSIP#$STACK/}; left unchanged, carrier qualify not set" ;;
  esac
fi
COMPOSE=""
for f in docker-compose.yml docker-compose.yaml compose.yaml compose.yml; do
  [ -f "$STACK/$f" ] && { COMPOSE="$STACK/$f"; break; }
done
[ -n "$COMPOSE" ] || COMPOSE=$(find $STACK -maxdepth 2 \( -name 'docker-compose.y*ml' -o -name 'compose.y*ml' \) | head -1)
[ -n "$COMPOSE" ] || { echo "no compose file in the bundle"; exit 1; }
echo "compose file: ${COMPOSE#$STACK/}"

echo "== 3a. agent source from origin/main"
git -c safe.directory="$REPO" -C "$REPO" rev-parse --verify -q origin/main >/dev/null || { echo "no origin/main in $REPO"; exit 1; }
install -d -m 750 -o $U -g $U $AGENT
git -c safe.directory="$REPO" -C "$REPO" archive origin/main services/voice_phone_agent \
  | sudo -u $U tar -x -C $AGENT --strip-components=2 --exclude='*/.env'
echo "agent source at origin/main $(git -c safe.directory="$REPO" -C "$REPO" rev-parse --short origin/main)"

echo "== 2. agent env -> $AGENT/.env"
if [ -f "$ENVSRC" ]; then
  install -m 600 -o $U -g $U "$ENVSRC" $AGENT/.env && rm -f "$ENVSRC"
  echo "moved"
else
  [ -f $AGENT/.env ] && echo "already in place" || { echo "no env file found"; exit 1; }
fi
chown $U:$U $AGENT/.env; chmod 600 $AGENT/.env
names=$(grep -oE '^[A-Z][A-Z0-9_]*=' $AGENT/.env | tr -d = | sort -u | tr '\n' ' ')
echo "variable names in .env: $names"
has() { grep -qE "^$1=.+" $AGENT/.env; }
for k in LIVEKIT_API_KEY LIVEKIT_API_SECRET; do has $k || echo "WARN: $k empty or missing"; done
has GROQ_API_KEY || has OPENAI_API_KEY || echo "WARN: no STT key (GROQ_API_KEY / OPENAI_API_KEY) in .env"
has SMARTJUDGE_PHONE_GATEWAY_KEY || has SMARTJUDGE_TOKEN || echo "WARN: no Smart Judge key in .env"
if has SECRETS_ENV_FILE; then
  sf=$(grep -E '^SECRETS_ENV_FILE=' $AGENT/.env | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')
  [ -f "$sf" ] || echo "WARN: SECRETS_ENV_FILE points to a file that does not exist on this box"
fi

echo "== 3b. packages, build, venv"
if ! command -v ffmpeg >/dev/null || ! dpkg -s python3-venv >/dev/null 2>&1; then
  apt-get update -q >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg python3-venv >/dev/null
fi
( cd $AGENT && as_phone npm ci --no-audit --no-fund --loglevel=error && as_phone npm run build --silent )
[ -x $VENV/bin/python ] || as_phone python3 -m venv $VENV
as_phone $VENV/bin/pip install -q --disable-pip-version-check edge-tts aiohttp
echo "build OK"

echo "== 4. systemd units"
# Root-owned files come straight from origin/main, not from the phone-owned copy.
from_main() { git -c safe.directory="$REPO" -C "$REPO" show "origin/main:services/voice_phone_agent/deploy/$1"; }
for unit in voice-ai-agent.service voice-ai-tts.service; do
  T=$(mktemp); from_main $unit > "$T"; install -m 644 -o root -g root "$T" /etc/systemd/system/$unit; rm -f "$T"
done
systemctl daemon-reload
systemctl enable voice-ai-tts voice-ai-agent >/dev/null 2>&1
echo "units installed and enabled (not started)"

echo "== 5. phone-stack wrapper"
install -d -m 755 -o root -g root /usr/local/lib/phone-stack
T=$(mktemp); from_main healthcheck.sh > "$T"; install -m 755 -o root -g root "$T" /usr/local/lib/phone-stack/healthcheck.sh; rm -f "$T"
printf 'COMPOSE=%q\n' "$COMPOSE" > /usr/local/lib/phone-stack/phone-stack.conf
chmod 644 /usr/local/lib/phone-stack/phone-stack.conf
# Model registry for the agent (MODELS_YAML in voice-ai-agent.service); the agent copy has no repo tree.
git -c safe.directory="$REPO" -C "$REPO" show origin/main:config/models.yaml > /usr/local/lib/phone-stack/models.yaml
chown root:root /usr/local/lib/phone-stack/models.yaml; chmod 644 /usr/local/lib/phone-stack/models.yaml
TMP_BIN=$(mktemp)
cat > "$TMP_BIN" <<'WRAPPER'
#!/bin/bash
# phone-stack up|down|status|logs [lines]  (root-owned; run with sudo)
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
. /usr/local/lib/phone-stack/phone-stack.conf
DC=(docker compose -f "$COMPOSE" --project-directory "$(dirname "$COMPOSE")")
# Logs never show secrets, env lines, phone numbers or IP addresses.
scrub() {
  { grep -v -i -E 'key|secret|token|passw|bearer|authori|cookie|_env|environment' || true; } \
  | sed -E -e 's/(sip:|tel:)[^@ ;>]*/\1<user>/g' -e 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/x.x.x.x/g' \
           -e 's/\+?[0-9]{7,}/<num>/g'
}
case "${1:-status}" in
  up)
    if ! "${DC[@]}" pull -q --ignore-buildable >/dev/null 2>&1; then
      if /usr/local/bin/box-proxy status | grep -q 'docker direct'; then
        echo "image pull failed with docker direct; routing system-docker pulls through the box proxy"
        /usr/local/bin/box-proxy on >/dev/null
      fi
      "${DC[@]}" pull -q --ignore-buildable 2>&1 | scrub || true
    fi
    "${DC[@]}" up -d --build 2>&1 | scrub
    systemctl restart voice-ai-tts voice-ai-agent
    echo "up"
    ;;
  down)
    systemctl stop voice-ai-agent voice-ai-tts || true
    "${DC[@]}" down 2>&1 | scrub
    echo "down"
    ;;
  status)
    /usr/local/lib/phone-stack/healthcheck.sh
    ;;
  logs)
    n=${2:-100}; [[ "$n" =~ ^[0-9]{1,4}$ ]] || n=100
    echo "== containers"; "${DC[@]}" logs --no-color --tail "$n" 2>&1 | scrub
    echo "== units"; journalctl -u voice-ai-tts -u voice-ai-agent -n "$n" -o cat --no-pager 2>&1 | scrub
    ;;
  *) echo "usage: phone-stack up|down|status|logs [lines]" >&2; exit 2 ;;
esac
WRAPPER
install -m 0755 -o root -g root "$TMP_BIN" /usr/local/bin/phone-stack
rm -f "$TMP_BIN"

echo "== 6. /etc/sudoers.d/phone-stack"
TMP_SUDO=$(mktemp)
echo 'mahanfilms ALL=(root) NOPASSWD: /usr/local/bin/phone-stack' > "$TMP_SUDO"
if visudo -cf "$TMP_SUDO" >/dev/null; then
  install -m 0440 -o root -g root "$TMP_SUDO" /etc/sudoers.d/phone-stack; rm -f "$TMP_SUDO"
else
  rm -f "$TMP_SUDO"; echo "sudoers rejected by visudo; nothing installed"; exit 1
fi
visudo -c >/dev/null && echo "sudoers OK"
echo "done. Next: sudo phone-stack up && sudo phone-stack status"
