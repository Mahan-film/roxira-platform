#!/usr/bin/env bash
# Smoke-test roxira-research: /health then one short PUBLIC outline research.
# Never prints secrets. Usage: bash smoke.sh   (env: RESEARCH_URL, RESEARCH_TOKEN)
set -euo pipefail
BASE="${RESEARCH_URL:-http://127.0.0.1:8090}"
QUERY='مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی'

log() { printf '[research-smoke] %s\n' "$*"; }

auth=()
if [ -n "${RESEARCH_TOKEN:-}" ]; then
  auth=(-H "Authorization: Bearer ${RESEARCH_TOKEN}")
fi

health="$(curl -fsS ${auth[@]+"${auth[@]}"} "$BASE/health")"
log "health: $health"
printf '%s' "$health" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' || { log "health check failed"; exit 1; }

payload="$(python3 - "$QUERY" <<'PY'
import json, sys
print(json.dumps({"query": sys.argv[1], "report_type": "outline_report"}))
PY
)"

response="$(curl -fsS ${auth[@]+"${auth[@]}"} \
  -H 'Content-Type: application/json' -d "$payload" "$BASE/research")"

python3 - "$response" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
report = data.get("report_markdown") or ""
sources = data.get("sources") or []
print(f"sources: {len(sources)}")
print(f"duration_s: {data.get('duration_s')}")
print("report (first 300 chars):")
print(report[:300])
PY
