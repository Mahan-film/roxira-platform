#!/usr/bin/env bash
# Run locally the same checks .github/workflows/ci.yml runs, so GitHub Actions minutes
# are not needed. Never runs pytest over src/ outside the quarantine in src/ci_quarantine.py
# (src/conftest.py applies it; the pytest command below is exactly what CI runs).
#
# Usage: scripts/dev/local_ci.sh [--base <git-ref>]   (default base: origin/main)
# Env:   LOCAL_CI_SKIP_PYTEST=1 to skip the unit-test step.
set -euo pipefail

BASE_REF="origin/main"
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_REF="${2:?--base needs a ref}"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Self-bootstrap: if ruff or pytest are missing, create a private virtualenv once
# (LOCAL_CI_VENV, default ~/venvs/roxira), install the CI tools there and use it.
# Set LOCAL_CI_NO_BOOTSTRAP=1 to disable.
LOCAL_CI_VENV="${LOCAL_CI_VENV:-$HOME/venvs/roxira}"
if [ -x "$LOCAL_CI_VENV/bin/python" ]; then
  PATH="$LOCAL_CI_VENV/bin:$PATH"
fi
if [ "${LOCAL_CI_NO_BOOTSTRAP:-0}" != "1" ] \
  && { ! command -v ruff >/dev/null 2>&1 || ! command -v pytest >/dev/null 2>&1; }; then
  echo "=== bootstrap: installing CI tools into $LOCAL_CI_VENV (first run only) ==="
  if [ ! -x "$LOCAL_CI_VENV/bin/python" ]; then
    python3 -m venv "$LOCAL_CI_VENV"
  fi
  "$LOCAL_CI_VENV/bin/python" -m pip install --quiet --upgrade pip
  "$LOCAL_CI_VENV/bin/python" -m pip install --quiet 'ruff>=0.16.2,<0.17' \
    -r "$REPO_ROOT/ci/requirements-test.txt"
  PATH="$LOCAL_CI_VENV/bin:$PATH"
  echo "=== bootstrap done ==="
fi

PASS=()
FAIL=()
SKIP=()

# run_step <name> <command...>: record PASS/FAIL, never abort the run.
run_step() {
  local name="$1"
  shift
  echo
  echo "=== $name ==="
  if "$@"; then
    PASS+=("$name")
  else
    FAIL+=("$name")
  fi
}

skip_step() {
  echo
  echo "=== $1 === SKIPPED: $2"
  SKIP+=("$1 ($2)")
}

have() { command -v "$1" >/dev/null 2>&1; }

changed_files() {
  if git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
    git diff --name-only "$BASE_REF"...HEAD
    git diff --name-only HEAD
  else
    echo "warning: base ref $BASE_REF not found; treating everything as changed" >&2
    git ls-files
  fi
}
CHANGED="$(changed_files | sort -u)"
changed_matches() { printf '%s\n' "$CHANGED" | grep -Eq "$1"; }

# ruff: CI reports but does not block (thousands of pre-existing violations).
step_ruff() {
  ruff check . --statistics | head -25 || true
  return 0
}

# undefined names: blocking.
step_undefined_names() {
  ruff check --select F821,F822,F823 \
    output_apps/generated_modules/smartjudge output_apps/ecosystem_core/src src \
    --exclude output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py \
    --exclude src/legal_intelligence/inject_remaining_corpus.py
}

# system inventory: blocking. --check does not modify the tree. If it fails, run
# `python3 scripts/gen_system_inventory.py` and commit the generated file.
step_inventory() {
  python3 scripts/gen_system_inventory.py --check
}

# pytest: blocking; the quarantine list is applied by src/conftest.py.
step_pytest() {
  if ! grep -q 'ci_quarantine' src/conftest.py; then
    echo "src/conftest.py no longer applies src/ci_quarantine.py; refusing to run pytest." >&2
    return 1
  fi
  pytest -m "not integration" -q --timeout=60
}

# gitleaks: scan only commits this branch adds (history contains secrets on purpose).
step_gitleaks() {
  local range
  if git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
    range="$BASE_REF..HEAD"
  else
    range="-1 HEAD"
  fi
  echo "Scanning $range"
  gitleaks git --config .gitleaks.toml --log-opts="$range" --redact --no-banner --verbose .
}

# frontend: lint is non-blocking like CI; build is blocking.
step_frontend() {
  (
    cd output_apps/enterprise_hub/frontend
    npm ci
    npm run lint || echo "ESLint reported errors (non-blocking, as in CI)"
    NEXT_TELEMETRY_DISABLED=1 npm run build
  )
}

if have ruff; then
  run_step "ruff (report-only)" step_ruff
  run_step "undefined names" step_undefined_names
else
  skip_step "ruff" "not installed: pip install 'ruff>=0.16.2,<0.17'"
  FAIL+=("undefined names (ruff missing)")
fi

run_step "system inventory up to date" step_inventory

if [ "${LOCAL_CI_SKIP_PYTEST:-0}" = "1" ]; then
  skip_step "pytest (unit)" "LOCAL_CI_SKIP_PYTEST=1"
elif have pytest; then
  run_step "pytest (unit, quarantined)" step_pytest
else
  skip_step "pytest (unit)" "not installed: pip install -r ci/requirements-test.txt"
  FAIL+=("pytest (missing)")
fi

if have gitleaks; then
  run_step "gitleaks (new commits)" step_gitleaks
else
  skip_step "gitleaks" "not installed (brew install gitleaks)"
fi

if changed_matches '^output_apps/enterprise_hub/frontend/'; then
  if have npm; then
    run_step "frontend lint + build" step_frontend
  else
    skip_step "frontend" "npm not installed"
    FAIL+=("frontend (npm missing)")
  fi
else
  skip_step "frontend" "no changes under output_apps/enterprise_hub/frontend"
fi

echo
echo "================ LOCAL CI SUMMARY ================"
for s in "${PASS[@]+"${PASS[@]}"}"; do echo "PASS  $s"; done
for s in "${SKIP[@]+"${SKIP[@]}"}"; do echo "SKIP  $s"; done
for s in "${FAIL[@]+"${FAIL[@]}"}"; do echo "FAIL  $s"; done
echo "=================================================="
if [ "${#FAIL[@]}" -gt 0 ]; then
  echo "RESULT: FAIL (${#FAIL[@]} failing)"
  exit 1
fi
echo "RESULT: PASS"
