#!/usr/bin/env bash
# Mac disk guard: frees space by deleting only things that can be rebuilt.
# Runs daily from launchd (scripts/dev/install_mac_disk_guard.sh). Acts only when free space
# is below MIN_FREE_GB, and in tiers, stopping as soon as there is enough room.
#
# Never touched: data/, ~/Backups, personal folders (Documents, Desktop, Downloads, Photos,
# Music), git history, worktree source files, Docker volumes that have a name, any worktree
# changed in the last ACTIVE_HOURS hours, and the main checkout's own node_modules.
#
# Usage: mac_disk_guard.sh [--dry-run] [--force]
set -u
MIN_FREE_GB="${MIN_FREE_GB:-25}"
ACTIVE_HOURS="${ACTIVE_HOURS:-72}"
DEV="${DEV_ROOT:-$HOME/Developer}"
LOG="$HOME/Library/Logs/roxira-disk-guard.log"
DRY=0; FORCE=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --force) FORCE=1;; esac; done
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

free_gb() { df -g / | awk 'NR==2 {print $4}'; }
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
run() { if [ "$DRY" = 1 ]; then log "DRY: $*"; else eval "$@" >/dev/null 2>&1; fi; }
enough() { [ "$FORCE" = 0 ] && [ "$(free_gb)" -ge "$MIN_FREE_GB" ]; }

start=$(free_gb)
if enough; then log "ok: ${start} GB free (min ${MIN_FREE_GB})"; exit 0; fi
log "start: ${start} GB free, below ${MIN_FREE_GB} GB"

# Tier 1: tool caches (rebuilt automatically on next use).
run "npm cache clean --force"
command -v uv >/dev/null && run "uv cache clean"
command -v brew >/dev/null && run "brew cleanup -s"
run "rm -rf '$HOME/Library/Caches/com.microsoft.VSCode.ShipIt'"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  # Only unnamed (64-hex) dangling volumes, dangling images and build cache.
  if [ "$DRY" = 1 ]; then
    log "DRY: would remove $(docker volume ls -qf dangling=true | grep -cE '^[0-9a-f]{64}$') anonymous volumes"
  else
    docker volume ls -qf dangling=true | grep -E '^[0-9a-f]{64}$' | xargs docker volume rm >/dev/null 2>&1
    docker image prune -f >/dev/null 2>&1
    docker builder prune -f >/dev/null 2>&1
  fi
fi
log "after tier 1: $(free_gb) GB free"
enough && exit 0

# Tier 2: dependency and build folders in worktrees untouched for ACTIVE_HOURS (npm ci restores them).
n=0
for wt in "$DEV"/roxira-wt/* "$DEV"/rx-wt/* "$DEV"/roxira-platform/.claude/worktrees/*; do
  [ -d "$wt" ] || continue
  # Skip a worktree with any file (outside node_modules) changed recently: it may be in use.
  if find "$wt" -maxdepth 4 -not -path '*/node_modules/*' -newermt "-${ACTIVE_HOURS} hours" -print -quit 2>/dev/null | grep -q .; then
    continue
  fi
  for d in output_apps/enterprise_hub/node_modules output_apps/enterprise_hub/frontend/node_modules \
           output_apps/enterprise_hub/frontend/.next output_apps/enterprise_hub/dist node_modules; do
    if [ -d "$wt/$d" ]; then run "rm -rf '$wt/$d'"; n=$((n+1)); fi
  done
done
log "after tier 2: $(free_gb) GB free ($n folders)"
enough && exit 0

# Tier 3: worktrees whose PR is merged, that are clean and idle. `git worktree remove` without
# --force refuses any worktree with changes, so nothing unsaved can be lost; the code is on main.
REPO="$DEV/roxira-platform"
if [ -d "$REPO/.git" ] && command -v gh >/dev/null; then
  merged=$(gh pr list --repo Mahan-film/roxira-platform --state merged --limit 400 --json headRefName --jq '.[].headRefName' 2>/dev/null)
  open=$(gh pr list --repo Mahan-film/roxira-platform --state open --limit 200 --json headRefName --jq '.[].headRefName' 2>/dev/null)
  r=0
  if [ -n "$merged" ]; then
    while IFS=$'\t' read -r p b; do
      [ "$p" = "$REPO" ] && continue
      printf '%s\n' "$open" | grep -qxF "$b" && continue
      printf '%s\n' "$merged" | grep -qxF "$b" || continue
      find "$p" -maxdepth 3 -not -path '*/node_modules/*' -newermt "-${ACTIVE_HOURS} hours" -print -quit 2>/dev/null | grep -q . && continue
      if [ "$DRY" = 1 ]; then log "DRY: git worktree remove $p"; r=$((r+1));
      elif git -C "$REPO" worktree remove "$p" >/dev/null 2>&1; then r=$((r+1)); fi
    done < <(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{sub("refs/heads/","",$2); print p"\t"$2}')
    [ "$DRY" = 1 ] || git -C "$REPO" worktree prune >/dev/null 2>&1
  fi
  log "after tier 3: $(free_gb) GB free ($r merged worktrees)"
  enough && exit 0
fi

# Nothing else is safe to delete automatically.
end=$(free_gb)
log "still low: ${end} GB free. Needs a human: old worktrees of merged PRs, Docker.raw compaction, personal files."
osascript -e "display notification \"Only ${end} GB free after automatic cleanup. Open the Roxira chat for options.\" with title \"Roxira disk guard\"" >/dev/null 2>&1 || true
exit 0
