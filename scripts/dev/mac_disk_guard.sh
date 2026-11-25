#!/usr/bin/env bash
# Mac disk guard v2: frees internal disk space in pressure tiers (every 900s via launchd).
#
# Tiers on internal free space:
#   Tier 1 (< 25 GB): tool caches (npm, uv, brew, ShipIt, Docker dangling/build cache)
#                     and node_modules/.next in worktrees idle 2h+.
#   Tier 2 (< 15 GB): git worktree remove (no --force) for worktrees idle 4h+ that are
#                     clean, HEAD in a remote branch, unlocked, not any process's cwd,
#                     and not the main checkout; plus rvdesk/wt-* temp worktrees idle 2h+.
#   Tier 3 (< 8 GB):  same worktree removal with 1h idle, plus alert log line.
#
# Never touched: data/, ~/Backups, model caches (huggingface, qmd), Docker named volumes,
# personal folders, or anything not rebuildable.
#
# Usage: mac_disk_guard.sh [--dry-run] [--force]
set -u

TIER1_GB="${TIER1_GB:-25}"
TIER2_GB="${TIER2_GB:-15}"
TIER3_GB="${TIER3_GB:-8}"
IDLE_CACHE_HOURS="${IDLE_CACHE_HOURS:-2}"
IDLE_WT_HOURS="${IDLE_WT_HOURS:-4}"
TIER3_IDLE_HOURS="${TIER3_IDLE_HOURS:-1}"
DEV="${DEV_ROOT:-$HOME/Developer}"
REPO="${REPO_DIR:-$DEV/roxira-platform}"
TMP_RVDESK="${TMP_RVDESK:-${TMPDIR:-/tmp}/rvdesk}"
LOG="${LOG_FILE:-$HOME/Library/Logs/roxira-disk-guard.log}"

DRY=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --force) FORCE=1 ;;
  esac
done

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

free_gb() {
  if [ -n "${FAKE_FREE_GB:-}" ]; then
    echo "$FAKE_FREE_GB"
  else
    df -g / | awk 'NR==2 {print $4}'
  fi
}

log() {
  mkdir -p "$(dirname "$LOG")"
  printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"
}

run() {
  if [ "$DRY" = 1 ]; then
    log "DRY: $*"
  else
    eval "$@" >/dev/null 2>&1
  fi
}

enough() {
  local limit="${1:-$TIER1_GB}"
  [ "$FORCE" = 0 ] && [ "$(free_gb)" -ge "$limit" ]
}

mtime_epoch() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0
}

