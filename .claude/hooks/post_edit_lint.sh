#!/usr/bin/env bash
# PostToolUse hook (Edit/Write): fast lint-on-save. Reads the hook JSON payload
# from stdin, and for a *.py file runs `ruff check --quiet` on just that file.
# TypeScript under output_apps/enterprise_hub is intentionally skipped here
# (no tsc — too slow for a per-edit hook). Never blocks the tool call: always
# exits 0, and prints at most ~20 lines.

set -u

payload="$(cat)"

file_path="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
path = (data.get("tool_input") or {}).get("file_path", "")
print(path)
' 2>/dev/null)"

[ -z "${file_path:-}" ] && exit 0
[ -f "$file_path" ] || exit 0

case "$file_path" in
  *.py)
    if ! command -v ruff >/dev/null 2>&1; then
      exit 0
    fi
    ruff check --quiet "$file_path" 2>&1 | head -n 20
    ;;
  *)
    # *.ts/*.tsx (including output_apps/enterprise_hub) and everything else: no-op.
    ;;
esac

exit 0
