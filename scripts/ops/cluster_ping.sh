#!/usr/bin/env bash
# List collections on every Zilliz and Qdrant Cloud cluster, so idle free clusters stay active and each key is proven.
# Reads ZILLIZ_ENDPOINT_<n>, ZILLIZ_TOKEN_<n>, QDRANT_CLOUD_URL[_<n>], QDRANT_CLOUD_API_KEY[_<n>] from the
# environment or $ROXIRA_ENV_FILE (default ~/Secrets/roxira/roxira.env).
# Prints only the cluster number, HTTP status and collection count, never a key or endpoint.
set -uo pipefail

ENV_FILE="${ROXIRA_ENV_FILE:-$HOME/Secrets/roxira/roxira.env}"
if [ -r "$ENV_FILE" ]; then
  while IFS='=' read -r name value; do
    export "$name=$value"
  done < <(grep -E '^(ZILLIZ_(ENDPOINT|TOKEN)_[1-9]|QDRANT_CLOUD_(URL|API_KEY)(_[2-9])?)=' "$ENV_FILE")
fi

found=0
failed=0
for n in 1 2 3 4 5 6 7 8 9; do
  endpoint_var="ZILLIZ_ENDPOINT_$n"
  token_var="ZILLIZ_TOKEN_$n"
  endpoint="${!endpoint_var:-}"
  token="${!token_var:-}"
  [ -n "$endpoint" ] && [ -n "$token" ] || continue
  found=$((found + 1))
  body="$(mktemp)"
  # The header goes through stdin so the token never appears in the process list.
  status="$(printf 'Authorization: Bearer %s\n' "$token" | curl -sS -m 30 -o "$body" -w '%{http_code}' \
    -H @- -H 'Content-Type: application/json' -d '{}' "${endpoint%/}/v2/vectordb/collections/list" 2>/dev/null)"
  result="$(python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
    print("code=%s collections=%d" % (d.get("code"), len(d.get("data") or [])))
except Exception:
    print("unreadable response")' "$body")"
  rm -f "$body"
  echo "cluster $n: http=${status:-none} $result"
  case "$result" in code=0\ *) ;; *) failed=$((failed + 1)) ;; esac
done

for suffix in "" _2 _3 _4 _5 _6 _7 _8 _9; do
  url_var="QDRANT_CLOUD_URL$suffix"
  key_var="QDRANT_CLOUD_API_KEY$suffix"
  url="${!url_var:-}"
  key="${!key_var:-}"
  [ -n "$url" ] && [ -n "$key" ] || continue
  found=$((found + 1))
  status="$(printf 'api-key: %s\n' "$key" | curl -sS -m 30 -o /dev/null -w '%{http_code}' -H @- "${url%/}/collections" 2>/dev/null)"
  echo "qdrant${suffix:-_1}: http=${status:-none}"
  [ "$status" = 200 ] || failed=$((failed + 1))
done

echo "clusters: $found, failed: $failed"
[ "$found" -gt 0 ] && [ "$failed" -eq 0 ]
