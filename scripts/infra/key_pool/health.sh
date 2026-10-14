#!/usr/bin/env bash
# Probe every provider (direct, 5-token prompt) and each gateway group; prints ok/429/fail per provider.
# Never prints keys. On the server:  bash scripts/infra/key_pool/health.sh
# Env: KEYPOOL_SRC_ENV (default /opt/roxira_platform/.env), AGENT_GATEWAY_URL (default http://127.0.0.1:4000/v1).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENVF="${KEYPOOL_SRC_ENV:-/opt/roxira_platform/.env}"
[ -r "$ENVF" ] || ENVF="$HOME/Secrets/roxira/roxira.env"
export KEYPOOL_ENV_FILE="$ENVF"

# The `embeddings` group speaks /v1/embeddings (not /chat/completions) and needs no key,
# so llm_pool's generic chat health cannot probe it. Hide the group from those calls and
# check it separately below; otherwise the keyless deployment would break the direct loop.
CHAT_POOL="$(mktemp)"
trap 'rm -f "$CHAT_POOL"' EXIT
PYTHONPATH="$HERE" python3 - "$CHAT_POOL" <<'PY'
import sys
import yaml

import keypool_config as k
pool = k.load_pool()
pool["groups"].pop("embeddings", None)
with open(sys.argv[1], "w", encoding="utf-8") as fh:
    yaml.safe_dump(pool, fh)
PY
export KEYPOOL_CONFIG="$CHAT_POOL"

echo "== direct providers (agent-free, private) =="
python3 "$HERE/../../dev/llm_pool.py" --health --direct || true
echo "== gateway groups =="
GW="${AGENT_GATEWAY_URL:-http://127.0.0.1:4000/v1}"
python3 "$HERE/../../dev/llm_pool.py" --health --gateway "$GW" || true

echo "== embeddings group (local TEI, BAAI/bge-m3) =="
KEYPOOL_SRC_ENV="$ENVF" PYTHONPATH="$HERE" python3 - "$GW" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

import keypool_config as k
pool = k.load_pool()
got = k.parse_env_names(os.environ["KEYPOOL_SRC_ENV"], k.all_key_names(pool))
key = got.get(pool["gateway"]["master_key_env"], "")
req = urllib.request.Request(
    sys.argv[1].rstrip("/") + "/embeddings",
    data=json.dumps({"model": "embeddings", "input": "سلام"}).encode(),
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=45) as r:
        print(f"group embeddings   {'ok' if r.status == 200 else 'fail'}")
except urllib.error.HTTPError as e:
    print(f"group embeddings   {'429' if e.code == 429 else 'fail'}")
except OSError:
    print("group embeddings   fail")
PY
