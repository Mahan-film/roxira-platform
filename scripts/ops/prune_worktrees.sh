#!/usr/bin/env bash
# Safe prune of git worktrees on a developer Mac (issue #1177). Dry-run by default.
#
# Every worktree of the repo is classified, in this order (first match wins):
#   DIRTY     uncommitted changes or untracked files           -> kept
#   LOCKED    `git worktree lock`ed                            -> kept
#   OPEN_PR   its branch has an OPEN pull request              -> kept
#   NO_PR     detached HEAD, or the branch never had a PR      -> kept
#   UNKNOWN   `gh` failed (offline, auth): fail closed         -> kept
#   UNPUSHED  HEAD is neither a PR head nor on a remote branch -> kept
#   SAFE      clean + all PRs merged/closed + HEAD is a PR head or contained in a remote branch
# Only SAFE worktrees are removed, and only with --apply, one at a time via `git worktree remove <path>`
# (never --force, so git itself still refuses a dirty or locked tree). Branches are never deleted.
# The main checkout and the worktree you run the script from are always excluded.
# No rm -rf, no git clean, no reset anywhere in this script.
#
# Report (printed and written to $REPORT_FILE): count and size per class; for each kept worktree its dirty
# file count, unpushed commit count and last commit date. Regenerable caches (huggingface, qmd, playwright,
# codex, brave) are only SIZED, never touched; the opt-in cleanup commands are printed for you to run by hand.
#
# Usage: prune_worktrees.sh [--dry-run | --apply] [--fetch]      (default: --dry-run, changes nothing)
#   --fetch   run `git fetch --prune origin` first, so "contained in a remote branch" uses fresh refs
# Env: REPO (repo to inspect, default .), REPORT_FILE (default $TMPDIR/worktree_prune_report.txt),
#   GH_BIN (gh), CACHE_PATHS (space separated name=path list; default is the Mac locations below)
# Weekly job example (not installed): scripts/ops/com.roxira.prune-worktrees.plist.example
# Test: bash scripts/ops/test_prune_worktrees.sh
#
# Bash 3.2 compatible (macOS default shell).
set -uo pipefail

REPO="${REPO:-.}"
GH_BIN="${GH_BIN:-gh}"
REPORT_FILE="${REPORT_FILE:-${TMPDIR:-/tmp}/worktree_prune_report.txt}"
CACHE_PATHS="${CACHE_PATHS:-huggingface=$HOME/.cache/huggingface qmd=$HOME/.cache/qmd playwright=$HOME/Library/Caches/ms-playwright codex=$HOME/.codex/runtimes brave=$HOME/Library/Caches/BraveSoftware}"

APPLY=0
FETCH=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --fetch) FETCH=1 ;;
    -h | --help) sed -n "2,28p" "$0"; exit 0 ;;
    *) echo "usage: $0 [--dry-run | --apply] [--fetch]" >&2; exit 2 ;;
  esac
done

g() { git -C "$REPO" "$@"; }
say() { printf '%s\n' "$*"; }
# Tools like gh and du are optional-ish; fail early only for what is mandatory.
g rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repo: $REPO" >&2; exit 2; }

T="$(mktemp -d "${TMPDIR:-/tmp}/prunewt.XXXXXX")" || exit 1
trap 'rm -r -- "$T"' EXIT   # our own mktemp dir only
RECORDS="$T/records"         # class<TAB>kib<TAB>dirty<TAB>unpushed<TAB>lastdate<TAB>branch<TAB>path
: >"$RECORDS"

if [ "$FETCH" = 1 ]; then g fetch --prune origin >/dev/null 2>&1 || say "WARNING: git fetch failed; using existing remote refs"; fi

realdir() { (cd "$1" 2>/dev/null && pwd -P); }
CURRENT="$(realdir "$(g rev-parse --show-toplevel)")"

# Parse `git worktree list --porcelain` into: path<TAB>head<TAB>branch<TAB>flags
LIST="$T/list"
g worktree list --porcelain | awk '
  function flush() { if (path != "") printf "%s\t%s\t%s\t%s\n", path, head, branch, flags; path=""; head=""; branch=""; flags="" }
  /^worktree / { flush(); path = substr($0, 10); next }
  /^HEAD /     { head = substr($0, 6); next }
  /^branch /   { branch = substr($0, 8); sub("^refs/heads/", "", branch); next }
  /^detached/  { flags = flags "D"; next }
  /^locked/    { flags = flags "L"; next }
  /^prunable/  { flags = flags "P"; next }
  END { flush() }' >"$LIST"

