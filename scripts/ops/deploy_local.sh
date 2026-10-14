#!/usr/bin/env bash
# Owner-run, LOCAL deploy driver for the production host (GitHub Actions is off).
# Runs on the owner's Mac; reaches the server only through the owner's existing
# ssh config (alias or host in DEPLOY_SSH_HOST). Never prints secret values.
#
# Usage:
#   scripts/ops/deploy_local.sh eval-baseline [--yes]   # retrieval gate on the server; --yes stores the baseline
#   scripts/ops/deploy_local.sh check
#   scripts/ops/deploy_local.sh plan
#   scripts/ops/deploy_local.sh deploy [--yes]     # dry-run unless --yes
#   scripts/ops/deploy_local.sh rollback [--yes]   # dry-run unless --yes
#   scripts/ops/deploy_local.sh migrate [--yes]    # prod DB migration; dry-run unless --yes
#   scripts/ops/deploy_local.sh migrate-rollback <dump> [--yes]   # restore a pg_dump backup
#
# See docs/ops/DEPLOY_LOCAL.md. L4: owner-only (CODEOWNERS /scripts/ops/).
set -euo pipefail

SSH_HOST="${DEPLOY_SSH_HOST:-${ROXIRA_HOST:-roxira-prod}}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/roxira_platform}"
STATE_DIR="${DEPLOY_STATE_DIR:-/root/deploy-state}"   # outside the git tree
COMPOSE="docker-compose.prod.yml"
DOMAINS="${DEPLOY_DOMAINS:-ghazihoushmand.ir roxira.net roxira.ir}"
CHAT_DOMAIN="${DEPLOY_CHAT_DOMAIN:-ghazihoushmand.ir}"
API_PATH="${DEPLOY_SMOKE_API_PATH:-/api/v1/apps/judge/pricing/plans}"
REQUIRED_ENV="GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET ADMIN_HEALTH_KEY JWT_SECRET KAVENEGAR_API_KEY"
FREEZE_FILE=".deploy-freeze"
# Owner opt-in marker for the server-side autodeploy timer. Only read by
# confirm_read() below; see docs/ops/AUTODEPLOY.md.
AUTO_CONFIRM_MARKER="${DEPLOY_AUTO_CONFIRM_MARKER:-/etc/roxira/autodeploy.enabled}"
PG_CONTAINER="roxira_postgres_prod"
BACKEND_CONTAINER="roxira_enterprise_backend"
DB_USER="enterprise_admin"          # same literals as docker-compose.prod.yml
DB_NAME="enterprise_db"
MIG_DIR="output_apps/enterprise_hub/migrations"
DATA_SOURCE="output_apps/enterprise_hub/data-source.ts"
BACKUP_DIR="$STATE_DIR/db-backups"
MIGRATE_WORK="$STATE_DIR/migrate-work"
# One-off container: image built from the `deps` stage of the enterprise_hub Dockerfile (full
# npm ci, so ts-node + typeorm CLI exist; the runner image has neither). Migration files,
# data-source.ts and tsconfig.json come from the archive export of origin/main and are
# bind-mounted read-only. Command is the package.json script "migration:run".
HUB_DIR="output_apps/enterprise_hub"
MIGRATE_CMD="${DEPLOY_MIGRATE_CMD:-npm run migration:run}"
# Tables the CRM tenant migration (AddCrmTenantIsolation) must add tenant_id to.
VERIFY_TABLES="crm_leads contact_messages"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
usage() { sed -n '2,14p' "$0" >&2; exit 2; }

# ssh -n: stdin from /dev/null. Without it, ssh drains the script's stdin and swallows the
# typed confirmation. No rsh call pipes local data in, so none needs the real stdin.
# DEPLOY_SSH_HOST=local runs the command ON THIS HOST with `bash -c` instead of ssh; that is
# how the server-side autodeploy timer reuses this script (it then runs as root on the server).
rsh() {
  if [ "$SSH_HOST" = "local" ]; then
    bash -c "$*" </dev/null
  else
    ssh -n "${SSH_OPTS[@]}" "$SSH_HOST" "$@"
  fi
}

