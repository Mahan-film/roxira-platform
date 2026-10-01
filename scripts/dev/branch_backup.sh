#!/usr/bin/env bash
# Create off-repository backups without changing branches, stashes, or worktrees.

set -euo pipefail

backup_dir="${HOME:?HOME must be set}/branch-backups"

usage() {
  cat <<'EOF'
Usage: branch_backup.sh [--dir PATH]

Backs up local branches containing commits absent from every configured remote.
It also records the stash list and a status plus diff for each linked worktree.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      [[ $# -ge 2 ]] || { printf '%s\n' '--dir requires a path.' >&2; exit 2; }
      backup_dir="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

git rev-parse --is-inside-work-tree >/dev/null
repository_root="$(git rev-parse --show-toplevel)"
timestamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"

unique_path() {
  local candidate="$1"
  local suffix=1
  while [[ -e "$candidate" ]]; do
    candidate="${1%.*}-${suffix}.${1##*.}"
    ((suffix += 1))
  done
  printf '%s\n' "$candidate"
}

safe_name() {
  local name="$1"
  name="${name//\//__}"
  name="${name// /_}"
  printf '%s\n' "$name"
}

stash_file="$(unique_path "$backup_dir/stash-${timestamp}.txt")"
git -C "$repository_root" stash list >"$stash_file"

worktree_count=0
current_worktree=""
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    worktree\ *)
      current_worktree="${line#worktree }"
      ;;
    '')
      if [[ -n "$current_worktree" ]]; then
        worktree_label="$(safe_name "$(basename "$current_worktree")")"
        status_file="$(unique_path "$backup_dir/worktree-${worktree_label}-${timestamp}.status")"
        patch_file="$(unique_path "$backup_dir/worktree-${worktree_label}-${timestamp}.patch")"
        git -C "$current_worktree" status --porcelain >"$status_file"
        git -C "$current_worktree" diff >"$patch_file"
        ((worktree_count += 1))
        current_worktree=""
      fi
      ;;
  esac
done < <(git -C "$repository_root" worktree list --porcelain)

# Porcelain output normally ends in a blank line. Handle a future format that does not.
if [[ -n "$current_worktree" ]]; then
  worktree_label="$(safe_name "$(basename "$current_worktree")")"
  status_file="$(unique_path "$backup_dir/worktree-${worktree_label}-${timestamp}.status")"
  patch_file="$(unique_path "$backup_dir/worktree-${worktree_label}-${timestamp}.patch")"
  git -C "$current_worktree" status --porcelain >"$status_file"
  git -C "$current_worktree" diff >"$patch_file"
  ((worktree_count += 1))
fi

bundle_count=0
while IFS= read -r branch; do
  [[ -n "$branch" ]] || continue
  ahead_count="$(git -C "$repository_root" rev-list --count "$branch" --not --remotes)"
  if (( ahead_count > 0 )); then
    branch_label="$(safe_name "$branch")"
    bundle_file="$(unique_path "$backup_dir/${branch_label}-${timestamp}.bundle")"
    git -C "$repository_root" bundle create "$bundle_file" "$branch"
    printf 'Backed up %s (%s unpushed commit(s)): %s\n' "$branch" "$ahead_count" "$bundle_file"
    ((bundle_count += 1))
  fi
done < <(git -C "$repository_root" for-each-ref --format='%(refname:short)' refs/heads/)

printf 'Backup summary: %s bundle(s), %s worktree record(s), stash list: %s\n' \
  "$bundle_count" "$worktree_count" "$stash_file"
