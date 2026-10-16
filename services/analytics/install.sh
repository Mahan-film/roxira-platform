#!/usr/bin/env bash
# Install Umami analytics on the SERVER (127.0.0.1:3005). Dry-run by default. Factory F7, see
# docs/ops/OBSERVABILITY.md.
#   install.sh            show every precondition and the plan; changes nothing (exit 0)
#   install.sh --apply    write generated/umami.env (mode 600), pull the pinned image, docker compose up -d
#
# Reads $UMAMI_SRC_ENV (default /opt/roxira_platform/.env) by parsing it. Only UMAMI_DB_PASSWORD and
# UMAMI_APP_SECRET are read; their values are never printed. Prerequisite: the `umami` database and user
# exist (one-time SQL in docs/ops/OBSERVABILITY.md). The nginx location snippet is NOT applied here.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_ENV="${UMAMI_SRC_ENV:-/opt/roxira_platform/.env}"
GEN="$HERE/generated"
ENV_OUT="$GEN/umami.env"
COMPOSE="$HERE/docker-compose.analytics.yml"
PORT=3005
NAME=roxira_umami
PG=roxira_postgres_prod

APPLY=0
case "${1:-}" in
  ""|--dry-run) ;;
  --apply) APPLY=1 ;;
  *) echo "usage: $0 [--dry-run | --apply]" >&2; exit 2 ;;
esac

log() { printf '[analytics] %s\n' "$*"; }
PROBLEMS=()
problem() { PROBLEMS+=("$*"); log "BLOCKER: $*"; }

# read_env NAME: value of NAME from SRC_ENV with surrounding quotes stripped; empty when absent.
read_env() {
  local line
  line="$(grep -E "^$1=" "$SRC_ENV" | head -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

[ -r "$SRC_ENV" ] || { log "ERROR: cannot read $SRC_ENV (set UMAMI_SRC_ENV)"; exit 1; }

# Secrets: alphanumeric only, so they can sit unquoted in the DATABASE_URL without escaping.
DB_PW="$(read_env UMAMI_DB_PASSWORD)"
APP_SECRET="$(read_env UMAMI_APP_SECRET)"
if [[ "$DB_PW" =~ ^[A-Za-z0-9]{16,}$ ]]; then log "UMAMI_DB_PASSWORD: set"; else problem "UMAMI_DB_PASSWORD missing or not alphanumeric >= 16 chars (generate: openssl rand -hex 24)"; fi
if [[ "$APP_SECRET" =~ ^[A-Za-z0-9]{16,}$ ]]; then log "UMAMI_APP_SECRET: set"; else problem "UMAMI_APP_SECRET missing or not alphanumeric >= 16 chars (generate: openssl rand -hex 32)"; fi

# Pinned image, read from the compose file so the tag lives in exactly one place.
IMAGE="$(sed -n 's/^ *image: *//p' "$COMPOSE" | head -n 1)"
log "image: ${IMAGE:-<none>}"

# Port guard (AGENTS.md section 7): refuse when 3005 is busy, unless it is our own container.
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$NAME"; then
    log "port $PORT is held by our own $NAME: upgrade in place"
  else
    problem "port $PORT is busy (ss -tlnp | grep $PORT); not touching it"
  fi
else
  log "port $PORT is free"
fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG"; then
  log "$PG is running"
else
  problem "$PG is not running"
fi

# Read-only check that the umami database exists (runs as the admin role inside the container).
DB_OK="$(docker exec "$PG" psql -U enterprise_admin -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='umami'" 2>/dev/null || true)"
if [ "$DB_OK" = "1" ]; then
  log "database umami exists"
else
  problem "database umami missing: run the one-time SQL in docs/ops/OBSERVABILITY.md (step 1)"
fi

if [ -n "$IMAGE" ] && docker manifest inspect "$IMAGE" >/dev/null 2>&1; then
  log "image tag resolves in the registry"
else
  problem "image $IMAGE not resolvable (docker manifest inspect); check the tag in docker-compose.analytics.yml"
fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  log "${#PROBLEMS[@]} blocker(s) listed above."
fi

if [ "$APPLY" != 1 ]; then
  log "dry-run only. Would write $ENV_OUT (mode 600, values not printed), pull $IMAGE,"
  log "run: docker compose -f $COMPOSE -p roxira-analytics up -d"
  log "NOT applied by this script: the nginx snippet in $HERE/nginx/umami-location.conf (owner approval)."
  log "Re-run with --apply once there are no blockers."
  exit 0
fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  log "ERROR: refusing to apply with blockers"
  exit 1
fi

umask 077
mkdir -p "$GEN"
printf 'DATABASE_URL=postgresql://umami:%s@%s:5432/umami\nAPP_SECRET=%s\n' "$DB_PW" "$PG" "$APP_SECRET" >"$ENV_OUT"
chmod 600 "$ENV_OUT"
log "wrote $ENV_OUT (mode 600)"

docker pull "$IMAGE" >/dev/null
docker compose -f "$COMPOSE" -p roxira-analytics up -d
log "up on 127.0.0.1:$PORT. Check: curl -fs http://127.0.0.1:$PORT/api/heartbeat"
log "NEXT: log in as admin/umami and CHANGE THE PASSWORD at once (Umami default), then create an API key"
log "NEXT: apply nginx/umami-location.conf to both public server blocks (owner approval)"
