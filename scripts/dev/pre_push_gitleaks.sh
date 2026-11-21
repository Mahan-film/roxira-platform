#!/usr/bin/env bash
# Pre-push secret scan: gitleaks on exactly the commits being pushed (replaces GitHub push
# protection). Reads the pre-push hook's stdin ("<local ref> <local sha> <remote ref> <remote sha>"
# per line). Findings are redacted. History already holds known secrets on purpose
# (docs/STRATEGY.md §6), so only commits not yet on the remote are scanned.
# Skip is deliberately not offered here: SKIP_LOCAL_CI does not disable this step.
# Usage (from the hook): printf '%s\n' "$input" | scripts/dev/pre_push_gitleaks.sh
set -euo pipefail

ZERO="0000000000000000000000000000000000000000"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GL="${GITLEAKS:-}"
if [ -z "$GL" ]; then
  GL="$(bash "$ROOT/scripts/dev/install_gitleaks.sh")" || {
    echo "pre-push gitleaks: could not install the pinned binary; refusing to push unscanned." >&2
    exit 1
  }
fi

rc=0
while read -r _lref lsha _rref rsha; do
  [ -n "${lsha:-}" ] || continue
  [ "$lsha" = "$ZERO" ] && continue # deleting a ref: nothing to scan
  if [ "$rsha" = "$ZERO" ]; then
    # New branch: scan commits that no remote-tracking ref already has.
    range="$lsha --not --remotes"
  else
    range="$rsha..$lsha"
  fi
  echo "pre-push gitleaks: scanning $range"
  if ! "$GL" git --config .gitleaks.toml --log-opts="$range" --redact --no-banner --verbose .; then
    rc=1
  fi
done

if [ "$rc" -ne 0 ]; then
  echo "pre-push gitleaks: possible secret in the commits being pushed. Push blocked." >&2
  echo "Remove it from the commit (amend or rebase), rotate the key if it was real." >&2
  echo "A proven false positive goes in .gitleaks.toml with a comment saying why." >&2
fi
exit "$rc"
