#!/usr/bin/env bash
# Owner-run, LOCAL deploy driver for the production host (GitHub Actions is off).
# Runs on the owner's Mac; reaches the server only through the owner's existing
# ssh config (alias or host in DEPLOY_SSH_HOST). Never prints secret values.
#
# Usage:
#   scripts/ops/deploy_local.sh check
#   scripts/ops/deploy_local.sh plan
#   scripts/ops/deploy_local.sh deploy [--yes]     # dry-run unless --yes
#   scripts/ops/deploy_local.sh rollback [--yes]   # dry-run unless --yes
#
# See docs/ops/DEPLOY_LOCAL.md. L4: owner-only (CODEOWNERS /scripts/ops/).
set -euo pipefail

SSH_HOST="${DEPLOY_SSH_HOST:-5.75.200.67}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/roxira_platform}"
STATE_DIR="${DEPLOY_STATE_DIR:-/root/deploy-state}"   # outside the git tree
COMPOSE="docker-compose.prod.yml"
DOMAINS="${DEPLOY_DOMAINS:-ghazihoushmand.ir roxira.net roxira.ir}"
CHAT_DOMAIN="${DEPLOY_CHAT_DOMAIN:-ghazihoushmand.ir}"
API_PATH="${DEPLOY_SMOKE_API_PATH:-/api/v1/apps/judge/pricing/plans}"
REQUIRED_ENV="GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET ADMIN_HEALTH_KEY JWT_SECRET KAVENEGAR_API_KEY"
FREEZE_FILE=".deploy-freeze"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
usage() { sed -n '2,12p' "$0" >&2; exit 2; }

rsh() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@"; }
rgit() { rsh "cd '$REMOTE_DIR' && git $*"; }
rcompose() { rsh "cd '$REMOTE_DIR' && docker compose -f $COMPOSE $*"; }

local_root() { git rev-parse --show-toplevel 2>/dev/null || die "run inside the repo checkout"; }

fetch_target() {
  git fetch -q origin main || die "git fetch origin main failed"
  TARGET_SHA="$(git rev-parse origin/main)"
  TARGET_SHORT="$(git rev-parse --short=8 origin/main)"
  DEPLOYED_SHA="$(rgit rev-parse HEAD | tr -d '\r')"
  [ -n "$DEPLOYED_SHA" ] || die "cannot read the deployed commit"
  git cat-file -e "${DEPLOYED_SHA}^{commit}" 2>/dev/null \
    || die "deployed commit ${DEPLOYED_SHA:0:8} unknown locally; run git fetch --all"
  CHANGED="$(git diff --name-only "$DEPLOYED_SHA" "$TARGET_SHA")"
}