# Human confirmation. Reads the controlling terminal so piped or ssh input cannot answer it;
# stdin is used only when there is no terminal at all. The caller compares CONFIRM_INPUT.
# The ONE automatic path is the server-side autodeploy timer: it may answer from
# DEPLOY_AUTO_CONFIRM, but only when it runs as root ON the server (DEPLOY_SSH_HOST=local)
# and the owner opted in via the marker file. Everywhere else the answer is still typed.
confirm_read() {  # confirm_read <prompt>
  CONFIRM_INPUT=""
  if [ -n "${DEPLOY_AUTO_CONFIRM:-}" ] \
    && [ "$SSH_HOST" = "local" ] \
    && [ "$(id -u)" = "0" ] \
    && [ -e "$AUTO_CONFIRM_MARKER" ]; then
    CONFIRM_INPUT="$DEPLOY_AUTO_CONFIRM"
    log "auto-confirmed by autodeploy"
    return 0
  fi
  if { : </dev/tty; } 2>/dev/null; then
    read -r -p "$1" CONFIRM_INPUT </dev/tty || true
  else
    read -r -p "$1" CONFIRM_INPUT || true
  fi
}
rgit() { rsh "cd '$REMOTE_DIR' && git $*"; }
rcompose() { rsh "cd '$REMOTE_DIR' && docker compose -f $COMPOSE $*"; }

local_root() { git rev-parse --show-toplevel 2>/dev/null || die "run inside the repo checkout"; }

