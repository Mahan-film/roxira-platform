#!/usr/bin/env bash
# Disk guard for srv1: keeps / (the root disk) from filling up after the 2026-10-22 outage
# (8 GB docker build cache + 71 stale agent worktrees). Run hourly by roxira-disk-guard.timer.
#
# When / is at or above THRESHOLD_CLEANUP (default 80%):
#   * docker builder prune -f --keep-storage 3GB -- build cache.
#   * docker image prune -f -- DANGLING (untagged) images only: every deploy leaves ~4.5 GB of them
#     (2026-11-03: 10.7 GB in 3 days). Tagged images, volumes and containers are never touched:
#     rollback images are tagged under /root/deploy-state/image_*.
#   * remove agent worktrees under WORKTREE_ROOT older than WORKTREE_MAX_AGE_DAYS whose newest taskq
#     task reached done/failed/cancelled (taskq.db opened read-only). A worktree with uncommitted
#     changes is skipped. Branches and patches are never deleted.
#   Removed paths are appended to /root/deploy-state/disk-guard.log.
# When / is still at or above THRESHOLD_ALERT (default 88%) afterwards, a Persian alert with the use%
# and the five largest top-level directories is sent via scripts/ops/notify/notify.py (a silent no-op
# when NOTIFY_* is not configured).
#
# Usage: disk_guard.sh [--dry-run]
#   --dry-run   print the actions only; change nothing
#
# Install (on the server, as root):
#   install -m 644 scripts/ops/disk_guard/roxira-disk-guard.service /etc/systemd/system/
#   install -m 644 scripts/ops/disk_guard/roxira-disk-guard.timer   /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now roxira-disk-guard.timer
#   journalctl -u roxira-disk-guard.service -n 30
#
# Env overrides (defaults are the production paths): DF_BIN, DOCKER_BIN, DU_BIN, GIT_BIN, SUDO_BIN,
# TASKQ_DB, WORKTREE_ROOT, REPO_GIT, AGENT_USER, DEPLOY_STATE, LOG_FILE, NOTIFY_BIN, ROOT_MOUNT,
# THRESHOLD_CLEANUP, THRESHOLD_ALERT, KEEP_STORAGE, WORKTREE_MAX_AGE_DAYS, WORKTREES_ONLY (1 = skip the build-cache prune).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DF_BIN="${DF_BIN:-df}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
DU_BIN="${DU_BIN:-du}"
GIT_BIN="${GIT_BIN:-git}"
SUDO_BIN="${SUDO_BIN:-sudo}"
TASKQ_DB="${TASKQ_DB:-/var/lib/roxira-agents/taskq.db}"
WORKTREE_ROOT="${WORKTREE_ROOT:-/var/lib/roxira-agents/worktrees}"
REPO_GIT="${REPO_GIT:-/var/lib/roxira-agents/repo.git}"
AGENT_USER="${AGENT_USER:-}"
DEPLOY_STATE="${DEPLOY_STATE:-/root/deploy-state}"
LOG_FILE="${LOG_FILE:-$DEPLOY_STATE/disk-guard.log}"
NOTIFY_BIN="${NOTIFY_BIN:-$HERE/notify/notify.py}"
ROOT_MOUNT="${ROOT_MOUNT:-/}"
THRESHOLD_CLEANUP="${THRESHOLD_CLEANUP:-80}"
THRESHOLD_ALERT="${THRESHOLD_ALERT:-88}"
KEEP_STORAGE="${KEEP_STORAGE:-3GB}"
WORKTREE_MAX_AGE_DAYS="${WORKTREE_MAX_AGE_DAYS:-3}"
STATES_OK="done failed cancelled"

usage() {
  cat <<'EOF'
Usage: disk_guard.sh [--dry-run]
  --dry-run   print the actions only; change nothing
EOF
}

DRY_RUN=0
for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf '[disk-guard] unknown option: %s\n' "$argument" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '[disk-guard] %s\n' "$*"; }

run() {  # print and run, or print only under --dry-run
  if [ "$DRY_RUN" = 1 ]; then
    printf '[disk-guard] dry-run: %s\n' "$*"
  else
    "$@"
  fi
}

if [ -z "$AGENT_USER" ]; then
  AGENT_USER="$(stat -c '%U' "$REPO_GIT" 2>/dev/null || true)"
fi
AGENT_USER="${AGENT_USER:-roxira-agent}"

as_agent() {  # run a command as the owner of repo.git (directly when we already are that user)
  if [ "$(id -un 2>/dev/null || echo root)" = "$AGENT_USER" ]; then
    "$@"
  else
    "$SUDO_BIN" -u "$AGENT_USER" "$@"
  fi
}

