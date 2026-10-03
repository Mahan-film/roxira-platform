#!/usr/bin/env bash
# Install a git pre-push hook that runs scripts/dev/local_ci.sh.
# Skip once with: SKIP_LOCAL_CI=1 git push
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

cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# roxira-local-ci: installed by scripts/dev/install_hooks.sh
set -euo pipefail
if [ "${SKIP_LOCAL_CI:-0}" = "1" ]; then
  echo "SKIP_LOCAL_CI=1: skipping local CI"
  exit 0
fi
ROOT="$(git rev-parse --show-toplevel)"
exec "$ROOT/scripts/dev/local_ci.sh"
HOOK_EOF
chmod +x "$HOOK"
echo "Installed pre-push hook: $HOOK"