fetch_target() {
  git fetch -q origin main || die "git fetch origin main failed"
  TARGET_SHA="$(git rev-parse origin/main)"
  TARGET_SHORT="$(git rev-parse --short=8 origin/main)"
  MIGRATE_IMAGE="roxira-migrate:$TARGET_SHORT"
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

# Smoke checks run FROM THE SERVER (still through the public domain / Cloudflare), so the
# result does not depend on the operator's network: from an Iranian IP without VPN,
# Cloudflare geo-redirects roxira.net and the checks fail although the site is fine.
SMOKE_UA="RoxiraDeploy/1.0"
http_code() { rsh "curl -s -o /dev/null -m 15 -A '$SMOKE_UA' -w '%{http_code}' $(printf '%q' "$1")" || true; }
# Final status after following redirects (Cloudflare may redirect a domain, e.g. roxira.net -> roxira.ir).
http_code_final() { rsh "curl -sL --max-redirs 5 -o /dev/null -m 20 -A '$SMOKE_UA' -w '%{http_code}' $(printf '%q' "$1")" || true; }
http_body() { rsh "curl -s -m 15 -A '$SMOKE_UA' $(printf '%q' "$1")" || true; }

# The app warms its embedder on start; wait (bounded) until /health answers 200.
wait_ready() {
  local i code=""
  for i in $(seq 1 30); do
    code="$(http_code "https://$CHAT_DOMAIN/health")"
    [ "$code" = "200" ] && { log "ready after $((i*3))s"; return 0; }
    sleep 3
  done
  log "not ready after 90s (last /health $code)"
}

smoke_test() {
  local ok=0 d code body status routers
  wait_ready
  # /health is served only on the Smart Judge host (the other hosts route it elsewhere: 404 is normal).
  code="$(http_code "https://$CHAT_DOMAIN/health")"
  if [ "$code" = "200" ]; then log "smoke ok: $CHAT_DOMAIN/health 200"; else log "smoke FAIL: $CHAT_DOMAIN/health $code"; ok=1; fi
  body="$(http_body "https://$CHAT_DOMAIN/health")"
  status="$(printf '%s' "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  routers="$(printf '%s' "$body" | python3 -c 'import sys,json;r=json.load(sys.stdin).get("loaded_routers");print(len(r) if hasattr(r,"__len__") else r)' 2>/dev/null || true)"
  if [ "$status" = "ONLINE" ]; then log "smoke ok: status ONLINE, routers=$routers"; else log "smoke FAIL: status='$status'"; ok=1; fi
  for d in $DOMAINS; do
    code="$(http_code_final "https://$d/admin")"
    if [ "$code" = "404" ]; then log "smoke ok: $d/admin 404"; else log "smoke FAIL: $d/admin $code (want 404)"; ok=1; fi
  done
  code="$(http_code "https://$CHAT_DOMAIN/chat")"
  if [ "$code" = "200" ]; then log "smoke ok: $CHAT_DOMAIN chat page 200"; else log "smoke FAIL: $CHAT_DOMAIN/chat $code"; ok=1; fi
  code="$(http_code "https://$CHAT_DOMAIN$API_PATH")"
  if [ "$code" = "200" ]; then log "smoke ok: GET $API_PATH 200"; else log "smoke FAIL: GET $API_PATH $code"; ok=1; fi
  return "$ok"
}

# Non-blocking retrieval accuracy gate (docs/legal/LAWYER_REVIEW_GATE_FA.md). Runs the retrieval-only
# eval (no LLM, 0 USD) on the SERVER in a one-off container next to Qdrant, same pattern as
# scripts/legal/build_v3_on_server.sh step 4, and compares retrieval@5 with the stored baseline.
# It only reports: a failure or a drop never blocks or rolls back a deploy.
# The deploy script is usually run from a /tmp copy (git show ... > /tmp/deploy_local.sh), so never
# resolve the gate relative to the script. The scorer comes from origin/main (fetched by every deploy);
# the baseline from DEPLOY_EVAL_BASELINE or the local checkout.
gate_script() {  # extracts the scorer + its sibling eval_chat_golden.py from origin/main into a temp tree; prints legal_gate.py path
  local d; d="$(mktemp -d "${TMPDIR:-/tmp}/legal_gate.XXXXXX")" || return 1
  mkdir -p "$d/scripts/eval" &&
    git show origin/main:scripts/eval/legal_gate.py >"$d/scripts/eval/legal_gate.py" 2>/dev/null &&
    git show origin/main:scripts/eval_chat_golden.py >"$d/scripts/eval_chat_golden.py" 2>/dev/null ||
    return 1  # the temp dir is left in TMPDIR; the OS cleans it
  printf '%s\n' "$d/scripts/eval/legal_gate.py"
}
GATE_BASELINE="${DEPLOY_EVAL_BASELINE:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)/data/eval/chat_golden/legal_gate_baseline.json}"
gate_retrieval_json() {  # prints the 'LEGAL_GATE_JSON {...}' line from the server
  rsh "cd '$REMOTE_DIR' && IMG=\$(docker inspect -f '{{.Config.Image}}' roxira_app_prod) &&
    COLL=\$(docker exec roxira_app_prod printenv LIGHTRAG_QDRANT_COLLECTION || true) &&
    timeout 600 docker run --rm --network container:roxira_qdrant_prod --volumes-from roxira_app_prod \\
      -v '$REMOTE_DIR:/repo:ro' -w /repo -e QDRANT_HOST=127.0.0.1 -e QDRANT_PORT=6333 -e PYTHONDONTWRITEBYTECODE=1 \\
      \${COLL:+-e LIGHTRAG_QDRANT_COLLECTION=\$COLL} \$IMG python3 scripts/eval/legal_gate.py retrieval --json 2>/dev/null |
    grep '^LEGAL_GATE_JSON '"
}
eval_gate_report() {
  [ "${DEPLOY_EVAL_GATE:-1}" = "1" ] || return 0
  local out line
  out="$(gate_retrieval_json)" || { log "legal gate: retrieval run failed or timed out (non-blocking)"; return 0; }
  [ -n "$out" ] || { log "legal gate: WARNING the eval produced no report line (script missing or crashed; non-blocking)"; return 0; }
  local gs; gs="$(gate_script)" || { log "legal gate: scorer not found on origin/main (non-blocking)"; return 0; }
  printf '%s\n' "$out" | python3 "$gs" compare --baseline "$GATE_BASELINE" --current - |
    while IFS= read -r line; do log "$line"; done || true
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
    log "$d /admin -> $(http_code_final "https://$d/admin") (want 404 after redirects)"
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
  if [ -n "$m" ]; then log "WARNING: migration files in the diff (deploy will refuse; apply with the migrate subcommand):"; printf '%s\n' "$m"; fi
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
    # Migration files in the diff are fine only when every one is a TypeORM file already recorded
    # as applied on the server (the migrate subcommand did it). Anything else (pending, unreadable
    # table, raw .sql) still refuses: deploy never runs migrations.
    pending_migrations
    if [ "$APPLIED_OK" = 0 ] || [ "${#PENDING[@]}" -gt 0 ] || grep -qvE "^$MIG_DIR/[0-9]+-.+\.ts\$" <<<"$m"; then
      printf '%s\n' "$m"
      die "migration files in the diff are not all applied. deploy never runs migrations: run 'scripts/ops/deploy_local.sh migrate' (dry-run first, then --yes), then deploy again"
    fi
    log "migration files in the diff are all recorded as applied on the server; continuing"
  fi
  print_plan
  local miss v names; miss="$(missing_env)"
  if [ -n "$miss" ]; then log "env NAMES missing on server:"; printf '  %s\n' $miss; fi
  names="$(env_names_server)"
  for v in $REQUIRED_ENV; do
    grep -qx "$v" <<<"$names" || die "required env name $v is missing on the server .env"
  done
  local dirty
  dirty="$(rgit status --short | tr -d '\r')" || die "cannot read the server git status"
  if [ -n "$dirty" ]; then
    log "WARNING: server working tree is NOT clean; deploy --yes will refuse. Offending paths (status + name only):"
    printf '%s\n' "$dirty"
  fi
  if [ "$yes" != "--yes" ]; then log "dry-run only. Re-run with --yes to execute."; return 0; fi

  confirm_read "Type the short commit SHA ($TARGET_SHORT) to confirm: "
  [ "$CONFIRM_INPUT" = "$TARGET_SHORT" ] || die "SHA mismatch; aborting"
  compute_services
  local svcs="${SERVICES[*]:-}"

  # Refuse early with the offending paths named. Nothing is deleted or moved here.
  dirty="$(rgit status --short | tr -d '\r')" || die "cannot read the server git status"
  if [ -n "$dirty" ]; then
    printf '%s\n' "$dirty" >&2
    die "server working tree is not clean; the paths above block deploy (status + name only). Nothing was changed. Move them out of $REMOTE_DIR yourself (for example .env backups go to /root/env-backups/), then retry"
  fi

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
    eval_gate_report || true
    log "deploy OK: $TARGET_SHORT"
    local svc_list="${svcs:-none}"; svc_list="${svc_list// /,}"
    printf 'DEPLOYED %s services=%s smoke=ok\n' "$TARGET_SHORT" "$svc_list"
    echo "rollback to ${DEPLOYED_SHA:0:8}: scripts/ops/deploy_local.sh rollback --yes"
  else
    log "smoke test FAILED; rolling back automatically"
    do_rollback_remote || die "AUTO-ROLLBACK FAILED; manual attention needed"
    smoke_test || die "still failing after rollback; manual attention needed"
    die "deploy rolled back to previous deployment"
  fi
}

# ---------------------------------------------------------------- migrations
# Owner-run, L4. Operates on the production database. Never auto-restores.

list_migration_files() {  # file names in the target tree, oldest first
  git ls-tree --name-only "$TARGET_SHA" "$MIG_DIR/" | sed 's#.*/##' | grep -E '^[0-9]+-.+\.ts$' | sort || true
}

# Sets PENDING (files not recorded in the TypeORM "migrations" table) and APPLIED_OK.
pending_migrations() {
  local applied="" f ts rest name
  PENDING=(); APPLIED_OK=1
  if ! applied="$(rsh "docker exec $PG_CONTAINER psql -U $DB_USER -d $DB_NAME -tAc \"SELECT name FROM migrations\"" 2>/dev/null)"; then
    APPLIED_OK=0; applied=""
  fi
  applied="$(tr -d '\r' <<<"$applied")"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    ts="${f%%-*}"; rest="${f#*-}"; name="${rest%.ts}${ts}"   # TypeORM name = ClassName + timestamp
    grep -qxF "$name" <<<"$applied" || PENDING+=("$f")
  done < <(list_migration_files)
  return 0
}

