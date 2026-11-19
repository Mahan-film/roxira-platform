#!/usr/bin/env bash
# Toggle nginx Content-Security-Policy between enforce and report-only (T216 rollback flag).
# Usage: bash scripts/ops/nginx/toggle_csp.sh [enforce|report-only] [path/to/security_headers.conf]
set -euo pipefail

MODE="${1:-}"
CONF="${2:-$(cd "$(dirname "$0")/../../.." && pwd)/output_apps/nginx_config/snippets/security_headers.conf}"

if [ ! -f "$CONF" ]; then
  echo "error: security_headers.conf not found at $CONF" >&2
  exit 1
fi

case "$MODE" in
  enforce)
    python3 -c '
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text(encoding="utf-8")
updated = text.replace("add_header Content-Security-Policy-Report-Only ", "add_header Content-Security-Policy ")
p.write_text(updated, encoding="utf-8")
' "$CONF"
    echo "CSP mode set to: enforce ($CONF)"
    ;;
  report-only)
    python3 -c '
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text(encoding="utf-8")
updated = text.replace("add_header Content-Security-Policy ", "add_header Content-Security-Policy-Report-Only ")
p.write_text(updated, encoding="utf-8")
' "$CONF"
    echo "CSP mode set to: report-only ($CONF)"
    ;;
  *)
    echo "usage: $0 <enforce|report-only> [security_headers.conf]" >&2
    exit 2
    ;;
esac
