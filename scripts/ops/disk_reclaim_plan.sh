#!/usr/bin/env bash
# Read-only production disk reclaim audit script.
# ONLY prints reclaimable candidates; never deletes anything.
set -u

DOCKER_BIN="${DOCKER_BIN:-docker}"
BACKUP_DIRS="${BACKUP_DIRS:-/var/backups/roxira /opt/roxira/backups}"

echo "=== Production Disk Reclaim Plan (READ-ONLY) ==="
echo "Target: keep root / under 60% usage"
echo ""

echo "--- 1. Dangling Docker Images ---"
if command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  "$DOCKER_BIN" images -f dangling=true --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}' 2>/dev/null || echo "(none or docker unavailable)"
else
  echo "(docker not found)"
fi
echo ""

echo "--- 2. Docker Build Cache (> 7 days / 168h) ---"
if command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  "$DOCKER_BIN" builder du 2>/dev/null | head -n 30 || "$DOCKER_BIN" system df 2>/dev/null || echo "(unavailable)"
else
  echo "(docker not found)"
fi
echo ""

echo "--- 3. Images Not Used by Running Containers ---"
if command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  used_ids=$("$DOCKER_BIN" ps -q 2>/dev/null | xargs -r "$DOCKER_BIN" inspect --format '{{.Image}}' 2>/dev/null | sort -u || true)
  "$DOCKER_BIN" images --no-trunc --format '{{.ID}}\t{{.Repository}}:{{.Tag}}\t{{.Size}}' 2>/dev/null | while IFS=$'\t' read -r img_id repo size; do
    [ -z "$img_id" ] && continue
    if ! printf '%s\n' "$used_ids" | grep -qxF "$img_id"; then
      printf '%s\t%s\t%s\n' "$repo" "$img_id" "$size"
    fi
  done
else
  echo "(docker not found)"
fi
echo ""

echo "--- 4. Backup Location Sizes ---"
for d in $BACKUP_DIRS; do
  if [ -d "$d" ]; then
    du -sh "$d" 2>/dev/null || true
  else
    echo "$d: (not present)"
  fi
done