restore_cmd() {  # the exact command that restores dump $1 (run on the server)
  printf "docker exec -i %s pg_restore -U %s -d %s --clean --if-exists --no-owner --single-transaction < %s" \
    "$PG_CONTAINER" "$DB_USER" "$DB_NAME" "$1"
}

print_migrate_plan() {
  echo "Target:   $TARGET_SHORT ($TARGET_SHA)"
  echo "Pending TypeORM migrations ($MIG_DIR):"
  if [ "${#PENDING[@]}" -eq 0 ]; then echo "  (none)"; else printf '  %s\n' "${PENDING[@]}"; fi
  if [ "$APPLIED_OK" = 0 ]; then
    echo "  WARNING: could not read the 'migrations' table on the server; the real run will refuse."
  fi
  echo "Steps on $SSH_HOST (one-off container; database container $PG_CONTAINER):"
  echo "  1. refuse if $FREEZE_FILE exists (local or server) or the server tree is dirty"
  echo "  2. preflight: $PG_CONTAINER and $BACKEND_CONTAINER running; DB user, credential and name present in the backend env"
  echo "  3. archive of $TARGET_SHORT (Dockerfile, package files, tsconfig, data-source.ts, migrations) -> $MIGRATE_WORK"
  echo "     docker build --target deps -t $MIGRATE_IMAGE (server checkout is NOT changed; deploy is a separate step)"
  echo "  4. pg_dump -Fc inside $PG_CONTAINER -> $BACKUP_DIR/<timestamp>.dump; verify with pg_restore --list"
  echo "  5. docker run --rm --network <network of $PG_CONTAINER> --env-file <DB credentials from the backend env, never printed>"
  echo "     -e DATABASE_HOST=$PG_CONTAINER -e DATABASE_PORT=5432 $MIGRATE_IMAGE $MIGRATE_CMD"
  echo "  6. remove the one-off image, env file and work dir"
  echo "  7. verify via psql that tenant_id exists and is NOT NULL on: $VERIFY_TABLES"
  echo "  8. on any failure: print the restore command; NO automatic restore"
}