use_pct() {  # integer percent used on ROOT_MOUNT, or empty
  "$DF_BIN" -P "$ROOT_MOUNT" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5+0}'
}

task_status() {  # <worktree path> -> newest taskq status for it, or empty (db opened read-only)
  python3 - "$TASKQ_DB" "$1" <<'PY'
import sqlite3
import sys
import urllib.parse

db, path = sys.argv[1], sys.argv[2]
try:
    uri = "file:" + urllib.parse.quote(db, safe="/") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5)
except sqlite3.Error:
    raise SystemExit(0)
try:
    row = con.execute(
        "SELECT status FROM tasks WHERE worktree=? ORDER BY updated DESC LIMIT 1", (path,)
    ).fetchone()
except sqlite3.Error:
    row = None
finally:
    con.close()
print(row[0] if row else "")
PY
}

log "checking $ROOT_MOUNT (cleanup >= ${THRESHOLD_CLEANUP}%, alert >= ${THRESHOLD_ALERT}%)"
use_before="$(use_pct)"
if [ -z "$use_before" ]; then
  log "could not read the use% of $ROOT_MOUNT; nothing to do"
  exit 0
fi
log "use% before: ${use_before}%"

if [ "$use_before" -lt "$THRESHOLD_CLEANUP" ]; then
  log "below ${THRESHOLD_CLEANUP}%; no cleanup needed"
  exit 0
fi

if [ "${WORKTREES_ONLY:-0}" = 1 ]; then
  log "WORKTREES_ONLY=1: skipping the build-cache prune (cleanup_2d.sh does its own)"
elif command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  log "pruning docker build cache (keep-storage $KEEP_STORAGE; images/volumes/containers untouched)"
  run "$DOCKER_BIN" builder prune -f --keep-storage "$KEEP_STORAGE" || log "WARNING: build-cache prune failed"
  log "pruning dangling docker images (untagged only)"
  run "$DOCKER_BIN" image prune -f || log "WARNING: dangling-image prune failed"
else
  log "docker not found ($DOCKER_BIN); skipping build-cache prune"
fi

if [ -d "$WORKTREE_ROOT" ]; then
  log "scanning $WORKTREE_ROOT for worktrees older than ${WORKTREE_MAX_AGE_DAYS} days"
  while IFS= read -r wt; do
    [ -n "$wt" ] || continue
    status="$(task_status "$wt")"
    case " $STATES_OK " in
      *" $status "*) : ;;
      *) log "skip $wt (taskq status '${status:-unknown/active}')"; continue ;;
    esac
    if ! dirty="$(as_agent "$GIT_BIN" -C "$wt" status --porcelain 2>/dev/null)"; then
      log "skip $wt (git status failed)"
      continue
    fi
    if [ -n "$dirty" ]; then
      log "skip $wt (uncommitted changes)"
      continue
    fi
    if [ "$DRY_RUN" = 1 ]; then
      log "dry-run: would remove worktree $wt (status $status)"
      continue
    fi
    if as_agent "$GIT_BIN" -C "$REPO_GIT" worktree remove --force "$wt" >/dev/null 2>&1; then
      log "removed worktree $wt (status $status)"
      mkdir -p "$DEPLOY_STATE"
      printf '%s\n' "$wt" >>"$LOG_FILE"
    else
      log "WARNING: failed to remove worktree $wt"
    fi
  done < <(find "$WORKTREE_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$WORKTREE_MAX_AGE_DAYS" 2>/dev/null | LC_ALL=C sort)
else
  log "no worktree root at $WORKTREE_ROOT; skipping"
fi

use_after="$(use_pct)"
log "use% after cleanup: ${use_after:-unknown}%"
if [ "${use_after:-0}" -ge "$THRESHOLD_ALERT" ]; then
  top_dirs="$("$DU_BIN" -xh -d1 "$ROOT_MOUNT" 2>/dev/null | LC_ALL=C sort -rh | head -n 5 || true)"
  message="هشدار دیسک srv1: فضای ریشه هنوز ${use_after}% پر است.
بزرگ‌ترین پوشه‌ها:
${top_dirs}"
  if [ "$DRY_RUN" = 1 ]; then
    log "dry-run: would alert at ${use_after}% >= ${THRESHOLD_ALERT}%:"
    printf '%s\n' "$message"
  else
    log "sending disk alert (${use_after}% >= ${THRESHOLD_ALERT}%)"
    python3 "$NOTIFY_BIN" "$message" || true
  fi
else
  log "below ${THRESHOLD_ALERT}% after cleanup; no alert"
fi

log "done"
