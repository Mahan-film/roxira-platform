#!/usr/bin/env bash
# Probe every provider (direct, 5-token prompt) and each gateway group; prints ok/429/fail per provider.
# Never prints keys. On the server:  bash scripts/infra/key_pool/health.sh
# Env: KEYPOOL_SRC_ENV (default /opt/roxira_platform/.env), AGENT_GATEWAY_URL (default http://127.0.0.1:4000/v1).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENVF="${KEYPOOL_SRC_ENV:-/opt/roxira_platform/.env}"
[ -r "$ENVF" ] || ENVF="$HOME/Secrets/roxira/roxira.env"
export KEYPOOL_ENV_FILE="$ENVF"
echo "== direct providers (agent-free, private) =="
python3 "$HERE/../../dev/llm_pool.py" --health --direct || true
echo "== gateway groups =="
GW="${AGENT_GATEWAY_URL:-http://127.0.0.1:4000/v1}"
python3 "$HERE/../../dev/llm_pool.py" --health --gateway "$GW" || true