migrate_cleanup() {  # best effort; removes secrets file, work dir and the one-off image
  rsh "rm -rf '$MIGRATE_WORK'; docker image rm -f '$MIGRATE_IMAGE' >/dev/null 2>&1 || true" || true
}

verify_tenant_columns() {
  local out t
  out="$(rsh "docker exec $PG_CONTAINER psql -U $DB_USER -d $DB_NAME -tAc \"SELECT table_name||':'||is_nullable FROM information_schema.columns WHERE column_name='tenant_id' AND table_name IN ('crm_leads','contact_messages') ORDER BY 1\"" | tr -d '\r')" || return 1
  for t in $VERIFY_TABLES; do
    if grep -qx "$t:NO" <<<"$out"; then log "verify ok: $t.tenant_id exists, NOT NULL"
    else log "verify FAIL: $t.tenant_id missing or nullable"; return 1; fi
  done
}

cmd_migrate() {
  local yes="${1:-}"
  check_freeze
  fetch_target
  pending_migrations
  print_migrate_plan
  if [ "$yes" != "--yes" ]; then log "dry-run only. Re-run with --yes to execute."; return 0; fi
  [ "$APPLIED_OK" = 1 ] || die "cannot read the migrations table on the server; refusing to guess what is pending"
  if [ "${#PENDING[@]}" -eq 0 ]; then log "no pending migrations; nothing to do"; return 0; fi

  confirm_read "This changes the PRODUCTION DATABASE. Type the short commit SHA ($TARGET_SHORT) to confirm: "
  [ "$CONFIRM_INPUT" = "$TARGET_SHORT" ] || die "SHA mismatch; aborting"

  log "preflight + one-off image build ($MIGRATE_IMAGE)"
  rsh "set -euo pipefail; cd '$REMOTE_DIR'
    [ -z \"\$(git status --porcelain)\" ] || { echo 'server working tree not clean' >&2; exit 1; }
    [ \"\$(docker inspect -f '{{.State.Running}}' $PG_CONTAINER)\" = true ] || { echo '$PG_CONTAINER not running' >&2; exit 1; }
    [ \"\$(docker inspect -f '{{.State.Running}}' $BACKEND_CONTAINER)\" = true ] || { echo '$BACKEND_CONTAINER not running' >&2; exit 1; }
    umask 077
    w='$MIGRATE_WORK'; rm -rf \"\$w\"; mkdir -p \"\$w\"
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $BACKEND_CONTAINER | grep -E '^DATABASE_(USER|PASSW[A-Z]*|NAME)=' > \"\$w/db.env\" || true
    [ \"\$(wc -l < \"\$w/db.env\")\" -eq 3 ] || { echo 'DB user/credential/name not all set in the backend container env' >&2; exit 1; }
    git fetch -q origin main
    git archive '$TARGET_SHA' $HUB_DIR/Dockerfile $HUB_DIR/package.json $HUB_DIR/package-lock.json $HUB_DIR/tsconfig.json $DATA_SOURCE $MIG_DIR | tar -x -C \"\$w\"
    docker build -q --target deps -t '$MIGRATE_IMAGE' \"\$w/$HUB_DIR\" >/dev/null" \
    || { migrate_cleanup; die "preflight/build failed; nothing was changed and no backup was taken"; }

  local ts dump
  ts="$(date '+%Y%m%d-%H%M%S')"; dump="$BACKUP_DIR/$ts.dump"
  log "backup -> $SSH_HOST:$dump"
  rsh "set -euo pipefail; umask 077; mkdir -p '$BACKUP_DIR'
    docker exec $PG_CONTAINER pg_dump -U $DB_USER -d $DB_NAME -Fc > '$dump'
    [ -s '$dump' ] || { echo 'backup file is empty' >&2; exit 1; }
    docker exec -i $PG_CONTAINER pg_restore --list < '$dump' | head -n 1 >/dev/null
    echo \"backup size: \$(stat -c %s '$dump') bytes\"" \
    || { migrate_cleanup; die "backup failed; the migration was NOT run. Remove the partial file $dump on the server if present"; }

  log "running migration in a one-off container from $MIGRATE_IMAGE"
  local rc=0
  rsh "set -euo pipefail
    w='$MIGRATE_WORK'; h=\"\$w/$HUB_DIR\"
    net=\$(docker inspect -f '{{range \$k, \$v := .NetworkSettings.Networks}}{{println \$k}}{{end}}' $PG_CONTAINER | head -n 1)
    [ -n \"\$net\" ] || { echo 'cannot discover the network of $PG_CONTAINER' >&2; exit 1; }
    docker run --rm --network \"\$net\" --env-file \"\$w/db.env\" \
      -e DATABASE_HOST=$PG_CONTAINER -e DATABASE_PORT=5432 -e TS_NODE_TRANSPILE_ONLY=true \
      -v \"\$h/data-source.ts:/app/data-source.ts:ro\" -v \"\$h/tsconfig.json:/app/tsconfig.json:ro\" \
      -v \"\$h/migrations:/app/migrations:ro\" -w /app \
      '$MIGRATE_IMAGE' $MIGRATE_CMD" || rc=$?
  migrate_cleanup
  if [ "$rc" -ne 0 ]; then
    log "MIGRATION FAILED (rc=$rc). NOT restoring automatically. To restore the pre-migration backup, run on $SSH_HOST:"
    echo "  $(restore_cmd "$dump")"
    echo "  (or: scripts/ops/deploy_local.sh migrate-rollback $dump --yes)"
    die "migration failed; database may be partially changed; decide on restore manually"
  fi

  if ! verify_tenant_columns; then
    log "POST-MIGRATION VERIFY FAILED. NOT restoring automatically. To restore, run on $SSH_HOST:"
    echo "  $(restore_cmd "$dump")"
    die "verification failed"
  fi
  log "migrate OK. Backup kept at $SSH_HOST:$dump. Next: scripts/ops/deploy_local.sh deploy"
}

cmd_migrate_rollback() {
  local dump="${1:-}" yes="${2:-}"
  [ -n "$dump" ] || usage
  case "$dump" in
    "$BACKUP_DIR"/[0-9]*.dump) ;;
    *) die "dump must be a file like $BACKUP_DIR/<timestamp>.dump" ;;
  esac
  case "$dump" in *[!A-Za-z0-9/._-]*|*..*) die "dump path has unsafe characters" ;; esac
  rsh "test -s '$dump'" || die "dump not found or empty on the server: $dump"
  log "restore plan on $SSH_HOST (replaces objects in $DB_NAME with the dump contents; data written after the dump is lost):"
  echo "  $(restore_cmd "$dump")"
  log "stop writers first if you can: docker compose -f $COMPOSE stop $BACKEND_CONTAINER"
  if [ "$yes" != "--yes" ]; then log "dry-run: pass --yes to restore"; return 0; fi
  local base; base="${dump##*/}"
  confirm_read "This OVERWRITES the PRODUCTION DATABASE. Type the dump file name ($base) to confirm: "
  [ "$CONFIRM_INPUT" = "$base" ] || die "name mismatch; aborting"
  rsh "set -euo pipefail; docker exec -i $PG_CONTAINER pg_restore -U $DB_USER -d $DB_NAME --clean --if-exists --no-owner --single-transaction < '$dump'" \
    || die "restore failed; manual attention needed"
  log "restore OK from $dump"
}

cmd_eval_baseline() {
  local out; out="$(gate_retrieval_json)" || die "retrieval gate run failed on the server (is scripts/eval/legal_gate.py deployed there?)"
  if [ "${1:-}" = "--yes" ]; then
    local gs; gs="$(gate_script)" || die "legal gate scorer not found on origin/main"
    printf '%s\n' "$out" | python3 "$gs" capture --out "$GATE_BASELINE"
    echo "commit it: git add data/eval/chat_golden/legal_gate_baseline.json"
  else
    local gc; gc="$(gate_script)" || die "legal gate scorer not found on origin/main"
    printf '%s\n' "$out" | python3 "$gc" compare --baseline "$GATE_BASELINE" --current -
    echo "dry run: nothing written. Re-run with --yes to store this run as the baseline."
  fi
}

[ "$#" -ge 1 ] || usage
sub="$1"; shift
case "$sub" in
  check) cmd_check ;;
  plan) cmd_plan ;;
  deploy) cmd_deploy "${1:-}" ;;
  rollback) cmd_rollback "${1:-}" ;;
  migrate) cmd_migrate "${1:-}" ;;
  migrate-rollback) cmd_migrate_rollback "${1:-}" "${2:-}" ;;
  eval-baseline) cmd_eval_baseline "${1:-}" ;;
  *) usage ;;
esac
