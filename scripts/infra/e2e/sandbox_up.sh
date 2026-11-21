#!/usr/bin/env bash
# Build an isolated E2E sandbox of the business app from a git ref (Gate 3).
#
#   sandbox_up.sh <git-ref> [KEEP]
#
# Builds the backend and frontend images from <git-ref>, starts a throwaway postgres:17 + redis + backend +
# frontend on an --internal docker network (no internet, no route to prod), loads the production database
# SCHEMA ONLY (no rows) plus the migrations ledger, runs the ref's new migrations, creates test users and
# seeds one tenant with the data_import fixture. The frontend is reachable ONLY on 127.0.0.1:$RX_E2E_PORT.
#
# On success the sandbox is left running and $RX_OUT/app_e2e.env is written (see README.md); tear down with
# sandbox_down.sh. On failure everything is removed, unless the second argument is KEEP (debugging).
# Idempotent: a previous sandbox (rxtest_* objects only) is removed first.
#
# Environment (all optional):
#   RX_E2E_PORT        host port for the frontend on 127.0.0.1 (default 3901)
#   RX_E2E_WORK        work dir (default ${TMPDIR:-/tmp}/rxtest)
#   RX_E2E_REPO        repo to build from (default: the repo this script lives in)
#   RX_SCHEMA_FILE     pre-dumped schema (from pg_dump --schema-only) instead of reading prod
#   RX_LEDGER_FILE     pre-dumped migrations ledger (pg_dump --data-only -t migrations); optional
#   RX_PROD_PG         prod postgres container to read the schema from (default roxira_postgres_prod)
#   RX_PROD_DB         prod database name (default enterprise_db)
#   RX_SOCAT_IMAGE     image for the port-forward proxy (default alpine/socat)
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REF="${1:-}"
KEEP="${2:-}"
[ -n "$REF" ] || rx_die "usage: sandbox_up.sh <git-ref> [KEEP]"
PORT="${RX_E2E_PORT:-3901}"
PROD_PG="${RX_PROD_PG:-roxira_postgres_prod}"
PROD_DB="${RX_PROD_DB:-enterprise_db}"
SOCAT_IMAGE="${RX_SOCAT_IMAGE:-alpine/socat}"

rx_need docker
rx_need git
rx_need tar
rx_need curl
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || rx_die "RX_E2E_PORT must be 1024-65535 (got '$PORT')"
case "$RX_RESERVED_PORTS" in *" $PORT "*) rx_die "port $PORT is reserved for a live service (AGENTS.md section 7)" ;; esac

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    for c in "$RX_BE" "$RX_FE"; do
      if docker inspect "$c" >/dev/null 2>&1; then
        rx_log "--- last log lines of $c ---"
        docker logs --tail 25 "$c" 2>&1 | cut -c1-240 >&2 || true
      fi
    done
    if [ "$KEEP" = KEEP ]; then
      rx_log "failed (exit $rc); KEEP given, sandbox left running. Remove with sandbox_down.sh"
    else
      rx_log "failed (exit $rc); removing the sandbox"
      rx_cleanup
    fi
  fi
}
trap on_exit EXIT

# --- 1. resolve the ref and extract sources (per-sha dir, reused when present) -------------------------------
SHA="$(rx_resolve_ref "$REF")" || rx_die "cannot resolve git ref '$REF' in $RX_REPO"
SHORT="${SHA:0:8}"
rx_log "ref $REF = $SHORT"

umask 077
mkdir -p "$RX_OUT"
chmod 700 "$RX_WORK" "$RX_OUT"
SRC="$RX_WORK/src_$SHORT"
if [ ! -f "$SRC/.extracted" ]; then
  mkdir -p "$SRC/be" "$SRC/fe"
  # Backend context = enterprise_hub without the (large) frontend; frontend context = the frontend dir.
  git -C "$RX_REPO" archive "$SHA" output_apps/enterprise_hub |
    tar -x -C "$SRC/be" --exclude='output_apps/enterprise_hub/frontend'
  git -C "$RX_REPO" archive "$SHA:output_apps/enterprise_hub/frontend" | tar -x -C "$SRC/fe"
  : >"$SRC/.extracted"
fi
BE_CTX="$SRC/be/output_apps/enterprise_hub"
FE_CTX="$SRC/fe"
FIXTURE_SRC="$BE_CTX/modules/data_import/__fixtures__/erp_multicurrency_small.sqlite"
[ -f "$FIXTURE_SRC" ] || rx_die "fixture missing in ref $SHORT: $FIXTURE_SRC"
cp "$FIXTURE_SRC" "$RX_OUT/erp_multicurrency_small.sqlite"

# --- 2. clean slate (own rxtest_* objects only) and port pre-flight (AGENTS.md section 7) --------------------
rx_cleanup
if rx_port_in_use "$PORT"; then rx_die "port $PORT is already in use on this host (pick another with RX_E2E_PORT)"; fi

