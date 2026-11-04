#!/usr/bin/env bash
# dispatch_opencode.sh - run ONE scoped task through OpenCode headless, in a
# given git worktree, with a chosen cheap model, then print the resulting diff.
#
# The hub (or owner) reviews the diff and decides; this script NEVER commits,
# pushes, or touches anything outside the worktree (OpenCode's `build` agent in
# the repo's opencode.json denies git push, curl, ssh, rm -rf, .env reads).
#
# Usage:
#   scripts/dev/dispatch_opencode.sh -w <worktree> -p "<task prompt>" [options]
#   scripts/dev/dispatch_opencode.sh -w <worktree> -F task.md [options]
#
# Options:
#   -w DIR     git worktree to run in (required; must NOT be the main branch checkout)
#   -p TEXT    task prompt (or -F FILE to read it from a file)
#   -m MODEL   provider/model (default: openrouter/<config/models.yaml executor primary>)
#   -R ROLE    take the model from a config/models.yaml role instead (executor, mechanical,
#              cheap, free), via scripts/dev/model_for.py; a free role implies --public rules
#              others: pool/dsflash, pool/codestral (LiteLLM key pool, may route to free tiers: needs --public),
#                      omniroute/<id> (local gateway)
#   -a AGENT   opencode agent (default: build; repo opencode.json defines
#              plan/free/critical-reviewer/build)
#   -t SECS    timeout (default 600)
#   -o DIR     where to save the task log and diff (default: $TMPDIR/dispatch_opencode)
#   --public   REQUIRED when the model id contains ":free" (free providers may log
#              or train on prompts; only public-repo, non-customer content allowed)
#   --dry-run  print the command that would run and exit
#
# Exit codes: 0 diff produced, 1 agent ran but made no change, 2 usage/safety
#             error, 3 opencode failed/timed out.
# Secrets: read from ~/Secrets/roxira/roxira.env into the environment only;
#          never printed.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODEL=""; ROLE="executor"; AGENT="build"; TMO=600
WT=""; PROMPT=""; PFILE=""; OUT="${TMPDIR:-/tmp}/dispatch_opencode"; PUBLIC=0; DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    -w) WT="$2"; shift 2;; -p) PROMPT="$2"; shift 2;; -F) PFILE="$2"; shift 2;;
    -m) MODEL="$2"; shift 2;; -R) ROLE="$2"; shift 2;; -a) AGENT="$2"; shift 2;; -t) TMO="$2"; shift 2;;
    -o) OUT="$2"; shift 2;; --public) PUBLIC=1; shift;; --dry-run) DRY=1; shift;;
    -h|--help) sed -n '2,34p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

if [ -z "$MODEL" ]; then
  MODEL="$(python3 "$HERE/model_for.py" "$ROLE" --prefix openrouter)" || { echo "cannot resolve model for role '$ROLE' from config/models.yaml" >&2; exit 2; }
fi
[ -n "$WT" ] || { echo "-w <worktree> is required" >&2; exit 2; }
[ -n "$PFILE" ] && PROMPT="$(cat "$PFILE")"
[ -n "$PROMPT" ] || { echo "-p <prompt> or -F <file> is required" >&2; exit 2; }
WT="$(cd "$WT" 2>/dev/null && pwd)" || { echo "worktree not found" >&2; exit 2; }
git -C "$WT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "$WT is not a git worktree" >&2; exit 2; }

# Safety: refuse to run in a checkout whose branch is main/master.
BR="$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
case "$BR" in main|master|HEAD) echo "refusing to run on branch '$BR': create a worktree branch first (git worktree add --no-track -b tmp/x .wt/x origin/main)" >&2; exit 2;; esac

