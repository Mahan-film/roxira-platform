#!/usr/bin/env bash
# Tests for bootstrap_worktree.sh and claim.sh disk guard (#1318).
# Validates:
#   1. Identical lockfile uses Copy-on-Write (CoW) clone.
#   2. Different lockfile falls back to npm ci.
#   3. No reflink/CoW support falls back to npm ci.
#   4. Existing target files are preserved (non-destructive guarantee).
#   5. claim.sh refuses below 8 GiB free with clear message & prune dry-run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BOOTSTRAP_SCRIPT="$ROOT/scripts/dev/bootstrap_worktree.sh"
CLAIM_SCRIPT="$ROOT/scripts/dev/claim.sh"

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/test_bootstrap_XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

# Create mock binaries to record invocations and provide offline support
MOCK_BIN="$TEST_TMP/mock_bin"
mkdir -p "$MOCK_BIN"
MOCK_LOG="$TEST_TMP/mock_npm.log"
cat <<'EOF' > "$MOCK_BIN/npm"
#!/usr/bin/env bash
echo "npm $* (cwd: $(pwd))" >> "$MOCK_NPM_LOG"
mkdir -p node_modules
echo "installed by npm ci" > node_modules/installed_by_npm.txt
EOF
chmod +x "$MOCK_BIN/npm"

cat <<'EOF' > "$MOCK_BIN/gh"
#!/usr/bin/env bash
case "$*" in
  *"-q .title"*)
    echo "Mock Issue Title"
    exit 0
    ;;
  *"-q .login"*)
    echo "mock-user"
    exit 0
    ;;
  *".labels[].name"*)
    echo ""
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x "$MOCK_BIN/gh"

export MOCK_NPM_LOG="$MOCK_LOG"
export NPM_CMD="$MOCK_BIN/npm"
export PATH="$MOCK_BIN:$PATH"

pass_count=0
fail_count=0

run_test() {
  local name="$1"
  shift
  echo -n "RUN: $name... "
  if "$@"; then
    echo "PASS"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL"
    fail_count=$((fail_count + 1))
  fi
}

# 1. Same lockfile -> Copy-on-Write clone
test_same_lock_uses_cow() {
  local base="$TEST_TMP/case1/base"
  local wt="$TEST_TMP/case1/wt"
  mkdir -p "$base/mod/node_modules/dummy_pkg" "$wt/mod"
  echo '{"name": "test", "version": "1.0.0"}' > "$base/mod/package-lock.json"
  cp "$base/mod/package-lock.json" "$wt/mod/package-lock.json"
  echo "marker_from_base" > "$base/mod/node_modules/dummy_pkg/marker.txt"

  rm -f "$MOCK_LOG"
  bash "$BOOTSTRAP_SCRIPT" "$wt" "$base" "mod" >/dev/null

  [ -f "$wt/mod/node_modules/dummy_pkg/marker.txt" ] || return 1
  [ "$(cat "$wt/mod/node_modules/dummy_pkg/marker.txt")" = "marker_from_base" ] || return 1
  # Verify npm ci was NOT called
  if [ -f "$MOCK_LOG" ] && grep -q "npm ci" "$MOCK_LOG"; then
    return 1
  fi
  return 0
}

# 2. Different lockfile -> falls back to npm ci
test_different_lock_fallback() {
  local base="$TEST_TMP/case2/base"
  local wt="$TEST_TMP/case2/wt"
  mkdir -p "$base/mod/node_modules/dummy_pkg" "$wt/mod"
  echo '{"name": "test", "version": "1.0.0"}' > "$base/mod/package-lock.json"
  echo '{"name": "test", "version": "2.0.0"}' > "$wt/mod/package-lock.json"
  echo "marker_from_base" > "$base/mod/node_modules/dummy_pkg/marker.txt"

  rm -f "$MOCK_LOG"
  bash "$BOOTSTRAP_SCRIPT" "$wt" "$base" "mod" >/dev/null

  [ -f "$MOCK_LOG" ] || return 1
  grep -q "npm ci" "$MOCK_LOG" || return 1
  [ -f "$wt/mod/node_modules/installed_by_npm.txt" ] || return 1
  return 0
}

# 3. No reflink / CoW support -> falls back to npm ci
test_no_reflink_support_fallback() {
  local base="$TEST_TMP/case3/base"
  local wt="$TEST_TMP/case3/wt"
  mkdir -p "$base/mod/node_modules/dummy_pkg" "$wt/mod"
  echo '{"name": "test", "version": "1.0.0"}' > "$base/mod/package-lock.json"
  cp "$base/mod/package-lock.json" "$wt/mod/package-lock.json"
  echo "marker_from_base" > "$base/mod/node_modules/dummy_pkg/marker.txt"

  rm -f "$MOCK_LOG"
  COW_DISABLE=1 bash "$BOOTSTRAP_SCRIPT" "$wt" "$base" "mod" >/dev/null

  [ -f "$MOCK_LOG" ] || return 1
  grep -q "npm ci" "$MOCK_LOG" || return 1
  [ -f "$wt/mod/node_modules/installed_by_npm.txt" ] || return 1
  return 0
}

# 4. Non-destructive guarantee: existing non-empty node_modules left untouched
test_non_destructive_guarantee() {
  local base="$TEST_TMP/case4/base"
  local wt="$TEST_TMP/case4/wt"
  mkdir -p "$base/mod/node_modules/base_pkg" "$wt/mod/node_modules/pre_existing_pkg"
  echo '{"name": "test", "version": "1.0.0"}' > "$base/mod/package-lock.json"
  cp "$base/mod/package-lock.json" "$wt/mod/package-lock.json"
  echo "pre_existing" > "$wt/mod/node_modules/pre_existing_pkg/data.txt"

  rm -f "$MOCK_LOG"
  bash "$BOOTSTRAP_SCRIPT" "$wt" "$base" "mod" >/dev/null

  # Verify existing file is preserved
  [ -f "$wt/mod/node_modules/pre_existing_pkg/data.txt" ] || return 1
  [ "$(cat "$wt/mod/node_modules/pre_existing_pkg/data.txt")" = "pre_existing" ] || return 1
  # Verify npm ci was not called
  if [ -f "$MOCK_LOG" ] && grep -q "npm ci" "$MOCK_LOG"; then
    return 1
  fi
  return 0
}

# 5. claim.sh disk guard refuses below threshold and prints prune dry-run
test_claim_disk_guard() {
  local out
  mkdir -p "$TEST_TMP/wt_dummy"
  out="$(cd "$ROOT" && ROXIRA_MIN_FREE_GIB=999999999 ROXIRA_WT_ROOT="$TEST_TMP/wt_dummy" bash "$CLAIM_SCRIPT" 123 test-slug 2>&1 || true)"
  echo "$out" | grep -q "claim.sh: ERROR: disk space too low" || return 1
  echo "$out" | grep -q "worktree prune --dry-run" || return 1
  return 0
}

echo "=== Running bootstrap_worktree and claim disk guard tests ==="
run_test "same_lock_uses_cow" test_same_lock_uses_cow
run_test "different_lock_fallback" test_different_lock_fallback
run_test "no_reflink_support_fallback" test_no_reflink_support_fallback
run_test "non_destructive_guarantee" test_non_destructive_guarantee
run_test "claim_disk_guard" test_claim_disk_guard

echo "==========================================================="
echo "PASSED: $pass_count, FAILED: $fail_count"

if [ "$fail_count" -ne 0 ]; then
  exit 1
fi
