#!/usr/bin/env bash
# SBOM + vulnerability summary for the production images (report-only, never fails the caller).
#
# For each running container below: export its image to a tar (no docker socket is given to the
# scanners), write an SPDX SBOM with syft (network off) and scan that SBOM with grype (needs network
# for its vulnerability DB, cached in $DB_DIR). Files: /root/deploy-state/sbom/<container>-<image12>.*
# Summary: /root/deploy-state/sbom/summary.txt; Critical findings are also sent to the owner bot.
# Usage: bash scripts/ops/sbom/sbom_scan.sh     Docs: docs/ops/SBOM.md
set -uo pipefail

SYFT_IMAGE="anchore/syft:v1.54.1"
GRYPE_IMAGE="anchore/grype:v0.120.1"
CONTAINERS=(roxira_app_prod roxira_enterprise_backend roxira_enterprise_frontend roxira_keypool)
OUT="${SBOM_DIR:-/root/deploy-state/sbom}"
DB_DIR="${SBOM_DB_DIR:-/var/cache/roxira-grype-db}"
WORK="${SBOM_WORK:-/var/tmp/roxira-sbom}"
REPO="${ROXIRA_PLATFORM:-/opt/roxira_platform}"
KEEP=3

log() { printf '[%s] %s\n' "$(date -u '+%H:%M:%S')" "$*" >&2; }

if [ "${1:-}" != "--inner" ]; then
  exec timeout --kill-after=60s 20m nice -n 10 bash "$0" --inner
fi
mkdir -p "$OUT" "$DB_DIR" "$WORK"
trap 'rm -rf "$WORK"' EXIT

summary="$OUT/summary.txt"
printf '=== SBOM / vulnerability summary %s ===\n' "$(date -u '+%Y-%m-%dT%H:%MZ')" > "$summary.new"
alerts=""

for c in "${CONTAINERS[@]}"; do
  img="$(docker inspect -f '{{.Image}}' "$c" 2>/dev/null)" || { log "$c: not running, skipped"; continue; }
  id12="$(printf '%s' "${img#sha256:}" | cut -c1-12)"
  base="$OUT/$c-$id12"
  if [ ! -s "$base.spdx.json" ]; then
    log "$c: exporting image $id12"
    if ! docker save "$img" -o "$WORK/image.tar" 2>/dev/null; then log "$c: docker save failed"; continue; fi
    docker run --rm --network none -v "$WORK:/in:ro" "$SYFT_IMAGE" "docker-archive:/in/image.tar" \
      -o spdx-json > "$base.spdx.json.tmp" 2>/dev/null && mv "$base.spdx.json.tmp" "$base.spdx.json" \
      || { log "$c: syft failed"; rm -f "$base.spdx.json.tmp" "$WORK/image.tar"; continue; }
    rm -f "$WORK/image.tar"
  fi
  docker run --rm -v "$OUT:/sbom:ro" -v "$DB_DIR:/db" -e GRYPE_DB_CACHE_DIR=/db "$GRYPE_IMAGE" \
    "sbom:/sbom/$(basename "$base").spdx.json" -o json > "$base.vulns.json.tmp" 2>/dev/null \
    && mv "$base.vulns.json.tmp" "$base.vulns.json" || { log "$c: grype failed"; rm -f "$base.vulns.json.tmp"; continue; }
  line="$(python3 - "$c" "$base.vulns.json" <<'PY'
import json, sys
name, path = sys.argv[1], sys.argv[2]
matches = json.load(open(path)).get("matches", [])
count = {}
top = []
for m in matches:
    v = m.get("vulnerability", {}); sev = v.get("severity", "Unknown")
    count[sev] = count.get(sev, 0) + 1
    if sev in ("Critical", "High"):
        a = m.get("artifact", {}); fix = ",".join(v.get("fix", {}).get("versions", [])) or "-"
        top.append((0 if sev == "Critical" else 1, f"  {sev} {v.get('id')} {a.get('name')} {a.get('version')} fixed-in {fix}"))
print(f"{name}: Critical={count.get('Critical', 0)} High={count.get('High', 0)} Medium={count.get('Medium', 0)}")
for _, t in sorted(top)[:5]:
    print(t)
PY
)" || line="$c: summary failed"
  printf '%s\n' "$line" >> "$summary.new"
  case "$line" in *"Critical=0 "*) ;; *Critical=*) alerts="${alerts}$(printf '%s' "$line" | head -n1)"$'\n' ;; esac
  # keep only the newest $KEEP scans per container
  ls -1t "$OUT/$c-"*.spdx.json 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" "${old%.spdx.json}.vulns.json"
  done
done

mv "$summary.new" "$summary"
cat "$summary"
if [ -n "$alerts" ] && [ -f "$REPO/scripts/ops/notify/notify.py" ]; then
  python3 "$REPO/scripts/ops/notify/notify.py" "SBOM: آسیب‌پذیری بحرانی
$alerts" >/dev/null 2>&1 || true
fi
exit 0
