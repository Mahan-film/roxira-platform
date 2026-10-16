#!/usr/bin/env bash
# Apply committed Drizzle migrations (./drizzle). Generate new ones with `npm run db:generate`
# and land them via a reviewed PR - never run ad-hoc schema changes on production.
#   scripts/migrate.sh           run in Docker (compose "migrate" service, uses the compose Postgres)
#   scripts/migrate.sh --local   run with local node_modules against $DATABASE_URL
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--local" ]; then
  : "${DATABASE_URL:?DATABASE_URL must be set}"
  exec npm run db:migrate
fi

docker compose up -d --wait postgres
docker compose --profile tools run --rm --build migrate
