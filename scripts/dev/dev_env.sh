#!/usr/bin/env bash
# scripts/dev/dev_env.sh
# Build and sync the locked Python development environment using uv (Issue #1320 / T347).
# No sudo required. Runs identically on macOS and Linux.
#
# Usage:
#   bash scripts/dev/dev_env.sh           # build/sync .venv at repo root
#   source scripts/dev/dev_env.sh         # build/sync and activate in current shell
#   bash scripts/dev/dev_env.sh --check   # verify lockfile and venv are in sync

set -euo pipefail

# 1. Locate repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 2. Locate or bootstrap uv (no sudo required)
UV_BIN="$(command -v uv 2>/dev/null || true)"
if [ -z "$UV_BIN" ]; then
  for candidate in \
    "$HOME/.cargo/bin/uv" \
    "$HOME/.local/bin/uv" \
    "/opt/homebrew/bin/uv" \
    "/usr/local/bin/uv"; do
    if [ -x "$candidate" ]; then
      UV_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$UV_BIN" ]; then
  echo "dev_env: uv not found in PATH or standard user directories."
  echo "Installing uv into ~/.local/bin (user space, no sudo)..."
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | env CARGO_HOME="$HOME/.local" sh
  else
    python3 -m pip install --user --quiet uv
  fi
  UV_BIN="$HOME/.local/bin/uv"
  if [ ! -x "$UV_BIN" ]; then
    echo "dev_env: ERROR: failed to find or install uv." >&2
    exit 1
  fi
fi

# Ensure uv is in PATH for child processes
export PATH="$(dirname "$UV_BIN"):$PATH"

# 3. Target virtual environment
VENV_PATH="${ROXIRA_DEV_VENV:-$REPO_ROOT/.venv}"

# 4. Handle --check flag
if [ "${1:-}" = "--check" ]; then
  echo "dev_env: checking lockfile freshness..."
  "$UV_BIN" lock --check --directory "$REPO_ROOT"
  if [ ! -x "$VENV_PATH/bin/pytest" ] || [ ! -x "$VENV_PATH/bin/ruff" ]; then
    echo "dev_env: ERROR: virtualenv at $VENV_PATH missing pytest or ruff." >&2
    exit 1
  fi
  echo "dev_env: OK: lockfile and virtualenv at $VENV_PATH are healthy."
  exit 0
fi

# 5. Build/sync the virtual environment
echo "dev_env: syncing Python environment via uv (lockfile: uv.lock)..."
if [ -f "$REPO_ROOT/uv.lock" ]; then
  "$UV_BIN" sync --frozen --directory "$REPO_ROOT"
else
  "$UV_BIN" sync --directory "$REPO_ROOT"
fi

if [ ! -x "$VENV_PATH/bin/pytest" ] || [ ! -x "$VENV_PATH/bin/ruff" ]; then
  echo "dev_env: ERROR: virtualenv created but pytest/ruff not found in $VENV_PATH/bin" >&2
  exit 1
fi

echo "dev_env: virtual environment ready at $VENV_PATH"
echo "  python: $("$VENV_PATH/bin/python" --version)"
echo "  pytest: $("$VENV_PATH/bin/pytest" --version 2>/dev/null | head -n1)"
echo "  ruff:   $("$VENV_PATH/bin/ruff" --version 2>/dev/null)"

# 6. If sourced in an interactive shell, activate it
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  # shellcheck source=/dev/null
  source "$VENV_PATH/bin/activate"
  echo "dev_env: activated environment in current shell."
else
  echo "To activate:"
  echo "  source \"$VENV_PATH/bin/activate\""
fi
