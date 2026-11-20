#!/usr/bin/env bash
# Roll a single service back to the image tagged ":prev" by deploy.sh.
#
# Run this ON the production host, inside /opt/roxira_platform, as root.
#
# Usage:
#   scripts/ops/rollback.sh <service>
#   scripts/ops/rollback.sh enterprise_app
#
# deploy.sh calls this automatically when a healthcheck fails. It is also
# meant to be run by hand: "the site is broken after a deploy, roll it back".
set -euo pipefail

PROJECT_DIR="/opt/roxira_platform"
COMPOSE_FILE="docker-compose.prod.yml"
# WAL-G overlay (T204): postgres_prod must keep archiving when /etc/roxira/walg.env exists, so include the overlay then.
COMPOSE_ARGS=(-f "$COMPOSE_FILE")
[ -r /etc/roxira/walg.env ] && [ -f "$PROJECT_DIR/docker-compose.walg.yml" ] && COMPOSE_ARGS+=(-f docker-compose.walg.yml)

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

if [ "$#" -ne 1 ]; then
  fail "usage: $0 <service>"
fi
SERVICE="$1"

cd "$PROJECT_DIR" || fail "cannot cd to ${PROJECT_DIR}"

command -v docker >/dev/null 2>&1 || fail "docker not found"

# Derive the image repo (everything before ":") from the service's current
# container, the same way deploy.sh derives it when it tags ":prev".
cid="$(docker compose "${COMPOSE_ARGS[@]}" ps -aq "$SERVICE" || true)"
[ -n "$cid" ] || fail "service ${SERVICE} has no container (running or stopped); nothing to roll back"
current_image="$(docker inspect --format '{{.Config.Image}}' "$cid")"
image_repo="${current_image%%:*}"

prev_tag="${image_repo}:prev"
docker image inspect "$prev_tag" >/dev/null 2>&1 || fail "no ${prev_tag} image found; deploy.sh must run at least once before a rollback is possible"

log "rolling back ${SERVICE} to ${prev_tag}"
docker tag "$prev_tag" "${image_repo}:latest" || fail "could not retag ${prev_tag} as ${image_repo}:latest"

docker compose "${COMPOSE_ARGS[@]}" up -d --no-deps "$SERVICE" || fail "up -d for ${SERVICE} failed during rollback"

log "waiting for ${SERVICE} to report healthy or stay running"
cid="$(docker compose "${COMPOSE_ARGS[@]}" ps -q "$SERVICE")"
elapsed=0
timeout="${ROLLBACK_HEALTH_TIMEOUT:-60}"
has_check="$(docker inspect --format '{{if .State.Health}}yes{{else}}no{{end}}' "$cid")"
if [ "$has_check" = "no" ]; then
  sleep 10
  [ "$(docker inspect --format '{{.State.Running}}' "$cid")" = "true" ] || fail "${SERVICE} exited after rollback; needs manual attention"
else
  while [ "$elapsed" -lt "$timeout" ]; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$cid")"
    [ "$status" = "healthy" ] && break
    if [ "$status" = "unhealthy" ]; then
      fail "${SERVICE} is still unhealthy after rollback to ${prev_tag}; needs manual attention"
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
fi

log "rollback of ${SERVICE} to ${prev_tag} complete"
log "reload nginx if this service sits behind it: docker exec roxira_nginx_prod nginx -s reload"
