#!/usr/bin/env bash
# Deploy named services on the production host, with an automatic rollback
# to the previous image if the post-deploy healthcheck does not pass.
#
# Run this ON the production host (roxira-prod), inside /opt/roxira_platform,
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
#      then refreshes nginx and exits non-zero.
#   7. On success, refreshes nginx (recreated containers get new IPs; nginx
#      caches the old ones) and exits 0.
#
# nginx refresh: a plain `nginx -s reload` does NOT pick up a changed
# nginx.conf when the change arrived via `git pull`. The compose volume is a
# single-file bind mount (./output_apps/nginx_config/nginx.conf ->
# /etc/nginx/nginx.conf); git replaces that file with a new inode, but the
# container keeps the inode it was created with. So when nginx.conf changed
# between the previous and current HEAD, deploy.sh instead validates the new
# file inside the running container (docker cp to a temp path + nginx -t -c),
# recreates nginx_gateway (--no-deps --force-recreate) so the new inode is
# mounted, and verifies the running config matches. Only when nginx.conf did
# not change does it fall back to a cheap `nginx -s reload`.
#
# roxira_enterprise_frontend is a compose service now (migrated from the old
# `docker run` deployment); it is deployable like any other named service.
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
PROJECT_DIR="/opt/roxira_platform"
NGINX_SERVICE="nginx_gateway"
NGINX_CONTAINER="roxira_nginx_prod"
NGINX_CONF_PATH="output_apps/nginx_config/nginx.conf"
NGINX_CONF_LIVE="/etc/nginx/nginx.conf"
NGINX_CONF_CANDIDATE="/tmp/nginx.conf.deploy-candidate"
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
OLD_HEAD="$(git rev-parse HEAD)"
git fetch origin main || fail "git fetch failed"
git merge --ff-only origin/main || fail "git merge --ff-only failed (local main has diverged)"
NEW_HEAD="$(git rev-parse HEAD)"

# Detect whether nginx.conf changed in this fast-forward. A plain reload is
# useless then: the single-file bind mount keeps the old inode (see header).
NGINX_CONF_CHANGED=false
if [ "$OLD_HEAD" != "$NEW_HEAD" ] && ! git diff --quiet "$OLD_HEAD" "$NEW_HEAD" -- "$NGINX_CONF_PATH"; then
  NGINX_CONF_CHANGED=true
  log "nginx.conf changed between ${OLD_HEAD:0:12} and ${NEW_HEAD:0:12}"
fi

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

# Make the running nginx see the deployed config. When nginx.conf changed in
# this fast-forward, a reload is not enough (single-file bind mount keeps the
# old inode), so validate the new file inside the running container, recreate
# nginx_gateway to remount it, then verify the running config is the new one.
refresh_nginx() {
  if [ "$NGINX_CONF_CHANGED" != true ]; then
    docker exec "$NGINX_CONTAINER" nginx -s reload
    return $?
  fi

  log "validating new ${NGINX_CONF_PATH} inside ${NGINX_CONTAINER}"
  docker cp "$NGINX_CONF_PATH" "${NGINX_CONTAINER}:${NGINX_CONF_CANDIDATE}" || return 1
  docker exec "$NGINX_CONTAINER" nginx -t -c "$NGINX_CONF_CANDIDATE" || return 1

  log "recreating ${NGINX_SERVICE} to remount nginx.conf (new inode)"
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "$NGINX_SERVICE" || return 1

  # The incident was diagnosed with `docker exec ... grep` returning zero for
  # the new block; mirror that here for a line this deploy added, and also
  # require the running file to be byte-identical to the deployed one.
  local added_marker
  added_marker="$(git diff -U0 "$OLD_HEAD" "$NEW_HEAD" -- "$NGINX_CONF_PATH" | grep -E '^\+[^+]' | head -n1 | cut -c2- || true)"
  if [ -n "$added_marker" ]; then
    docker exec "$NGINX_CONTAINER" grep -qF -e "$added_marker" "$NGINX_CONF_LIVE" \
      || { log "${NGINX_CONTAINER} is missing a line added by this deploy: ${added_marker}"; return 1; }
  fi

  local live_sum new_sum
  live_sum="$(docker exec "$NGINX_CONTAINER" md5sum "$NGINX_CONF_LIVE" | awk '{print $1}')"
  new_sum="$(md5sum "$NGINX_CONF_PATH" | awk '{print $1}')"
  docker exec "$NGINX_CONTAINER" rm -f "$NGINX_CONF_CANDIDATE" || true
  if [ -z "$live_sum" ] || [ "$live_sum" != "$new_sum" ]; then
    log "running nginx.conf does not match the deployed file (old inode still mounted?)"
    return 1
  fi

  log "${NGINX_SERVICE}: recreated and running the new nginx.conf"
  return 0
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
  refresh_nginx || log "warning: nginx refresh failed after rollback"
  fail "deploy aborted and rolled back because ${FAILED_SERVICE} failed its healthcheck"
fi

log "all services healthy; refreshing nginx"
refresh_nginx || fail "nginx refresh failed"

log "deploy OK: ${SERVICES[*]}"
