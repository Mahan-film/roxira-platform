#!/usr/bin/env bash
# Automatic cleanup for srv1, every 2 days (docs/strategy/MASTER_STRATEGY_2026-10-30.md section 3):
#   1. docker build cache older than 48 hours
#   2. dangling images
#   3. rxtest-* images older than 2 days
#   4. systemd journal above 200 MB
#   5. finished agent worktrees older than 3 days (disk_guard.sh logic: taskq done/failed/cancelled, clean tree)
# NEVER touched: docker volumes, /opt/roxira_platform/data, ~/Backups, /opt/roxira_backups, images tagged :prev,
# images used by any container, running containers. There is no `docker system prune`, no `-a`, no `rmi -f`,
# no `rm -rf` in this script: every removal is one validated object at a time.
#
# Usage: cleanup_2d.sh [--dry-run | --apply]     (default: --dry-run, changes nothing)
# Env (tests/overrides): DOCKER_BIN, JOURNALCTL_BIN, DF_BIN, CLEANUP_LOG, JOURNAL_MAX (200M), IMAGE_PREFIX (rxtest-),
#   IMAGE_MIN_AGE_DAYS (2), CACHE_UNTIL (48h), DISK_GUARD (scripts/ops/disk_guard.sh)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_BIN="${DOCKER_BIN:-docker}"
JOURNALCTL_BIN="${JOURNALCTL_BIN:-journalctl}"
DF_BIN="${DF_BIN:-df}"
DISK_GUARD="${DISK_GUARD:-$HERE/disk_guard.sh}"
CLEANUP_LOG="${CLEANUP_LOG:-/root/deploy-state/cleanup.log}"
JOURNAL_MAX="${JOURNAL_MAX:-200M}"
IMAGE_PREFIX="${IMAGE_PREFIX:-rxtest-}"
IMAGE_MIN_AGE_DAYS="${IMAGE_MIN_AGE_DAYS:-2}"
CACHE_UNTIL="${CACHE_UNTIL:-48h}"

APPLY=0
case "${1:-}" in
  "" | --dry-run) ;;
  --apply) APPLY=1 ;;
  -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
  *) echo "usage: $0 [--dry-run | --apply]" >&2; exit 2 ;;
esac

say() { printf '[cleanup] %s\n' "$*"; }
act() { if [ "$APPLY" = 1 ]; then "$@"; else say "dry-run: $*"; fi; }
root_used() { { "$DF_BIN" -P / 2>/dev/null || true; } | awk 'NR==2 {print $3 " " $4 " " $5}'; }

say "mode: $([ "$APPLY" = 1 ] && echo APPLY || echo DRY-RUN); root before (used KiB, free KiB, use%): $(root_used)"

if command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  say "1. build cache older than $CACHE_UNTIL"
  act "$DOCKER_BIN" builder prune -f --filter "until=$CACHE_UNTIL" || say "WARNING: build cache prune failed"

  say "2. dangling images (untagged only; a :prev tag keeps its image)"
  if [ "$APPLY" = 1 ]; then
    "$DOCKER_BIN" image prune -f || say "WARNING: dangling image prune failed"
  else
    say "dry-run: would remove: $("$DOCKER_BIN" images -f dangling=true --format '{{.ID}}' 2>/dev/null | tr '\n' ' ')"
  fi

  say "3. ${IMAGE_PREFIX}* images older than ${IMAGE_MIN_AGE_DAYS} days (not :prev, not used by any container)"
  in_use="$(mktemp "${TMPDIR:-/tmp}/cleanup-inuse.XXXXXX")"
  {
    "$DOCKER_BIN" ps -a --format '{{.Image}}' 2>/dev/null
    "$DOCKER_BIN" ps -a -q 2>/dev/null | while read -r c; do "$DOCKER_BIN" inspect -f '{{.Image}}' "$c" 2>/dev/null; done
  } | sed 's/^sha256://' >"$in_use"
  "$DOCKER_BIN" image ls --format '{{.ID}}	{{.Repository}}:{{.Tag}}	{{.CreatedAt}}' 2>/dev/null \
    | python3 -I "$HERE/cleanup_tools.py" old-images --min-age-days "$IMAGE_MIN_AGE_DAYS" --prefix "$IMAGE_PREFIX" --in-use "$in_use" \
    | while read -r iid; do
        [[ "$iid" =~ ^[0-9a-f]{12,64}$ ]] || continue
        act "$DOCKER_BIN" rmi "$iid" || say "skipped $iid (in use or shared)"
      done
  rm -f -- "$in_use"
else
  say "docker not found; skipping steps 1-3"
fi

say "4. systemd journal above $JOURNAL_MAX"
if command -v "$JOURNALCTL_BIN" >/dev/null 2>&1; then
  say "journal now: $("$JOURNALCTL_BIN" --disk-usage 2>/dev/null | tail -n 1)"
  act "$JOURNALCTL_BIN" --vacuum-size="$JOURNAL_MAX" || say "WARNING: journal vacuum failed"
else
  say "journalctl not found; skipping"
fi

say "5. finished agent worktrees older than 3 days"
gd_args=()
[ "$APPLY" = 1 ] || gd_args=(--dry-run)
WORKTREES_ONLY=1 THRESHOLD_CLEANUP=0 THRESHOLD_ALERT=101 WORKTREE_MAX_AGE_DAYS=3 \
  bash "$DISK_GUARD" ${gd_args[@]+"${gd_args[@]}"} || say "WARNING: worktree step failed"

say "root after  (used KiB, free KiB, use%): $(root_used)"
if [ "$APPLY" = 1 ]; then
  mkdir -p "$(dirname "$CLEANUP_LOG")" 2>/dev/null || true
  printf '%s cleanup ok; root %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(root_used)" >>"$CLEANUP_LOG" 2>/dev/null || true
fi
say "done"
