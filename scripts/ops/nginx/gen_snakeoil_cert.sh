#!/usr/bin/env bash
# Generate the self-signed "snakeoil" certificate used ONLY by the nginx
# catch-all default_server (raw-IP / unknown-Host requests, answered with 444).
# Run on the server from the repo root, before (re)creating nginx_gateway.
#   scripts/ops/nginx/gen_snakeoil_cert.sh [--force]
# Output (gitignored, mounted read-only at /etc/nginx/ssl-default):
#   nginx/ssl-default/snakeoil.crt  nginx/ssl-default/snakeoil.key
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="${SNAKEOIL_DIR:-$ROOT/nginx/ssl-default}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

if [[ -s "$OUT/snakeoil.crt" && -s "$OUT/snakeoil.key" && $FORCE -eq 0 ]]; then
  echo "snakeoil cert already present in $OUT (use --force to regenerate)"
  exit 0
fi

command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }
umask 077
mkdir -p "$OUT"
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -subj "/CN=invalid.local" \
  -keyout "$OUT/snakeoil.key" -out "$OUT/snakeoil.crt" 2>/dev/null
chmod 644 "$OUT/snakeoil.crt"
# the nginx master process reads the key as root, so 600 is enough
chmod 600 "$OUT/snakeoil.key"
echo "wrote $OUT/snakeoil.crt and snakeoil.key"
