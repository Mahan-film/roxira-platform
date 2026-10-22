#!/usr/bin/env bash
# Publish staged legal JSONL files (law_watch_*.jsonl / iran_relay_*.jsonl) as a GitHub PR.
#
# Usage: scripts/legal/relay_publish.sh [checkout]   (default: ~/Developer/roxira-lawwatch)
#
# Rules (hard):
#   * add ONLY untracked/modified files matching data/legal/staged/{law_watch,iran_relay}_*.jsonl
#   * publish from a throwaway `git worktree` of origin/main; NEVER switch branches in the user
#     checkout (its data/ is immutable and an untracked staged file may already be tracked on
#     origin/main, which made `git checkout -b` abort with "would be overwritten")
#   * never touch other files, never force-push, never push to main
#   * exit 0 when there is nothing to publish
set -euo pipefail

CHECKOUT="${1:-$HOME/Developer/roxira-lawwatch}"

if ! git -C "$CHECKOUT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then  # worktrees have a .git FILE
  echo "relay: '$CHECKOUT' is not a git checkout" >&2
  exit 1
fi

FILES=()
while IFS= read -r -d '' entry; do
  [ -n "$entry" ] && FILES+=("${entry:3}")
done < <(git -C "$CHECKOUT" status --porcelain=v1 -z -- \
  'data/legal/staged/law_watch_*.jsonl' \
  'data/legal/staged/iran_relay_*.jsonl' 2>/dev/null || true)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "relay: nothing to publish"
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M)"
DATE="$(date +%Y-%m-%d)"
BRANCH="relay/${STAMP}"
if git -C "$CHECKOUT" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  BRANCH="${BRANCH}-2"
fi

git -C "$CHECKOUT" fetch --quiet origin main

# Keep a detached checkout (the launchd case) on fresh origin/main so scheduled runs use fresh code.
# Never delete anything: if git refuses (e.g. untracked files in the way), warn and carry on.
if ! git -C "$CHECKOUT" symbolic-ref --quiet HEAD >/dev/null 2>&1; then
  if ! git -C "$CHECKOUT" checkout --quiet --detach origin/main 2>/dev/null; then
    echo "relay: WARNING could not update '$CHECKOUT' to origin/main (files in the way); continuing" >&2
  fi
fi

# Files already published on origin/main (used to spot earlier <stem>_local-*.jsonl copies).
ORIGIN_STAGED="$(git -C "$CHECKOUT" ls-tree --name-only origin/main data/legal/staged/ 2>/dev/null || true)"

# Decide what actually goes out, using origin/main as the source of truth:
#   * already there, byte-identical -> skip (nothing new to publish)
#   * already there, different      -> never overwrite a tracked file; publish as
#                                      <stem>_local-<STAMP>.jsonl, unless origin/main already
#                                      holds a byte-identical <stem>_local-*.jsonl (skip)
#   * not there                     -> publish as is
SRC=()
DST=()
for f in "${FILES[@]}"; do
  target="$f"
  if git -C "$CHECKOUT" cat-file -e "origin/main:${f}" 2>/dev/null; then
    if git -C "$CHECKOUT" show "origin/main:${f}" 2>/dev/null | cmp -s - "${CHECKOUT}/${f}"; then
      echo "relay: skip ${f} (already on origin/main, identical)"
      continue
    fi
    stem="${f%.jsonl}"
    dup=""
    while IFS= read -r cand; do
      case "$cand" in
        "${stem}_local-"*.jsonl) ;;
        *) continue ;;
      esac
      if git -C "$CHECKOUT" show "origin/main:${cand}" 2>/dev/null | cmp -s - "${CHECKOUT}/${f}"; then
        dup="$cand"
        break
      fi
    done <<< "$ORIGIN_STAGED"
    if [ -n "$dup" ]; then
      echo "relay: skip ${f} (identical copy already on origin/main as ${dup})"
      continue
    fi
    target="${stem}_local-${STAMP}.jsonl"
  fi
  SRC+=("${CHECKOUT}/${f}")
  DST+=("${target}")
done

if [ "${#DST[@]}" -eq 0 ]; then
  echo "relay: nothing to publish"
  exit 0
fi

# Everything below happens in a detached worktree of origin/main; the user checkout is only read.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/relay-publish.XXXXXX")"
cleanup() {
  git -C "$CHECKOUT" worktree remove --force "$TMP" >/dev/null 2>&1 || rm -rf "$TMP"
}
trap cleanup EXIT

echo "relay: publishing ${#DST[@]} file(s) on ${BRANCH} from origin/main"
git -C "$CHECKOUT" worktree add --quiet --detach "$TMP" origin/main
git -C "$TMP" checkout --quiet -b "$BRANCH"

for i in "${!DST[@]}"; do
  target="${DST[$i]}"
  mkdir -p "$TMP/$(dirname "$target")"
  cp "${SRC[$i]}" "$TMP/${target}"
done

git -C "$TMP" add -- "${DST[@]}"

N=0
BODY="Relay batch ${DATE}"$'\n\n'"Files and row counts:"$'\n'
for target in "${DST[@]}"; do
  rows="$(wc -l < "$TMP/${target}" | tr -d ' ')"
  BODY+="- \`${target}\` (${rows} rows)"$'\n'
  N=$((N + 1))
done
BODY+=$'\n'"All rows are staging_status=proposed / needs_review=true; nothing reaches production until the hub merges this PR and a later collection build/eval approves it."

COMMIT_MSG="data(legal): relay batch ${DATE} (${N} files)"
git -C "$TMP" commit --quiet -m "$COMMIT_MSG"
# Data-only PR reviewed by the hub: skip the local CI pre-push hook (it runs the code test suite).
SKIP_LOCAL_CI=1 git -C "$TMP" push --quiet -u origin "$BRANCH"
(cd "$TMP" && gh pr create --base main --head "$BRANCH" --title "$COMMIT_MSG" --body "$BODY")
echo "relay: done (${N} files, branch ${BRANCH})"
