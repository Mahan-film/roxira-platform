#!/usr/bin/env bash
# scripts/dev/ui_debt_count.sh
# Counts raw palette classes ((bg|text|border)-(red|…|orange)-NNN) and
# physical-direction classes (ml-/mr-/pl-/pr-/left-/right-/text-left/text-right/border-l/border-r/rounded-l/rounded-r)
# in a target directory outside components/ui.
#
# Usage:
#   bash scripts/dev/ui_debt_count.sh <dir> [--details] [--json]
#
# Example:
#   bash scripts/dev/ui_debt_count.sh output_apps/enterprise_hub/frontend/src/components/chat
#   bash scripts/dev/ui_debt_count.sh components/chat
set -euo pipefail

TARGET_DIR=""
SHOW_DETAILS=false
OUTPUT_JSON=false

while [ $# -gt 0 ]; do
  case "$1" in
    --details|-v|--verbose)
      SHOW_DETAILS=true
      shift
      ;;
    --json)
      OUTPUT_JSON=true
      shift
      ;;
    *)
      if [ -z "$TARGET_DIR" ]; then
        TARGET_DIR="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "$TARGET_DIR" ]; then
  echo "Usage: $0 <dir> [--details] [--json]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Resolve TARGET_DIR
RESOLVED_DIR=""
CANDIDATES=(
  "$TARGET_DIR"
  "$PWD/$TARGET_DIR"
  "$REPO_ROOT/$TARGET_DIR"
  "$REPO_ROOT/output_apps/enterprise_hub/frontend/$TARGET_DIR"
  "$REPO_ROOT/output_apps/enterprise_hub/frontend/src/$TARGET_DIR"
)

for c in "${CANDIDATES[@]}"; do
  if [ -d "$c" ] || [ -f "$c" ]; then
    RESOLVED_DIR="$c"
    break
  fi
done

if [ -z "$RESOLVED_DIR" ]; then
  echo "Error: Directory or file not found: $TARGET_DIR" >&2
  exit 1
fi

python3 - "$RESOLVED_DIR" "$SHOW_DETAILS" "$OUTPUT_JSON" << 'EOF'
import sys, os, re, json
from pathlib import Path

target = Path(sys.argv[1]).resolve()
details = sys.argv[2].lower() == "true"
as_json = sys.argv[3].lower() == "true"

PALETTE_RE = re.compile(
    r"^(?:[a-zA-Z0-9_-]+:)*(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$"
)
DIRECTION_RE = re.compile(
    r"^(?:[a-zA-Z0-9_-]+:)*(?:-?(?:ml|mr|pl|pr|left|right)-[a-zA-Z0-9_./\[\]-]+|text-(?:left|right)|border-[lr](?:-[a-zA-Z0-9_./\[\]-]+)?|rounded-[lr](?:-[a-zA-Z0-9_./\[\]-]+)?)$"
)

STRING_RE = re.compile(
    r"""(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`)""",
    re.DOTALL
)

def scan_file(file_path):
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        return []

    # Strip line & block comments to avoid false matches in prose
    c_clean = re.sub(r"/\*.*?\*/", "", content, flags=re.DOTALL)
    c_clean = re.sub(r"//.*$", "", c_clean, flags=re.MULTILINE)

    matches = []
    # Track line numbers approximately
    lines = content.splitlines()

    for m in STRING_RE.finditer(c_clean):
        s = m.group(1) or m.group(2) or m.group(3) or ""
        tokens = s.split()
        for tok in tokens:
            clean = tok.strip(" ,;()[]{}")
            is_p = bool(PALETTE_RE.match(clean))
            is_d = bool(DIRECTION_RE.match(clean))
            if is_p or is_d:
                # Find line number
                start_pos = m.start()
                line_no = c_clean[:start_pos].count("\n") + 1
                kind = "palette" if is_p else "direction"
                matches.append({
                    "file": str(file_path),
                    "line": line_no,
                    "token": clean,
                    "kind": kind
                })
    return matches

all_matches = []
files_to_scan = []

ignored_names = {"node_modules", ".next", "out", "build", ".git"}
if target.is_file():
    files_to_scan.append(target)
else:
    for root, dirs, files in os.walk(target):
        parts = set(Path(root).parts)
        # Exclude components/ui unless user explicitly targeted it
        if "ui" in parts and "components" in parts and "ui" not in set(Path(target).parts):
            continue
        # Exclude node_modules, .next, out, build
        if parts & ignored_names:
            continue
        for f in files:
            if f.endswith((".tsx", ".ts", ".jsx", ".js")) and not f.endswith((".d.ts", ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
                files_to_scan.append(Path(root) / f)

for f in sorted(files_to_scan):
    all_matches.extend(scan_file(f))

total = len(all_matches)
palette_count = sum(1 for m in all_matches if m["kind"] == "palette")
direction_count = sum(1 for m in all_matches if m["kind"] == "direction")

if details:
    for m in all_matches:
        print(f"{m['file']}:{m['line']}: [{m['kind']}] {m['token']}")

if as_json:
    print(json.dumps({
        "target": str(target),
        "total": total,
        "palette": palette_count,
        "direction": direction_count,
        "files_scanned": len(files_to_scan)
    }, indent=2))
elif not details:
    print(total)
EOF
