#!/usr/bin/env bash
# Install the self-hosted send-only mail relay (container roxira_mail) on the SERVER. Dry-run by default.
# See docs/ops/EMAIL_SETUP.md.
#   install.sh            show preconditions and the plan; changes nothing (exit 0)
#   install.sh --apply    create DKIM keys if missing, start the container, print the DNS records and SMTP_* values
#
# Keys live in $MAIL_DKIM_DIR (default /var/lib/roxira-mail/dkim), outside the repo, mode 711/600, generated
# once and never overwritten. The private keys are never printed. No host port is published.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="$HERE/docker-compose.mail.yml"
export MAIL_DKIM_DIR="${MAIL_DKIM_DIR:-/var/lib/roxira-mail/dkim}"
NAME=roxira_mail
NETWORK=roxira_platform_roxira_net
IP=91.107.248.99
HELO=mail.ghazihoushmand.ir
SELECTOR=rx1
DOMAINS=(ghazihoushmand.ir roxira.ir)

APPLY=0
case "${1:-}" in
  ""|--dry-run) ;;
  --apply) APPLY=1 ;;
  *) echo "usage: $0 [--dry-run | --apply]" >&2; exit 2 ;;
esac

log() { printf '[mail] %s\n' "$*"; }
PROBLEMS=()
problem() { PROBLEMS+=("$*"); log "BLOCKER: $*"; }

command -v docker >/dev/null 2>&1 || problem "docker not found"
command -v openssl >/dev/null 2>&1 || problem "openssl not found"

IMAGE="$(sed -n 's/^ *image: *//p' "$COMPOSE" | head -n 1)"
log "image: ${IMAGE:-<none>}"
if [ -n "$IMAGE" ] && docker manifest inspect "$IMAGE" >/dev/null 2>&1; then
  log "image tag resolves in the registry"
else
  problem "image $IMAGE not resolvable (docker manifest inspect)"
fi

if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  log "network $NETWORK exists"
else
  problem "docker network $NETWORK missing (is the main stack up?)"
fi

# Nothing in this stack publishes a port (AGENTS.md section 7); refuse if someone added one.
if grep -Eq '^[[:space:]]*ports:' "$COMPOSE"; then problem "compose file publishes ports; a send-only relay must not"; fi

# Outbound port 25 (read-only probe).
if timeout 8 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' 2>/dev/null; then
  log "outbound port 25 reachable"
else
  problem "outbound port 25 blocked (probe gmail-smtp-in.l.google.com:25)"
fi

for d in "${DOMAINS[@]}"; do
  if [ -f "$MAIL_DKIM_DIR/$d.private" ]; then log "DKIM key exists for $d"; else log "DKIM key for $d: will be generated"; fi
done
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$NAME"; then log "$NAME already running: upgrade in place"; fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then log "${#PROBLEMS[@]} blocker(s) listed above."; fi

if [ "$APPLY" != 1 ]; then
  log "dry-run only. Would: mkdir -p $MAIL_DKIM_DIR (711); openssl genrsa 2048 per missing domain (600);"
  log "docker compose -f $COMPOSE -p roxira-mail up -d; then print DNS records and SMTP_* values."
  log "Re-run with --apply once there are no blockers."
  exit 0
fi
if [ "${#PROBLEMS[@]}" -gt 0 ]; then log "ERROR: refusing to apply with blockers"; exit 1; fi

umask 077
mkdir -p "$MAIL_DKIM_DIR"
chmod 711 "$MAIL_DKIM_DIR"   # opendkim (non-root) must traverse it; keys stay 600
for d in "${DOMAINS[@]}"; do
  if [ ! -f "$MAIL_DKIM_DIR/$d.private" ]; then
    openssl genrsa -out "$MAIL_DKIM_DIR/$d.private" 2048 2>/dev/null
    chmod 600 "$MAIL_DKIM_DIR/$d.private"
    log "generated 2048-bit DKIM key for $d"
  fi
done

docker pull "$IMAGE" >/dev/null
docker compose -f "$COMPOSE" -p roxira-mail up -d
sleep 8
docker ps --filter "name=$NAME" --format '[mail] container: {{.Names}} {{.Status}}'
docker logs --tail 40 "$NAME" 2>&1 | grep -iE 'dkim|error|fatal|warn' | sed 's/^/[mail][log] /' || true

echo
echo "================ DNS RECORDS TO ADD (at the DNS host of each domain) ================"
for d in "${DOMAINS[@]}"; do
  pub="$(openssl rsa -in "$MAIL_DKIM_DIR/$d.private" -pubout -outform DER 2>/dev/null | openssl base64 -A)"
  echo
  echo "--- $d ---"
  existing="$(dig +short TXT "$d" 2>/dev/null | grep -i 'v=spf1' || true)"
  if [ -n "$existing" ]; then
    echo "Existing SPF found: $existing"
    echo "  -> do NOT add a second SPF record. Edit it: insert 'ip4:$IP' before the final all-mechanism."
  else
    echo "SPF TXT  @  :  \"v=spf1 ip4:$IP -all\""
    echo "  (no SPF seen by dig; double-check: dig +short TXT $d | grep spf1)"
  fi
  echo "DKIM TXT ${SELECTOR}._domainkey.$d :"
  echo "  \"v=DKIM1; k=rsa; p=$pub\""
  echo "  (if the DNS panel limits a string to 255 chars, split it into two quoted strings; most panels do this)"
  echo "DMARC: keep the _dmarc record the owner already set (no change)."
done
echo
echo "--- host name ---"
echo "A  $HELO  ->  $IP"
echo "Hetzner rDNS (Cloud console > Servers > srv1 > Networking > IP > Edit reverse DNS): $IP -> $HELO"
echo
echo "================ /opt/roxira_platform/.env (restarting the app container needs owner OK) ================"
echo "SMTP_HOST=roxira_mail"
echo "SMTP_PORT=25"
echo "SMTP_USER="
echo "SMTP_PASSWORD="
echo "SMTP_FROM=\"قاضی هوشمند <no-reply@ghazihoushmand.ir>\""
echo
log "Verify DNS later: dig +short TXT ${SELECTOR}._domainkey.ghazihoushmand.ir ; dig +short -x $IP"
log "Send a test: docker exec -i roxira_app_prod python3 - you@example.com < $HERE/send_test.py"
