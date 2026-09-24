#!/usr/bin/env bash
# Copy secrets that docker-compose.prod.yml used to hardcode into .env,
# taking the values the RUNNING containers use today, so nothing changes at
# runtime. Never prints secret values. Run on the server from the repo root:
#   bash scripts/ops/migrate_secrets_to_env.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=.env
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
cp -p "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"

# var -> container it is read from
declare -A SRC=(
  [SMS_IR_API_KEY]=roxira_app_prod
  [KAVENEGAR_API_KEY]=roxira_app_prod
  [OPENROUTER_API_KEY]=roxira_app_prod
  [KIRA_API_KEY]=roxira_app_prod
  [JWT_SECRET]=roxira_app_prod
  [POSTGRES_PASSWORD]=roxira_postgres_prod
)

for var in "${!SRC[@]}"; do
  if grep -qE "^${var}=.+" "$ENV_FILE"; then
    echo "[keep]    $var already set in .env"; continue
  fi
  val=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${SRC[$var]}" \
        | sed -n "s/^${var}=//p" | head -1)
  if [ -z "$val" ]; then echo "[MISSING] $var not found in ${SRC[$var]} - set it by hand"; continue; fi
  sed -i "/^${var}=\$/d" "$ENV_FILE"
  printf '%s=%s\n' "$var" "$val" >> "$ENV_FILE"
  echo "[copied]  $var from ${SRC[$var]}"
done

echo; echo "Validating compose interpolation..."
docker compose -f docker-compose.prod.yml config -q && echo "OK: all required variables resolve"