classify() { # path head branch flags -> sets CLASS
  local path="$1" head="$2" branch="$3" flags="$4" states st oid pr_head_match=0 has_pr=0 open=0
  CLASS=""
  if [ -n "$(g -C "$path" status --porcelain --untracked-files=all 2>/dev/null | head -n 1)" ]; then CLASS=DIRTY; return; fi
  case "$flags" in *L*) CLASS=LOCKED; return ;; esac
  if [ -z "$branch" ]; then CLASS=NO_PR; return; fi
  if ! states="$(cd "$path" && "$GH_BIN" pr list --head "$branch" --state all --limit 200 \
    --json state,headRefOid --jq '.[] | "\(.state) \(.headRefOid)"' 2>/dev/null)"; then CLASS=UNKNOWN; return; fi
  while read -r st oid; do
    [ -n "$st" ] || continue
    has_pr=1
    [ "$st" = OPEN ] && open=1
    [ "$oid" = "$head" ] && pr_head_match=1
  done <<EOS
$states
EOS
  if [ "$open" = 1 ]; then CLASS=OPEN_PR; return; fi
  if [ "$has_pr" = 0 ]; then CLASS=NO_PR; return; fi
  if [ "$pr_head_match" = 1 ] || [ -n "$(g for-each-ref --count=1 --contains "$head" refs/remotes 2>/dev/null)" ]; then
    CLASS=SAFE
  else
    CLASS=UNPUSHED
  fi
}

first=1
while IFS=$'\t' read -r path head branch flags; do
  [ -n "$path" ] || continue
  if [ "$first" = 1 ]; then first=0; continue; fi   # main checkout
  case "$flags" in *P*) say "skip (directory missing, run 'git worktree prune'): $path"; continue ;; esac
  [ -d "$path" ] || continue
  real="$(realdir "$path")"
  [ "$real" = "$CURRENT" ] && continue
  classify "$path" "$head" "$branch" "$flags"
  kib="$(du -sk "$path" 2>/dev/null | awk '{print $1}')"
  dirty="$(g -C "$path" status --porcelain --untracked-files=all 2>/dev/null | wc -l | tr -d ' ')"
  unpushed="$(g -C "$path" rev-list --count HEAD --not --remotes 2>/dev/null || echo '?')"
  last="$(g -C "$path" log -1 --format=%cs HEAD 2>/dev/null || echo '?')"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$CLASS" "${kib:-0}" "$dirty" "$unpushed" "$last" "${branch:-(detached)}" "$path" >>"$RECORDS"
done <"$LIST"

mib() { awk -v k="$1" 'BEGIN { printf "%.1f MiB", k/1024 }'; }

report() {
  say "worktree prune report $(date -u '+%Y-%m-%dT%H:%M:%SZ') mode: $([ "$APPLY" = 1 ] && echo APPLY || echo DRY-RUN)"
  say "repo: $(g rev-parse --show-toplevel)   excluded: main checkout and current worktree"
  say ""
  say "class      count  size"
  for c in SAFE DIRTY LOCKED OPEN_PR NO_PR UNPUSHED UNKNOWN; do
    awk -F'\t' -v c="$c" '$1==c {n++; k+=$2} END {printf "%-10s %5d  %.1f MiB\n", c, n+0, k/1024}' "$RECORDS"
  done
  say ""
  say "kept worktrees (class, dirty files, unpushed commits, last commit, branch, path):"
  awk -F'\t' '$1!="SAFE" {printf "  %-9s dirty=%-4s unpushed=%-4s last=%s  %s  %s\n", $1, $3, $4, $5, $6, $7}' "$RECORDS"
  say ""
  say "SAFE worktrees ($([ "$APPLY" = 1 ] && echo 'being removed' || echo 'would be removed with --apply')):"
  awk -F'\t' '$1=="SAFE" {printf "  %s  %s\n", $6, $7}' "$RECORDS"
  say ""
  say "regenerable caches (size only, never deleted by this script):"
  for entry in $CACHE_PATHS; do
    name="${entry%%=*}"; cpath="${entry#*=}"
    if [ -d "$cpath" ]; then say "  $name: $(du -sk "$cpath" 2>/dev/null | awk '{printf "%.1f MiB", $1/1024}')  $cpath"
    else say "  $name: not present  $cpath"; fi
  done
  say "  opt-in cleanup (review, then run by hand; each path is regenerable and re-downloaded on demand):"
  for entry in $CACHE_PATHS; do
    cpath="${entry#*=}"; [ -d "$cpath" ] && say "    rm -r -- '$cpath'"
  done
}

removed=0; failed=0
if [ "$APPLY" = 1 ]; then
  while IFS=$'\t' read -r class _ _ _ _ _ path; do
    [ "$class" = SAFE ] || continue
    if git -C "$REPO" worktree remove "$path"; then removed=$((removed + 1)); say "removed: $path"
    else failed=$((failed + 1)); say "FAILED to remove (kept): $path"; fi
  done <"$RECORDS"
fi

{ report; [ "$APPLY" = 1 ] && say "" && say "removed=$removed failed=$failed"; } | tee "$REPORT_FILE"
[ "$failed" = 0 ]