# --- 3. images ------------------------------------------------------------------------------------------------
rx_log "building backend image"
docker build -q -t "rxtest-be:$SHORT" "$BE_CTX" >/dev/null || rx_die "backend image build failed"
docker build -q --target deps -t "rxtest-deps:$SHORT" "$BE_CTX" >/dev/null || rx_die "backend deps image build failed"
rx_log "building frontend image (NEST_API_ORIGIN=http://$RX_BE:3000)"
docker build -q -t "rxtest-fe:$SHORT" \
  --build-arg "NEST_API_ORIGIN=http://$RX_BE:3000" \
  --build-arg "JUDGE_API_ORIGIN=http://rxtest_nojudge:8000" \
  --build-arg "GIT_SHA=$SHORT" \
  "$FE_CTX" >/dev/null || rx_die "frontend image build failed"

# --- 4. network, postgres, redis (random secrets, in memory only) -----------------------------------------------
PGPW="$(rx_rand_hex 16)"
JWTS="$(rx_rand_hex 32)"
docker network create --internal --label rxtest=1 "$RX_NET" >/dev/null
docker run -d --name "$RX_PG" --network "$RX_NET" --label rxtest=1 \
  -e POSTGRES_USER=rx -e "POSTGRES_PASSWORD=$PGPW" -e POSTGRES_DB=rxtest \
  --tmpfs /var/lib/postgresql/data postgres:17-alpine >/dev/null
docker run -d --name "$RX_REDIS" --network "$RX_NET" --label rxtest=1 redis:7-alpine >/dev/null
ready=0
for _ in $(seq 1 90); do
  if docker exec "$RX_PG" psql -U rx -d rxtest -Atc "select 1" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || rx_die "postgres did not become ready"

# --- 5. production schema only (read-only pg_dump, or a pre-dumped file) ----------------------------------------
rx_log "loading schema"
if [ -n "${RX_SCHEMA_FILE:-}" ]; then
  [ -r "$RX_SCHEMA_FILE" ] || rx_die "cannot read RX_SCHEMA_FILE=$RX_SCHEMA_FILE"
  schema_stream() { cat "$RX_SCHEMA_FILE"; }
  ledger_stream() { if [ -n "${RX_LEDGER_FILE:-}" ]; then cat "$RX_LEDGER_FILE"; fi; }
else
  # READ-ONLY use of the production postgres container: pg_dump of the schema (no rows) and of the migrations
  # ledger table (migration names/timestamps only). Nothing is written to or restarted in prod.
  PROD_USER="$(docker exec "$PROD_PG" printenv POSTGRES_USER)" ||
    rx_die "cannot read the schema: container $PROD_PG not available (set RX_SCHEMA_FILE instead)"
  schema_stream() { docker exec "$PROD_PG" pg_dump -U "$PROD_USER" -d "$PROD_DB" --schema-only --no-owner --no-privileges; }
  ledger_stream() { docker exec "$PROD_PG" pg_dump -U "$PROD_USER" -d "$PROD_DB" --data-only --no-owner -t migrations; }
fi
schema_stream | docker exec -i "$RX_PG" psql -q -U rx -d rxtest -v ON_ERROR_STOP=1 >/dev/null 2>"$RX_WORK/schema.err" ||
  { tail -3 "$RX_WORK/schema.err" >&2; rx_die "loading the schema failed"; }
ledger_stream | docker exec -i "$RX_PG" psql -q -U rx -d rxtest >/dev/null 2>&1 || true

# --- 6. migrations of the ref that prod does not have yet ----------------------------------------------------------
rx_log "running new migrations"
docker run --rm --network "$RX_NET" -v "$BE_CTX:/src:ro" -w /app \
  -e DATABASE_HOST="$RX_PG" -e DATABASE_PORT=5432 -e DATABASE_USER=rx -e "DATABASE_PASSWORD=$PGPW" -e DATABASE_NAME=rxtest \
  "rxtest-deps:$SHORT" sh -c "cp -r /src/migrations /src/data-source.ts /src/tsconfig.json /src/package.json . && npm run migration:run" \
  >"$RX_WORK/migrate.log" 2>&1 || { grep -iE "error|fail" "$RX_WORK/migrate.log" | head -5 >&2; rx_die "migrations failed (see $RX_WORK/migrate.log)"; }
rx_log "new migrations: $(grep -o 'Migration [A-Za-z0-9]* has been executed successfully' "$RX_WORK/migrate.log" | tr '\n' ' ')"

