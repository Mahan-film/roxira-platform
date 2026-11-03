#!/usr/bin/env bash
# pre-push guard: refuse to push the pre-2026-11-03 history (it contains live keys).
# The public repo was rebuilt from a scrubbed history (docs/ops/PUBLIC_REPO_MIGRATION.md).
# Any commit whose root is the old root commit below must never reach it again.
# Pushes to the private archive (URL contains "roxira-platform-private") are allowed.
#
# Called by the pre-push hook with git's pre-push arguments and stdin:
#   guard_old_history.sh <remote-name> <remote-url>   (stdin: <lref> <lsha> <rref> <rsha>)
# Installed as .git/hooks/guard-old-history by scripts/dev/install_hooks.sh.
set -euo pipefail

OLD_ROOT=c0c363024259da034f7333d66f2e32006cc8ab3a
ZERO=0000000000000000000000000000000000000000
url="${2:-${1:-}}"

case "$url" in
  *roxira-platform-private*) cat >/dev/null; exit 0 ;;
esac

bad=0
while read -r lref lsha _rref _rsha; do
  [ -n "${lsha:-}" ] || continue
  [ "$lsha" = "$ZERO" ] && continue
  if git rev-list --max-parents=0 "$lsha" 2>/dev/null | grep -qx "$OLD_ROOT"; then
    echo "guard-old-history: REFUSED $lref -> $url" >&2
    echo "  it contains the old unscrubbed history (root ${OLD_ROOT:0:8})." >&2
    echo "  Rebase your work onto the new origin/main (see docs/ops/PUBLIC_REPO_MIGRATION.md)." >&2
    bad=1
  fi
done
exit "$bad"
