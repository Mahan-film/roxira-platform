#!/usr/bin/env bash
# Weekly mutation testing for the legal data scripts: does their own test file actually
# catch bugs? Runs mutmut 3 against three modules, each with its own tests only:
#
#   scripts/legal/iran_relay.py             scripts/legal/tests/test_iran_relay.py
#   scripts/legal/split_rc_law_articles.py  scripts/legal/tests/test_split_rc_law_articles.py
#   scripts/legal/ingest_regulations.py     scripts/legal/tests/test_regulations_relay.py
#
# Report-only: it never changes product code and never blocks anything. mutmut 3 has no
# --paths-to-mutate/--test-files flags, so a throwaway setup.cfg is written per module
# (paths_to_mutate / tests_dir / also_copy). The run happens in a throwaway git worktree
# under /var/lib/roxira-mutation/wt (never in the live checkout), which is removed on exit.
# The whole run is wrapped in `timeout 45m`; the per-module summary is appended to
# /root/deploy-state/mutation-last.txt and, when present, mailed via
# scripts/ops/notify/notify.py. See docs/ops/MUTATION_TESTING.md.
#
# Usage: bash scripts/dev/mutation_weekly.sh
# Env:   ROXIRA_PLATFORM (default /opt/roxira_platform)  ROXIRA_MUTATION_DIR (default /var/lib/roxira-mutation)
#        ROXIRA_MUTATION_STATE (default /root/deploy-state)  ROXIRA_MUTATION_NOTIFY (notifier path)
set -euo pipefail

PLATFORM="${ROXIRA_PLATFORM:-/opt/roxira_platform}"
BASE_DIR="${ROXIRA_MUTATION_DIR:-/var/lib/roxira-mutation}"
VENV="$BASE_DIR/venv"
WT="$BASE_DIR/wt"
WORK="$BASE_DIR/work"
SUMMARY_DIR="${ROXIRA_MUTATION_STATE:-/root/deploy-state}"
SUMMARY="$SUMMARY_DIR/mutation-last.txt"
NOTIFY="${ROXIRA_MUTATION_NOTIFY:-$PLATFORM/scripts/ops/notify/notify.py}"
MUTMUT_PIN='mutmut>=3,<4'

# module|test-file pairs; the tests import their module and fixtures by absolute path from
# the repo root, so the whole scripts/legal tree is copied into mutmut's mutants/ dir.
MODULES=(
  "scripts/legal/iran_relay.py|scripts/legal/tests/test_iran_relay.py"
  "scripts/legal/split_rc_law_articles.py|scripts/legal/tests/test_split_rc_law_articles.py"
  "scripts/legal/ingest_regulations.py|scripts/legal/tests/test_regulations_relay.py"
)

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

cleanup() {
  if [ -d "$WT" ]; then
    git -C "$PLATFORM" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
    git -C "$PLATFORM" worktree prune >/dev/null 2>&1 || true
  fi
}

# Wrap the whole run in a 45-minute timeout. The outer invocation only execs the timer; the
# inner one does the work and owns the EXIT/TERM trap that removes the worktree.
if [ "${1:-}" != "--inner" ]; then
  exec timeout --signal=TERM --kill-after=60s 45m bash "$0" --inner
fi
trap cleanup EXIT
trap 'cleanup; exit 143' TERM INT

for tool in git python3 timeout; do
  command -v "$tool" >/dev/null 2>&1 || { log "ERROR: $tool is required"; exit 1; }
done
git -C "$PLATFORM" rev-parse --git-dir >/dev/null 2>&1 \
  || { log "ERROR: $PLATFORM is not a git repository"; exit 1; }

log "mutation weekly start (platform=$PLATFORM, base=$BASE_DIR)"
mkdir -p "$BASE_DIR" "$WORK" "$SUMMARY_DIR"

# ---- private mutmut venv (installed once, then reused) ----
if [ ! -x "$VENV/bin/mutmut" ]; then
  log "bootstrapping $VENV and installing $MUTMUT_PIN (first run only)"
  python3 -m venv "$VENV"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  # pytest is the runner mutmut invokes; the three tests are pytest tests.
  "$VENV/bin/python" -m pip install --quiet "$MUTMUT_PIN" 'pytest>=7'
