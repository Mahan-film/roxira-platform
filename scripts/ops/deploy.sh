#!/usr/bin/env bash
# Deploy named services on the production host, with an automatic rollback
# to the previous image if the post-deploy healthcheck does not pass.
#
# Run this ON the production host (5.75.200.67), inside /opt/roxira_platform,
# as root. It does not ssh anywhere itself.
#
# Usage:
#   scripts/ops/deploy.sh <service> [service...]
#   scripts/ops/deploy.sh enterprise_app roxira_enterprise_backend
#
# What it does, per docs/STRATEGY.md section 7 (deploy runbook):
#   1. Requires a clean working tree, then fast-forwards main.
#   2. Validates docker-compose.prod.yml with `config -q`.
#   3. Tags the *current* image of each named service as ":prev" so a
#      rollback has something to go back to.
#   4. Builds and recreates only the named services (--no-deps).
#   5. Waits for each recreated container to report "healthy" (services
#      without a healthcheck are given a fixed grace period instead).
#   6. On failure, calls rollback.sh for every service this run touched,
#      then reloads nginx and exits non-zero.
#   7. On success, reloads nginx (recreated containers get new IPs; nginx
#      caches the old ones) and exits 0.
#
# roxira_enterprise_frontend is a compose service now (migrated from the old
# `docker run` deployment); it is deployable like any other named service.
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
PROJECT_DIR="/opt/roxira_platform"
NGINX_CONTAINER="roxira_nginx_prod"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-120}"   # seconds to wait for "healthy"
HEALTH_POLL="${DEPLOY_HEALTH_POLL:-3}"           # seconds between polls
NO_HEALTHCHECK_GRACE="${DEPLOY_NO_HEALTHCHECK_GRACE:-15}" # seconds, services without a healthcheck

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

if [ "$#" -eq 0 ]; then
  fail "usage: $0 <service> [service...]"
fi
SERVICES=("$@")

cd "$PROJECT_DIR" || fail "cannot cd to ${PROJECT_DIR}"

command -v docker >/dev/null 2>&1 || fail "docker not found"

log "checking working tree is clean"
if [ -n "$(git status --porcelain)" ]; then
  fail "working tree is not clean; commit, stash or discard changes before deploying"
fi

log "fast-forwarding main"
git fetch origin main || fail "git fetch failed"
git merge --ff-only origin/main || fail "git merge --ff-only failed (local main has diverged)"

log "validating ${COMPOSE_FILE}"
docker compose -f "$COMPOSE_FILE" config -q || fail "docker compose config -q failed"

# ---------------------------------------------------------------------------
# 1) Tag current images as :prev before touching anything, so rollback.sh has
#    a known-good image to restore per service.
# ---------------------------------------------------------------------------
declare -A PREV_IMAGE
for svc in "${SERVICES[@]}"; do
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" || true)"
  if [ -z "$cid" ]; then
    log "warning: ${svc} has no running container yet; nothing to tag as :prev"
    continue
  fi
  image="$(docker inspect --format '{{.Config.Image}}' "$cid")"
  prev_tag="${image%%:*}:prev"
  docker tag "$image" "$prev_tag" || fail "could not tag ${image} as ${prev_tag}"
  PREV_IMAGE["$svc"]="$prev_tag"
  log "tagged current ${svc} image (${image}) as ${prev_tag}"
done

# ---------------------------------------------------------------------------
# 2) Build and recreate only the named services.
# ---------------------------------------------------------------------------
log "building: ${SERVICES[*]}"
docker compose -f "$COMPOSE_FILE" build "${SERVICES[@]}" || fail "build failed"

log "recreating: ${SERVICES[*]}"
docker compose -f "$COMPOSE_FILE" up -d --no-deps "${SERVICES[@]}" || fail "up failed"

# ---------------------------------------------------------------------------
# 3) Wait for health. Roll back every touched service if any one fails.
# ---------------------------------------------------------------------------
wait_for_health() {
  local svc="$1"
  local cid healthy_status elapsed=0
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$svc")"
  [ -n "$cid" ] || { log "${svc}: no container after up -d"; return 1; }

  healthy_status="$(docker inspect --format '{{if .State.Health}}has-check{{else}}no-check{{end}}' "$cid")"
  if [ "$healthy_status" = "no-check" ]; then
    log "${svc}: no healthcheck defined, waiting ${NO_HEALTHCHECK_GRACE}s and checking it is still running"
    sleep "$NO_HEALTHCHECK_GRACE"
    [ "$(docker inspect --format '{{.State.Running}}' "$cid")" = "true" ] || { log "${svc}: container exited"; return 1; }
    return 0
  fi

  while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$cid")"
    case "$status" in
      healthy) log "${svc}: healthy"; return 0 ;;
      unhealthy) log "${svc}: reported unhealthy"; return 1 ;;
    esac
    sleep "$HEALTH_POLL"
    elapsed=$((elapsed + HEALTH_POLL))
  done
  log "${svc}: did not become healthy within ${HEALTH_TIMEOUT}s"
  return 1
}

FAILED_SERVICE=""
for svc in "${SERVICES[@]}"; do
  if ! wait_for_health "$svc"; then
    FAILED_SERVICE="$svc"
    break
  fi
done

if [ -n "$FAILED_SERVICE" ]; then
  log "deploy failed on ${FAILED_SERVICE}; rolling back all touched services"
  for svc in "${SERVICES[@]}"; do
    if [ -n "${PREV_IMAGE[$svc]:-}" ]; then
      "$(dirname "$0")/rollback.sh" "$svc" || log "warning: rollback of ${svc} also failed; needs manual attention"
    else
      log "warning: ${svc} had no :prev image to roll back to (first deploy?); leaving as-is"
    fi
  done
  docker exec "$NGINX_CONTAINER" nginx -s reload || log "warning: nginx reload failed after rollback"
  fail "deploy aborted and rolled back because ${FAILED_SERVICE} failed its healthcheck"
fi

log "all services healthy; reloading nginx"
docker exec "$NGINX_CONTAINER" nginx -s reload || fail "nginx reload failed"

log "deploy OK: ${SERVICES[*]}"