# Map changed files to the services that must be rebuilt/restarted.
compute_services() {
  SERVICES=()
  local f need_app=0 need_be=0 need_fe=0 need_nginx=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      output_apps/enterprise_hub/frontend/*) need_fe=1 ;;
      output_apps/enterprise_hub/*) need_be=1 ;;
      output_apps/nginx_config/*) need_nginx=1 ;;
      docker-compose.prod.yml) need_app=1; need_be=1; need_fe=1 ;;
      docs/*|*.md|src/*|tests/*|scripts/*|.github/*|.claude/*|config/*|.agents/*) ;;
      *) need_app=1 ;;
    esac
  done <<<"$CHANGED"
  if [ "$need_app" = 1 ]; then SERVICES+=(enterprise_app); fi
  if [ "$need_be" = 1 ]; then SERVICES+=(roxira_enterprise_backend); fi
  if [ "$need_fe" = 1 ]; then SERVICES+=(roxira_enterprise_frontend); fi
  NGINX_CHANGED="$need_nginx"
  return 0
}

migration_files() { grep -Ei '(^|/)migrations?/|\.sql$' <<<"$CHANGED" || true; }

env_names_needed() {  # NAMES ONLY, from the new code
  {
    git show "origin/main:$COMPOSE" 2>/dev/null | grep -o '\${[A-Z][A-Z0-9_]*' | tr -d '${' || true
    git show "origin/main:.env.example" 2>/dev/null | grep -E '^[A-Z][A-Z0-9_]*=' | cut -d= -f1 || true
    printf '%s\n' $REQUIRED_ENV
  } | sort -u
}

env_names_server() {
  rsh "cd '$REMOTE_DIR' && grep -E '^[A-Z][A-Z0-9_]*=' .env | cut -d= -f1" | tr -d '\r' | sort -u
}

missing_env() {
  comm -23 <(env_names_needed) <(env_names_server)
}

http_code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$1" || true; }

smoke_test() {
  local ok=0 d code body status routers
  # /health is served only on the Smart Judge host (the other hosts route it elsewhere: 404 is normal).
  code="$(http_code "https://$CHAT_DOMAIN/health")"
  if [ "$code" = "200" ]; then log "smoke ok: $CHAT_DOMAIN/health 200"; else log "smoke FAIL: $CHAT_DOMAIN/health $code"; ok=1; fi
  body="$(curl -s -m 15 "https://$CHAT_DOMAIN/health" || true)"
  status="$(printf '%s' "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  routers="$(printf '%s' "$body" | python3 -c 'import sys,json;r=json.load(sys.stdin).get("loaded_routers");print(len(r) if hasattr(r,"__len__") else r)' 2>/dev/null || true)"
  if [ "$status" = "ONLINE" ]; then log "smoke ok: status ONLINE, routers=$routers"; else log "smoke FAIL: status='$status'"; ok=1; fi
  for d in $DOMAINS; do
    code="$(http_code "https://$d/admin")"
    if [ "$code" = "404" ]; then log "smoke ok: $d/admin 404"; else log "smoke FAIL: $d/admin $code (want 404)"; ok=1; fi
  done
  code="$(http_code "https://$CHAT_DOMAIN/chat")"
  if [ "$code" = "200" ]; then log "smoke ok: $CHAT_DOMAIN chat page 200"; else log "smoke FAIL: $CHAT_DOMAIN/chat $code"; ok=1; fi
  code="$(http_code "https://$CHAT_DOMAIN$API_PATH")"
  if [ "$code" = "200" ]; then log "smoke ok: GET $API_PATH 200"; else log "smoke FAIL: GET $API_PATH $code"; ok=1; fi
  return "$ok"
}

check_freeze() {
  local root; root="$(local_root)"
  [ ! -e "$root/$FREEZE_FILE" ] || die "local $FREEZE_FILE exists: deploys are frozen"
  if rsh "test -e '$REMOTE_DIR/$FREEZE_FILE'"; then die "server $FREEZE_FILE exists: deploys are frozen"; fi
}

cmd_check() {
  fetch_target
  log "deployed on server:"; rgit log -1 --oneline
  log "origin/main:        $(git log -1 --oneline "$TARGET_SHA")"
  log "docker compose ps:"; rcompose ps --format '"table {{.Name}}\t{{.Status}}"' || true
  local d
  for d in $DOMAINS; do
    log "$d /admin -> $(http_code "https://$d/admin") (want 404)"
  done
  log "files changed deployed..origin/main:"
  if [ -n "$CHANGED" ]; then printf '%s\n' "$CHANGED"; else echo "(none)"; fi
  log "PRE-FLIGHT: env var NAMES needed by new code but missing on the server .env:"
  local miss; miss="$(missing_env)"
  if [ -n "$miss" ]; then
    local n
    for n in $miss; do
      case " $REQUIRED_ENV " in
        *" $n "*) printf '  REQUIRED-MISSING %s  (deploy will refuse)\n' "$n" ;;
        *) printf '  optional-missing %s\n' "$n" ;;
      esac
    done
  else echo "  none missing"; fi
  log "health: $CHAT_DOMAIN/health -> $(http_code "https://$CHAT_DOMAIN/health")"
  local m; m="$(migration_files)"
  if [ -n "$m" ]; then log "WARNING: migration files in the diff (deploy will refuse):"; printf '%s\n' "$m"; fi
  if [ -e "$(local_root)/$FREEZE_FILE" ]; then log "NOTE: local $FREEZE_FILE present"; fi
  return 0
}

print_plan() {
  compute_services
  echo "Target:   $TARGET_SHORT ($TARGET_SHA)"
  echo "Deployed: ${DEPLOYED_SHA:0:8}"
  echo "Steps on $SSH_HOST:$REMOTE_DIR:"
  echo "  1. refuse if $FREEZE_FILE exists (local or server); refuse if migrations in diff"
  echo "  2. require clean tree; record previous commit + tag current images :prev in $STATE_DIR"
  echo "  3. git fetch; git merge --ff-only $TARGET_SHORT"
  echo "  4. docker compose -f $COMPOSE config -q"
  if [ "${#SERVICES[@]}" -eq 0 ]; then
    echo "  5. no service rebuild needed (docs/tests/scripts only)"
  else
    echo "  5. build + up -d --no-deps: ${SERVICES[*]}"
  fi
  if [ "$NGINX_CHANGED" = 1 ]; then echo "  6. nginx.conf changed: recreate nginx_gateway"; else echo "  6. nginx -s reload"; fi
  echo "  7. smoke test; automatic rollback to ${DEPLOYED_SHA:0:8} if any check fails"
}

cmd_plan() {
  fetch_target
  print_plan
  local m; m="$(migration_files)"
  if [ -n "$m" ]; then echo "BLOCKED: migrations in diff:"; printf '%s\n' "$m"; fi
}

do_rollback_remote() {
  # Restores the commit and :prev images recorded by the last deploy.
  rsh "set -euo pipefail; cd '$REMOTE_DIR'
    [ -s '$STATE_DIR/prev_commit' ] || { echo 'no recorded previous commit' >&2; exit 1; }
    prev=\$(cat '$STATE_DIR/prev_commit')
    git reset --hard \"\$prev\"
    svcs=\$(cat '$STATE_DIR/services' 2>/dev/null || true)
    for s in \$svcs; do
      img=\$(cat '$STATE_DIR/image_'\$s 2>/dev/null || true)
      if [ -n \"\$img\" ] && docker image inspect \"\$img\" >/dev/null 2>&1; then
        repo=\${img%%:*}; docker tag \"\$img\" \"\$repo:latest\" || true
      fi
    done
    [ -z \"\$svcs\" ] || docker compose -f $COMPOSE up -d --no-deps \$svcs
    docker exec roxira_nginx_prod nginx -s reload || true
    echo \"rolled back to \$prev\""
}

cmd_rollback() {
  local yes="${1:-}"
  check_freeze
  local prev; prev="$(rsh "cat '$STATE_DIR/prev_commit' 2>/dev/null" || true)"
  [ -n "$prev" ] || die "no recorded previous deployment on the server"
  log "rollback target: $prev (services: $(rsh "cat '$STATE_DIR/services' 2>/dev/null" || true))"
  if [ "$yes" != "--yes" ]; then log "dry-run: pass --yes to roll back"; return 0; fi
  do_rollback_remote || die "rollback failed; manual attention needed"
  smoke_test || die "smoke test FAILED after rollback; manual attention needed"
  log "rollback OK"
}

cmd_deploy() {
  local yes="${1:-}"
  check_freeze
  fetch_target
  if [ "$DEPLOYED_SHA" = "$TARGET_SHA" ]; then log "server already at $TARGET_SHORT; nothing to do"; return 0; fi
  local m; m="$(migration_files)"
  if [ -n "$m" ]; then
    printf '%s\n' "$m"
    die "migration files in the diff. This script never runs migrations; review and apply them by hand, then deploy"
  fi
  print_plan
  local miss v names; miss="$(missing_env)"
  if [ -n "$miss" ]; then log "env NAMES missing on server:"; printf '  %s\n' $miss; fi
  names="$(env_names_server)"
  for v in $REQUIRED_ENV; do
    grep -qx "$v" <<<"$names" || die "required env name $v is missing on the server .env"
  done
  if [ "$yes" != "--yes" ]; then log "dry-run only. Re-run with --yes to execute."; return 0; fi

  local typed
  read -r -p "Type the short commit SHA ($TARGET_SHORT) to confirm: " typed
  [ "$typed" = "$TARGET_SHORT" ] || die "SHA mismatch; aborting"
  compute_services
  local svcs="${SERVICES[*]:-}"

  rsh "set -euo pipefail; cd '$REMOTE_DIR'
    [ -z \"\$(git status --porcelain)\" ] || { echo 'server working tree not clean' >&2; exit 1; }
    mkdir -p '$STATE_DIR'
    git rev-parse HEAD > '$STATE_DIR/prev_commit'
    printf '%s' '$svcs' > '$STATE_DIR/services'
    for s in $svcs; do
      cid=\$(docker compose -f $COMPOSE ps -q \$s || true)
      [ -n \"\$cid\" ] || continue
      img=\$(docker inspect --format '{{.Config.Image}}' \"\$cid\")
      docker tag \"\$img\" \"\${img%%:*}:prev\"
      printf '%s' \"\${img%%:*}:prev\" > '$STATE_DIR/image_'\$s
    done" || die "pre-deploy snapshot failed (nothing changed except state files)"

  local rc=0
  rsh "set -euo pipefail; cd '$REMOTE_DIR'
    git fetch origin main
    git merge --ff-only '$TARGET_SHA'
    docker compose -f $COMPOSE config -q
    if [ -n '$svcs' ]; then docker compose -f $COMPOSE build $svcs; docker compose -f $COMPOSE up -d --no-deps $svcs; fi
    if [ '$NGINX_CHANGED' = 1 ]; then docker compose -f $COMPOSE up -d --no-deps --force-recreate nginx_gateway
    else docker exec roxira_nginx_prod nginx -s reload; fi" || rc=$?
  if [ "$rc" -ne 0 ]; then
    log "remote deploy step failed (rc=$rc); rolling back"
    do_rollback_remote || die "AUTO-ROLLBACK FAILED; manual attention needed"
    die "deploy failed and was rolled back"
  fi

  log "waiting 20s for services to settle"; sleep 20
  if smoke_test; then
    log "deploy OK: $TARGET_SHORT"
  else
    log "smoke test FAILED; rolling back automatically"
    do_rollback_remote || die "AUTO-ROLLBACK FAILED; manual attention needed"
    smoke_test || die "still failing after rollback; manual attention needed"
    die "deploy rolled back to previous deployment"
  fi
}

[ "$#" -ge 1 ] || usage
sub="$1"; shift
case "$sub" in
  check) cmd_check ;;
  plan) cmd_plan ;;
  deploy) cmd_deploy "${1:-}" ;;
  rollback) cmd_rollback "${1:-}" ;;
  *) usage ;;
esac