fi
MUTMUT="$VENV/bin/mutmut"
# mutmut's default runner is `python -m pytest`; put the venv first so it (and pytest) resolve
# there even when the script is started by systemd with a minimal PATH.
export PATH="$VENV/bin:$PATH"

# ---- one throwaway worktree from origin/main, removed on exit ----
if [ -d "$WT" ]; then
  git -C "$PLATFORM" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
fi
git -C "$PLATFORM" worktree prune >/dev/null 2>&1 || true
log "creating throwaway worktree $WT from origin/main"
git -C "$PLATFORM" worktree add --detach "$WT" origin/main >/dev/null

# first integer following a status word in a mutmut output file, else 0
count() {
  local n
  n="$(grep -ioE "${2}[^0-9]{0,16}[0-9]+" "$1" 2>/dev/null | grep -oE '[0-9]+' | head -n1 || true)"
  printf '%s' "${n:-0}"
}

{
  printf '=== mutation weekly %s ===\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'platform=%s base=origin/main\n' "$PLATFORM"
} > "$SUMMARY"

notify_lines=""
idx=0
for entry in "${MODULES[@]}"; do
  idx=$((idx + 1))
  module="${entry%%|*}"
  test="${entry##*|}"
  log "module $idx/${#MODULES[@]}: $module (tests: $test)"

  # clean slate for this module: drop mutmut's cache/mutants dir and the previous setup.cfg
  git -C "$WT" reset --hard --quiet origin/main
  git -C "$WT" clean -fdxq

  # mutmut 3 reads [mutmut] from setup.cfg (there is no --paths-to-mutate/--test-files).
  # also_copy brings the sibling modules, the tests and their fixtures into mutants/.
  cat > "$WT/setup.cfg" <<EOF
[mutmut]
paths_to_mutate=$module
tests_dir=$test
also_copy=
    scripts/legal
EOF

  run_log="$WORK/run-$idx.log"
  res_log="$WORK/results-$idx.log"
  surv_log="$WORK/survived-$idx.log"

  ( cd "$WT" && "$MUTMUT" run ) >"$run_log" 2>&1 || true
  ( cd "$WT" && "$MUTMUT" results ) >"$res_log" 2>&1 || true
  # --all appends one line per mutant (file.py:line) as a fallback id source
  ( cd "$WT" && "$MUTMUT" results --all ) >>"$res_log" 2>&1 || true
  ( cd "$WT" && "$MUTMUT" results survived ) >"$surv_log" 2>&1 || true

  killed="$(count "$res_log" killed)"
  survived="$(count "$res_log" survived)"
  timedout="$(count "$res_log" timeout)"

  # surviving mutant ids (mutmut 3 prints them as file.py:line)
  survivors="$(grep -oE '([A-Za-z0-9_./-]+\.py):[0-9]+' "$surv_log" 2>/dev/null | sort -u | head -n10 || true)"
  if [ -z "$survivors" ]; then
    survivors="$(grep -i 'surviv' "$res_log" 2>/dev/null | grep -oE '([A-Za-z0-9_./-]+\.py):[0-9]+' | sort -u | head -n10 || true)"
  fi

  {
    printf '\n=== %s ===\n' "$module"
    printf 'tests: %s\n' "$test"
    printf 'killed=%s survived=%s timeout=%s\n' "$killed" "$survived" "$timedout"
    printf 'surviving mutants (first 10):\n'
    if [ -n "$survivors" ]; then
      printf '%s\n' "$survivors" | sed 's/^/  /'
    else
      printf '  (none)\n'
    fi
  } >> "$SUMMARY"

  log "  killed=$killed survived=$survived timeout=$timedout"
  notify_lines="${notify_lines}${module}: killed=$killed survived=$survived timeout=$timedout"$'\n'
done

# ---- 3-line summary + optional notification ----
summary3="$(printf '%s' "$notify_lines" | sed '/^$/d' | head -n3)"
{
  printf '\n--- 3-line summary ---\n'
  printf '%s\n' "$summary3"
} >> "$SUMMARY"

if [ -f "$NOTIFY" ]; then
  log "sending summary via $NOTIFY"
  python3 "$NOTIFY" "$summary3" >/dev/null 2>&1 \
    || log "notify failed (ignored; summary is still in $SUMMARY)"
else
  log "no notifier at $NOTIFY; summary only in $SUMMARY"
fi

log "done; summary in $SUMMARY"
