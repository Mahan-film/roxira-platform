#!/usr/bin/env bash
# Install/start roxira-research on the SERVER (127.0.0.1:8090). Dry-run by default.
#   install.sh            show what would happen (port check, env file, build/run plan)
#   install.sh --apply    build the image and start the container
# Run on the server from the repo checkout. Reads $RESEARCH_SRC_ENV
# (default /opt/roxira_platform/.env) for ${...} interpolation; values are never printed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="$HERE/docker-compose.research.yml"
ENV_FILE="${RESEARCH_SRC_ENV:-/opt/roxira_platform/.env}"
PORT=8090
PROJECT=roxira-research
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
log() { printf '[research] %s\n' "$*"; }
die() { printf '[research] ERROR: %s\n' "$*" >&2; exit 1; }

# Port guard (AGENTS.md section 7): refuse when 8090 is busy, unless it is our own container.
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx roxira_research; then
    log "port $PORT is held by our own roxira_research: upgrade in place"
  else
    die "port $PORT is busy (ss -tlnp | grep :$PORT); not touching it"
  fi
fi

[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE (set RESEARCH_SRC_ENV)"

if [ "$APPLY" != 1 ]; then
  log "would build $HERE and start roxira_research on 127.0.0.1:$PORT"
  log "env-file: $ENV_FILE"
  log "dry-run only. Re-run with --apply to install."
  exit 0
fi

# Both hostnames must resolve from inside the new container.
for net in roxira-keypool_default research; do
  docker network inspect "$net" >/dev/null 2>&1 \
    || die "network $net missing (start the key pool and docker/research-stack first)"
done

docker compose --env-file "$ENV_FILE" -f "$COMPOSE" -p "$PROJECT" build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" -p "$PROJECT" up -d
log "up. Check: bash $HERE/smoke.sh"
