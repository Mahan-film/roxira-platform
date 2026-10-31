#!/usr/bin/env bash
# Daily disk cleanup for the owner's Mac. Dry run unless --apply.
# Deletes only what can be rebuilt or recovered:
#   - git worktrees that are idle, unlocked, clean and whose HEAD exists on a remote
#     (`git worktree remove` without --force refuses anything uncommitted or untracked; branches stay)
#   - node_modules and .next in idle worktrees
#   - idle /private/tmp/claude-* session folders, npm and Homebrew caches
# Never touches the main checkout, data/, ~/Backups, ~/RoxiraBackups or model caches.
set -uo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
REPO="${ROXIRA_REPO:-$HOME/Developer/roxira-platform}"
IDLE_DAYS="${CLEANUP_IDLE_DAYS:-2}"
TMP_DAYS="${CLEANUP_TMP_DAYS:-7}"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LIVE="$(mktemp)"; trap 'rm -f "$LIVE"' EXIT
lsof -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | sort -u >"$LIVE"

log() { echo "[$(date '+%F %T')] $*"; }
in_use() { awk -v p="$1" 'index($0, p) == 1 { f = 1 } END { exit !f }' "$LIVE"; }
# Last git activity, not folder times: deleting build output must not make a worktree look busy.
recent() {
  local gd; gd="$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)" || return 0
  [ -n "$(find "$gd/logs/HEAD" "$gd/HEAD" -mtime "-$2" -print -quit 2>/dev/null)" ] ||
    [ "$(git -C "$1" log -1 --format=%ct 2>/dev/null || echo 0)" -gt "$(($(date +%s) - $2 * 86400))" ]
}

git -C "$REPO" fetch -q --all --prune 2>/dev/null || log "fetch failed; continuing with known refs"
kept=0; removed=0
# Deepest first: some worktrees live inside another worktree's ignored .wt folder.
while IFS= read -r wt; do
  { [ "$wt" = "$REPO" ] || [ ! -d "$wt" ]; } && continue
  if in_use "$wt" || recent "$wt" "$IDLE_DAYS"; then kept=$((kept + 1)); continue; fi
  head="$(git -C "$wt" rev-parse HEAD 2>/dev/null)" || continue
  if [ -z "$(git -C "$REPO" for-each-ref --contains "$head" --count=1 refs/remotes)" ] \
    || [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ] \
    || [ -f "$(git -C "$wt" rev-parse --git-dir)/locked" ]; then
    # Keep the code; drop only what a build recreates.
    find "$wt" -maxdepth 6 -type d \( -name node_modules -o -name .next \) -prune -print 2>/dev/null |
      while IFS= read -r d; do
        git -C "$wt" ls-files --error-unmatch "$d" >/dev/null 2>&1 && continue
        log "build output: $d"; [ "$APPLY" = 1 ] && rm -rf "$d"
      done
    kept=$((kept + 1)); continue
  fi
  log "worktree: $wt"
  if [ "$APPLY" = 1 ]; then
    git -C "$REPO" worktree remove "$wt" 2>/dev/null && removed=$((removed + 1)) || kept=$((kept + 1))
  else removed=$((removed + 1)); fi
done < <(git -C "$REPO" worktree list --porcelain | sed -n 's/^worktree //p' | awk '{ print gsub("/", "/"), $0 }' | sort -rn | cut -d' ' -f2-)
[ "$APPLY" = 1 ] && git -C "$REPO" worktree prune
log "worktrees removed=$removed kept=$kept"

for root in /private/tmp/claude-*; do
  [ -d "$root" ] || continue
  for d in "$root"/*; do
    [ -d "$d" ] || continue
    in_use "$d" && continue
    [ -n "$(find "$d" -mtime "-$TMP_DAYS" -print -quit 2>/dev/null)" ] && continue
    log "temp: $d"; [ "$APPLY" = 1 ] && rm -rf "$d"
  done
done

if [ "$APPLY" = 1 ]; then
  npm cache clean --force >/dev/null 2>&1
  command -v brew >/dev/null && brew cleanup -s --prune=7 >/dev/null 2>&1
fi
df -h /System/Volumes/Data | tail -1 | awk '{ print "free: " $4 }'
