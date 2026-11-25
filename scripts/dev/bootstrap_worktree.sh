#!/usr/bin/env bash
# Bootstrap a worktree's node_modules via Copy-on-Write (CoW) cloning (#1318).
# Fills node_modules from one shared base checkout using:
#   - macOS APFS: cp -c -R
#   - Linux:      cp --reflink=auto -R
# when package-lock.json is identical, and falls back to `npm ci` otherwise.
# Nothing is deleted by this script.
set -euo pipefail

TARGET_WT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
TARGET_WT="$(cd "$TARGET_WT" && pwd -P)"

BASE_DIR="${2:-}"
if [ -z "$BASE_DIR" ]; then
  if [ -n "${ROXIRA_BASE_CHECKOUT:-}" ] && [ -d "$ROXIRA_BASE_CHECKOUT" ]; then
    BASE_DIR="$(cd "$ROXIRA_BASE_CHECKOUT" && pwd -P)"
  else
    common_git_dir="$(git -C "$TARGET_WT" rev-parse --git-common-dir 2>/dev/null || true)"
    if [ -n "$common_git_dir" ] && [ -d "$common_git_dir" ]; then
      case "$common_git_dir" in
        /*) base_git_dir="$common_git_dir" ;;
        *)  base_git_dir="$(cd "$TARGET_WT/$common_git_dir" && pwd -P)" ;;
      esac
      BASE_DIR="$(cd "$(dirname "$base_git_dir")" && pwd -P)"
    else
      BASE_DIR="$TARGET_WT"
    fi
  fi
else
  BASE_DIR="$(cd "$BASE_DIR" && pwd -P)"
fi

if [ "$TARGET_WT" = "$BASE_DIR" ]; then
  echo "bootstrap_worktree: target worktree is base checkout ($BASE_DIR); no cloning needed."
  exit 0
fi

# Detect Copy-on-Write support (APFS cp -c on macOS, cp --reflink=auto on Linux)
detect_cow_cmd() {
  if [ "${COW_DISABLE:-0}" = "1" ]; then
    echo ""
    return 0
  fi
  local test_dir="${TMPDIR:-/tmp}"
  if [ -d "$TARGET_WT" ] && [ -w "$TARGET_WT" ]; then
    test_dir="$TARGET_WT"
  fi
  local s="$test_dir/.cow_probe_src_$$"
  local d="$test_dir/.cow_probe_dst_$$"
  echo "probe" > "$s" 2>/dev/null || true

  local chosen=""
  if cp -c "$s" "$d" >/dev/null 2>&1; then
    chosen="apfs"
  elif cp --reflink=auto "$s" "$d" >/dev/null 2>&1; then
    chosen="reflink"
  fi
  rm -f "$s" "$d" 2>/dev/null || true
  echo "$chosen"
}

COW_CMD="$(detect_cow_cmd)"
NPM="${NPM_CMD:-npm}"

# Modules to inspect and bootstrap
modules=()
if [ $# -ge 3 ]; then
  shift 2
  modules=("$@")
elif [ -n "${BOOTSTRAP_MODULES:-}" ]; then
  IFS=' :' read -r -a modules <<< "$BOOTSTRAP_MODULES"
else
  # Default modules with npm dependencies in Roxira
  modules=("output_apps/enterprise_hub" "output_apps/enterprise_hub/frontend")
  [ -f "$TARGET_WT/package-lock.json" ] && modules+=(".")
fi

for mod in "${modules[@]}"; do
  # Normalize path
  rel="${mod#.}"
  rel="${rel#/}"
  [ -z "$rel" ] && rel="."

  wt_dir="$TARGET_WT/$rel"
  base_dir="$BASE_DIR/$rel"
  wt_lock="$wt_dir/package-lock.json"
  base_lock="$base_dir/package-lock.json"
  wt_nm="$wt_dir/node_modules"
  base_nm="$base_dir/node_modules"

  if [ ! -f "$wt_lock" ]; then
    continue
  fi

  # Never delete or overwrite existing non-empty node_modules
  if [ -d "$wt_nm" ] && [ -n "$(ls -A "$wt_nm" 2>/dev/null)" ]; then
    echo "bootstrap_worktree: $rel/node_modules already populated; leaving untouched."
    continue
  fi

  # Check if lockfiles are identical
  same_lock=0
  if [ -f "$base_lock" ] && cmp -s "$base_lock" "$wt_lock"; then
    same_lock=1
  fi

  # Check if base node_modules has contents
  base_nm_ready=0
  if [ -d "$base_nm" ] && [ -n "$(ls -A "$base_nm" 2>/dev/null)" ]; then
    base_nm_ready=1
  fi

  cloned=0
  if [ "$same_lock" = "1" ] && [ "$base_nm_ready" = "1" ] && [ -n "$COW_CMD" ]; then
    echo "bootstrap_worktree: lockfiles identical for $rel; cloning node_modules via CoW ($COW_CMD)..."

    # Clean up empty directory if present before cp
    if [ -d "$wt_nm" ] && [ -z "$(ls -A "$wt_nm" 2>/dev/null)" ]; then
      rmdir "$wt_nm" 2>/dev/null || true
    fi

    if [ "$COW_CMD" = "apfs" ]; then
      cp -c -R "$base_nm" "$wt_nm" 2>/dev/null || true
    elif [ "$COW_CMD" = "reflink" ]; then
      cp --reflink=auto -R "$base_nm" "$wt_nm" 2>/dev/null || true
    fi

    if [ -d "$wt_nm" ] && [ -n "$(ls -A "$wt_nm" 2>/dev/null)" ]; then
      cloned=1
      echo "bootstrap_worktree: successfully CoW-cloned $rel/node_modules from $BASE_DIR"
    else
      echo "bootstrap_worktree: CoW clone failed or incomplete; falling back to $NPM ci"
    fi
  else
    if [ "$same_lock" = "0" ]; then
      echo "bootstrap_worktree: package-lock.json in $rel differs from base; falling back to $NPM ci"
    elif [ "$base_nm_ready" = "0" ]; then
      echo "bootstrap_worktree: base node_modules missing in $base_dir; falling back to $NPM ci"
    elif [ -z "$COW_CMD" ]; then
      echo "bootstrap_worktree: copy-on-write clone unsupported on this filesystem; falling back to $NPM ci"
    fi
  fi

  if [ "$cloned" = "0" ]; then
    echo "bootstrap_worktree: running $NPM ci in $rel..."
    (cd "$wt_dir" && "$NPM" ci)
  fi
done