# --- 7. backend ------------------------------------------------------------------------------------------------
docker run -d --name "$RX_BE" --network "$RX_NET" --label rxtest=1 \
  --cap-drop ALL --security-opt no-new-privileges \
  -e NODE_ENV=production -e PORT=3000 \
  -e DATABASE_HOST="$RX_PG" -e DATABASE_PORT=5432 -e DATABASE_USER=rx -e "DATABASE_PASSWORD=$PGPW" -e DATABASE_NAME=rxtest \
  -e REDIS_HOST="$RX_REDIS" -e REDIS_PORT=6379 -e "JWT_SECRET=$JWTS" -e "JWT_SECRET_KEY=$JWTS" \
  "rxtest-be:$SHORT" >/dev/null
ready=0
for _ in $(seq 1 60); do
  if docker logs "$RX_BE" 2>&1 | grep -q "successfully started"; then ready=1; break; fi
  [ "$(docker inspect -f '{{.State.Running}}' "$RX_BE")" = true ] || break
  sleep 2
done
[ "$ready" = 1 ] || rx_die "backend did not start"

# --- 8. frontend + loopback proxy ---------------------------------------------------------------------------------
docker run -d --name "$RX_FE" --network "$RX_NET" --label rxtest=1 \
  --cap-drop ALL --security-opt no-new-privileges --memory 800m \
  -e NODE_ENV=production -e PORT=3001 -e HOSTNAME=0.0.0.0 \
  -e "NEST_API_ORIGIN=http://$RX_BE:3000" -e JUDGE_API_ORIGIN=http://rxtest_nojudge:8000 \
  "rxtest-fe:$SHORT" >/dev/null
ready=0
for _ in $(seq 1 45); do
  if docker exec "$RX_FE" curl -fs -o /dev/null http://127.0.0.1:3001/; then ready=1; break; fi
  [ "$(docker inspect -f '{{.State.Running}}' "$RX_FE")" = true ] || break
  sleep 2
done
[ "$ready" = 1 ] || rx_die "frontend did not start"

# An --internal network cannot publish ports, so a tiny socat container is created on the default bridge
# (publishing ONLY 127.0.0.1:$PORT) and then also attached to the sandbox network.
docker create --name "$RX_PROXY" --label rxtest=1 --cap-drop ALL --security-opt no-new-privileges \
  -p "127.0.0.1:$PORT:3001" "$SOCAT_IMAGE" tcp-listen:3001,fork,reuseaddr "tcp:$RX_FE:3001" >/dev/null
docker network connect "$RX_NET" "$RX_PROXY"
docker start "$RX_PROXY" >/dev/null
ready=0
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/"; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || rx_die "frontend not reachable on 127.0.0.1:$PORT"

# --- 9. users and seed data -----------------------------------------------------------------------------------------
field() { sed -n "s/^$1=//p" | head -1; }
rx_log "creating users"
SEED_OUT="$("$E2E_DIR/mkuser.sh" seeded)"
SEED_TENANT="$(printf '%s\n' "$SEED_OUT" | field TENANT_ID)"
SEED_USER="$(printf '%s\n' "$SEED_OUT" | field USER_ID)"
"$E2E_DIR/mkuser.sh" import-chromium >/dev/null
"$E2E_DIR/mkuser.sh" import-webkit >/dev/null

rx_log "seeding the 'seeded' tenant with the fixture via the import API"
docker cp "$RX_OUT/erp_multicurrency_small.sqlite" "$RX_BE:/tmp/upload.bin"
if ! docker exec -i -w /app -e "T=$SEED_TENANT" -e "U=$SEED_USER" -e FN=erp_multicurrency_small.sqlite "$RX_BE" node - \
  <"$E2E_DIR/seed_import.js" >"$RX_WORK/seed.log" 2>&1; then
  tail -15 "$RX_WORK/seed.log" >&2
  rx_die "seeding failed (see $RX_WORK/seed.log)"
fi
grep -E '^(DONE|INSERTED|SKIPPED)' "$RX_WORK/seed.log" >&2 || true

# --- 10. hand-off file for run_app_e2e.sh / playwright -----------------------------------------------------------------
ENV_FILE="$RX_OUT/app_e2e.env"
{
  printf 'APP_E2E_BASE_URL=%q\n' "http://127.0.0.1:$PORT"
  printf 'APP_E2E_SESSION_FILE=%q\n' "$RX_OUT/session.seeded.json"
  printf 'APP_E2E_SESSION_FILE_IMPORT_CHROMIUM=%q\n' "$RX_OUT/session.import-chromium.json"
  printf 'APP_E2E_SESSION_FILE_IMPORT_WEBKIT=%q\n' "$RX_OUT/session.import-webkit.json"
  printf 'APP_E2E_FIXTURE=%q\n' "$RX_OUT/erp_multicurrency_small.sqlite"
  printf 'APP_E2E_SHA=%q\n' "$SHORT"
} >"$ENV_FILE"
rx_log "sandbox up: http://127.0.0.1:$PORT  (env file: $ENV_FILE)"
cat "$ENV_FILE"
