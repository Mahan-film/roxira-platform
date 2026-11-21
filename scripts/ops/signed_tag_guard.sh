#!/usr/bin/env bash
# R20-4 (#1020): Signed-tag guard for production pull deploys.
#
# Corrected loop: iterates `deploy/*` tags newest-first and selects the newest
# tag that PASSES SSH signature verification against ALLOWED_SIGNERS_FILE.
# Unsigned or untrusted newer tags are logged and skipped instead of halting
# all deploys.
#
# Output on stdout (exit 0): "<tag> <commit_sha>"
# Exit 1 (fail closed): missing/empty allowed_signers file or no valid signed tag.
set -euo pipefail

ALLOWED_SIGNERS_FILE="${ALLOWED_SIGNERS_FILE:-/etc/roxira/allowed_signers}"
TAG_PATTERN="${DEPLOY_TAG_PATTERN:-deploy/*}"

if [[ ! -s "$ALLOWED_SIGNERS_FILE" ]]; then
  echo "signed_tag_guard: allowed signers file missing or empty: $ALLOWED_SIGNERS_FILE" >&2
  exit 1
fi

tags=()
while IFS= read -r t; do
  [[ -n "$t" ]] && tags+=("$t")
done < <(git tag --list "$TAG_PATTERN" --sort=-creatordate 2>/dev/null || true)

if [[ ${#tags[@]} -eq 0 ]]; then
  echo "signed_tag_guard: no tags matching '$TAG_PATTERN'" >&2
  exit 1
fi

for tag in "${tags[@]}"; do
  [[ -n "$tag" ]] || continue
  if git -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$ALLOWED_SIGNERS_FILE" tag -v "$tag" >/dev/null 2>&1; then
    commit_sha="$(git rev-list -n 1 "$tag")"
    printf '%s %s\n' "$tag" "$commit_sha"
    exit 0
  else
    echo "signed_tag_guard: ignoring unsigned or invalid tag: $tag" >&2
  fi
done

echo "signed_tag_guard: no valid SSH-signed tag matching '$TAG_PATTERN' found" >&2
exit 1