case "$MODEL" in *:free*|*openrouter/free*|pool/*) [ "$PUBLIC" = 1 ] || { echo "model '$MODEL' is a :free tier (may log/train on prompts). Re-run with --public ONLY if the task touches public-repo content, never customer/case data." >&2; exit 2; };; esac

command -v opencode >/dev/null || { echo "opencode not installed" >&2; exit 2; }

ENV_FILE="${ROXIRA_ENV_FILE:-$HOME/Secrets/roxira/roxira.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
case "$MODEL" in
  openrouter/*) [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "OPENROUTER_API_KEY not set" >&2; exit 2; };;
  mistral/*)    [ -n "${MISTRAL_API_KEY:-}" ] || { echo "MISTRAL_API_KEY not set" >&2; exit 2; };;
  omniroute/*)  export OMNIROUTE_OPENCODE_KEY="${OMNIROUTE_OPENCODE_KEY:-${OMNIROUTE_API_KEY:-}}"  # alias used by the global opencode config
                [ -n "${OMNIROUTE_API_KEY:-}" ] || { echo "OMNIROUTE_API_KEY not set" >&2; exit 2; }
                export OMNIROUTE_BASE_URL="${OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}";;
esac

# Preflight: OpenRouter answers 403 "Access denied by security policy" to blocked egress IPs (the Mac without
# its VPN). Fail fast with the fix instead of letting opencode print a bare "Forbidden" (issue #288).
case "$MODEL" in openrouter/*)
  _code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' https://openrouter.ai/api/v1/models 2>/dev/null || true)"
  if [ "$_code" = "403" ] && [ "$DRY" != 1 ]; then
    echo "OpenRouter returns 403 for this machine's IP (blocked egress; turn the VPN on). For a review use: python3 scripts/dev/llm_route.py --diff <file> (falls back to the srv1 key pool and free non-Claude models)." >&2
    exit 3
  fi;;
esac

mkdir -p "$OUT"; STAMP="$(date +%Y%m%d-%H%M%S)"; TAG="$(basename "$WT")-$STAMP"
LOG="$OUT/$TAG.log"; DIFF="$OUT/$TAG.diff"
BASE_SHA="$(git -C "$WT" rev-parse HEAD)"

CMD=(opencode run --dir "$WT" --agent "$AGENT" --model "$MODEL" --format default "$PROMPT")
if [ "$DRY" = 1 ]; then printf 'cd %q && ' "$WT"; printf '%q ' "${CMD[@]}"; echo; exit 0; fi

# macOS has no `timeout`; use gtimeout if present, else perl alarm.
run_with_timeout() {
  if command -v timeout >/dev/null; then timeout "$TMO" "$@"
  elif command -v gtimeout >/dev/null; then gtimeout "$TMO" "$@"
  else perl -e 'alarm shift; exec @ARGV' "$TMO" "$@"; fi
}

echo "[dispatch] worktree=$WT branch=$BR base=${BASE_SHA:0:8} model=$MODEL agent=$AGENT timeout=${TMO}s" >&2
( cd "$WT" && run_with_timeout "${CMD[@]}" ) >"$LOG" 2>&1
RC=$?
echo "[dispatch] opencode exit=$RC log=$LOG" >&2

# Make new (untracked) files show up in the diff without staging content.
git -C "$WT" add -N . >/dev/null 2>&1 || true
git -C "$WT" diff --no-color "$BASE_SHA" >"$DIFF"
STAT="$(git -C "$WT" diff --stat "$BASE_SHA" | tail -1)"
# Drop the intent-to-add entries again so the worktree index is left as we found it.
git -C "$WT" reset -q >/dev/null 2>&1 || true

if [ "$RC" -ne 0 ] && [ ! -s "$DIFF" ]; then echo "[dispatch] FAILED (rc=$RC), no diff. See $LOG" >&2; tail -n 15 "$LOG" >&2; exit 3; fi
if [ ! -s "$DIFF" ]; then echo "[dispatch] agent made no changes. See $LOG" >&2; exit 1; fi

echo "[dispatch] diff saved: $DIFF  (${STAT:-no stat})" >&2
echo "[dispatch] NOT committed. Review, then: git -C '$WT' add -A && git -C '$WT' commit, or git -C '$WT' checkout -- . to discard." >&2
cat "$DIFF"
[ "$RC" -ne 0 ] && exit 3
exit 0
