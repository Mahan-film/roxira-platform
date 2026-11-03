#!/usr/bin/env bash
# Install a git pre-push hook that
#   1. refuses to push the old unscrubbed history (scripts/dev/guard_old_history.sh), and
#   2. runs scripts/dev/local_ci.sh.
# Skip local CI once with: SKIP_LOCAL_CI=1 git push   (the history guard always runs)
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-path hooks)"
case "$HOOKS_DIR" in /*) ;; *) HOOKS_DIR="$REPO_ROOT/$HOOKS_DIR" ;; esac
HOOK="$HOOKS_DIR/pre-push"

mkdir -p "$HOOKS_DIR"
if [ -e "$HOOK" ] && ! grep -q 'roxira-local-ci' "$HOOK"; then
  cp "$HOOK" "$HOOK.bak"
  echo "Existing pre-push hook saved to $HOOK.bak"
fi

install -m 0755 "$REPO_ROOT/scripts/dev/guard_old_history.sh" "$HOOKS_DIR/guard-old-history"

cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# roxira-local-ci: installed by scripts/dev/install_hooks.sh
set -euo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
input="$(cat)"
if [ -x "$HOOKS_DIR/guard-old-history" ]; then
  printf '%s\n' "$input" | "$HOOKS_DIR/guard-old-history" "$@"
fi
if [ "${SKIP_LOCAL_CI:-0}" = "1" ]; then
  echo "SKIP_LOCAL_CI=1: skipping local CI"
  exit 0
fi
ROOT="$(git rev-parse --show-toplevel)"
# Drop GIT_DIR & co. that git exports to hooks (local_ci.sh also does this).
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)
cd "$ROOT"
exec "$ROOT/scripts/dev/local_ci.sh"
HOOK_EOF
chmod +x "$HOOK"
echo "Installed pre-push hook: $HOOK (+ guard-old-history)"
