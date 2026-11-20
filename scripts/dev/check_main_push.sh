#!/usr/bin/env bash
# Alert on any direct push to main that did not come from a merged PR.
# Designed to run every 10 minutes on the CI box (systemd timer) so a private Free
# repo (no branch protection) still detects direct pushes to main immediately.
#
# Usage:
#   scripts/dev/check_main_push.sh [--repo owner/name] [--state-file path] [--dry-run]
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-Mahan-film/roxira-platform}"
STATE_FILE="${CHECK_MAIN_PUSH_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/roxira/last_checked_main_sha}"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?--repo needs owner/name}"; shift 2 ;;
    --state-file) STATE_FILE="${2:?--state-file needs a path}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

send_telegram() {
  local text="$1"
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    return 0
  fi
  curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${text}" >/dev/null || echo "[check-main-push] warning: Telegram send failed" >&2
}

HEAD_SHA="$(gh api "repos/${REPO}/commits/main" --jq '.sha')"
if [ -z "$HEAD_SHA" ]; then
  echo "[check-main-push] FAIL: could not read main HEAD for ${REPO}" >&2
  exit 1
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "[check-main-push] initialising state at ${HEAD_SHA:0:8}"
  if [ "$DRY_RUN" = "0" ]; then
    mkdir -p "$(dirname "$STATE_FILE")"
    printf '%s\n' "$HEAD_SHA" > "$STATE_FILE"
  fi
  exit 0
fi

LAST_SHA="$(tr -d '[:space:]' < "$STATE_FILE")"
if [ "$LAST_SHA" = "$HEAD_SHA" ]; then
  echo "[check-main-push] main unchanged at ${HEAD_SHA:0:8}"
  exit 0
fi

COMMITS="$(gh api "repos/${REPO}/compare/${LAST_SHA}...${HEAD_SHA}" --jq '.commits[].sha')"
DIRECT_PUSHES=()
for sha in $COMMITS; do
  pr_count="$(gh api "repos/${REPO}/commits/${sha}/pulls" --jq '[.[] | select(.merged_at != null)] | length')"
  if [ "${pr_count:-0}" = "0" ]; then
    DIRECT_PUSHES+=("$sha")
  fi
done

if [ "$DRY_RUN" = "0" ]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  printf '%s\n' "$HEAD_SHA" > "$STATE_FILE"
fi

if [ "${#DIRECT_PUSHES[@]}" -gt 0 ]; then
  alert="[ALERT] Direct push to ${REPO}:main without a merged PR: ${DIRECT_PUSHES[*]}"
  echo "$alert" >&2
  if [ "$DRY_RUN" = "0" ]; then
    send_telegram "$alert"
  fi
  exit 1
fi

echo "[check-main-push] OK: all commits ${LAST_SHA:0:8}..${HEAD_SHA:0:8} came from merged PRs"