is_wt_idle() {
  local wt="$1" hours="$2"
  local now cutoff mtime commit_ts git_dir logs_head
  now=$(date +%s)
  cutoff=$((now - hours * 3600))

  git_dir=$(git -C "$wt" rev-parse --git-dir 2>/dev/null || true)
  if [ -n "$git_dir" ]; then
    case "$git_dir" in
      /*) logs_head="$git_dir/logs/HEAD" ;;
      *) logs_head="$wt/$git_dir/logs/HEAD" ;;
    esac
    if [ -f "$logs_head" ]; then
      mtime=$(mtime_epoch "$logs_head")
      [ "$mtime" -gt "$cutoff" ] && return 1
    fi
  fi

  commit_ts=$(git -C "$wt" log -1 --format=%ct 2>/dev/null || echo 0)
  [ "$commit_ts" -gt "$cutoff" ] && return 1
  return 0
}

is_cwd_in_use() {
  local wt="$1"
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -d cwd -Fn 2>/dev/null | grep -Fq "n${wt}"
}

is_wt_safe_to_remove() {
  local wt="$1" hours="$2" locked_flag="$3"
  [ -d "$wt" ] || return 1
  [ "$wt" = "$REPO" ] && return 1
  [ "$locked_flag" = "1" ] && return 1
  is_cwd_in_use "$wt" && return 1
  is_wt_idle "$wt" "$hours" || return 1

  # Re-verify clean status and remote containment right before removal.
  [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ] && return 1
  local head
  head=$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)
  [ -z "$head" ] && return 1
  git -C "$REPO" branch -r --contains "$head" 2>/dev/null | grep -q . || return 1
  return 0
}

remove_safe_worktrees() {
  local hours="$1"
  local removed=0
  [ -d "$REPO/.git" ] || { echo 0; return; }

  local wt="" locked=0 line
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        if [ -n "$wt" ] && is_wt_safe_to_remove "$wt" "$hours" "$locked"; then
          if [ "$DRY" = 1 ]; then
            removed=$((removed + 1))
          elif git -C "$REPO" worktree remove "$wt" >/dev/null 2>&1; then
            removed=$((removed + 1))
          fi
        fi
        wt="${line#worktree }"
        locked=0
        ;;
      locked*)
        locked=1
        ;;
    esac
  done < <(git -C "$REPO" worktree list --porcelain 2>/dev/null; echo "worktree ")

  [ "$DRY" = 1 ] || git -C "$REPO" worktree prune >/dev/null 2>&1
  echo "$removed"
}

clean_rvdesk_tmp() {
  local hours="$1"
  local cleaned=0
  [ -d "$TMP_RVDESK" ] || { echo 0; return; }
  for wt in "$TMP_RVDESK"/wt-*; do
    [ -d "$wt" ] || continue
    git -C "$wt" rev-parse --git-dir >/dev/null 2>&1 || continue
    is_cwd_in_use "$wt" && continue
    is_wt_idle "$wt" "$hours" || continue
    [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ] && continue
    if [ "$DRY" = 1 ]; then
      cleaned=$((cleaned + 1))
    elif rm -rf "$wt" >/dev/null 2>&1; then
      cleaned=$((cleaned + 1))
    fi
  done
  echo "$cleaned"
}

start=$(free_gb)
if enough "$TIER1_GB"; then
  log "ok: ${start} GB free (min ${TIER1_GB})"
  exit 0
fi
log "start: ${start} GB free, below ${TIER1_GB} GB"

# Tier 1 (< 25 GB): tool caches + node_modules/.next in worktrees idle 2h+.
if [ "${SKIP_TOOL_CACHES:-0}" = 0 ]; then
  command -v npm >/dev/null && run "npm cache clean --force"
  command -v uv >/dev/null && run "uv cache clean"
  command -v brew >/dev/null && run "brew cleanup -s"
  run "rm -rf '$HOME/Library/Caches/com.microsoft.VSCode.ShipIt'"
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    if [ "$DRY" = 1 ]; then
      log "DRY: would prune docker dangling volumes/images/build-cache"
    else
      docker volume ls -qf dangling=true | grep -E '^[0-9a-f]{64}$' | xargs docker volume rm >/dev/null 2>&1 || true
      docker image prune -f >/dev/null 2>&1 || true
      docker builder prune -f >/dev/null 2>&1 || true
    fi
  fi
fi

n=0
for wt in "$DEV"/roxira-wt/* "$DEV"/rx-wt/* "$REPO"/.claude/worktrees/*; do
  [ -d "$wt" ] || continue
  is_wt_idle "$wt" "$IDLE_CACHE_HOURS" || continue
  for d in output_apps/enterprise_hub/node_modules output_apps/enterprise_hub/frontend/node_modules \
           output_apps/enterprise_hub/frontend/.next output_apps/enterprise_hub/dist node_modules; do
    if [ -d "$wt/$d" ]; then
      run "rm -rf '$wt/$d'"
      n=$((n + 1))
    fi
  done
done
log "after tier 1: $(free_gb) GB free ($n cache folders)"
enough "$TIER1_GB" && exit 0

# Tier 2 (< 15 GB): safe worktree removal (4h idle) + rvdesk/wt-* (2h idle).
if ! enough "$TIER2_GB"; then
  r2=$(remove_safe_worktrees "$IDLE_WT_HOURS")
  t2=$(clean_rvdesk_tmp "$IDLE_CACHE_HOURS")
  log "after tier 2: $(free_gb) GB free ($r2 worktrees, $t2 rvdesk temp)"
  enough "$TIER2_GB" && exit 0
fi

# Tier 3 (< 8 GB): same rule with 1h idle + alert.
if ! enough "$TIER3_GB"; then
  r3=$(remove_safe_worktrees "$TIER3_IDLE_HOURS")
  t3=$(clean_rvdesk_tmp "$TIER3_IDLE_HOURS")
  end=$(free_gb)
  log "ALERT: internal disk critically low (${end} GB free); tier 3 removed $r3 worktrees, $t3 rvdesk temp"
  osascript -e "display notification \"Only ${end} GB free after tier 3 cleanup.\" with title \"Roxira disk guard\"" >/dev/null 2>&1 || true
fi

exit 0
