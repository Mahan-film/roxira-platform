#!/usr/bin/env bash
# Prepare the host paths that docker-compose.prod.yml bind-mounts read-write
# into roxira_enterprise_backend (runs as uid 100 / gid 101):
#   TECH_RADAR_REPORT.md, TECH_RADAR_REPORT.json, data/tech_radar/
# If a bind-mount source file is missing, Docker creates a root-owned DIRECTORY
# in its place, which breaks the mount. Run this BEFORE `docker compose up`.
#
#   scripts/ops/prep_backend_mounts.sh            dry run (default): print actions
#   scripts/ops/prep_backend_mounts.sh --apply    create + chown (needs root)
# Never deletes anything: if a path exists with the wrong type it is reported
# and the script exits non-zero so a human can decide.
set -euo pipefail

ROOT="${PREP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)}"
OWNER="${BACKEND_OWNER:-100:101}"
APPLY=0
case "${1:-}" in
  "") ;;
  --apply) APPLY=1 ;;
  -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

run() { if (( APPLY )); then "$@"; else echo "  + $*"; fi; }
(( APPLY )) || echo "[prep] DRY RUN in $ROOT (use --apply to execute)"
if (( APPLY )) && [[ $EUID -ne 0 ]]; then echo "must run as root for --apply (chown)" >&2; exit 1; fi

rc=0
for f in TECH_RADAR_REPORT.md TECH_RADAR_REPORT.json; do
  p="$ROOT/$f"
  if [[ -d "$p" ]]; then
    echo "ERROR: $p is a directory (created by Docker as root). Remove it by hand, then re-run." >&2
    rc=1; continue
  fi
  [[ -e "$p" ]] || run touch "$p"
  run chown "$OWNER" "$p"
  run chmod 664 "$p"
done

d="$ROOT/data/tech_radar"
if [[ -e "$d" && ! -d "$d" ]]; then
  echo "ERROR: $d exists and is not a directory." >&2; rc=1
else
  run install -d -o "${OWNER%%:*}" -g "${OWNER##*:}" -m 775 "$d"
fi
exit "$rc"
