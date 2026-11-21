#!/usr/bin/env bash
# Mac hub: list REPORT comments on the bridge issue (#965 by default).
#   bash scripts/dev/hub_reports.sh [since]
# `since` is a wave id (YYYYMMDD-HHMM-lane: only reports whose id sorts after it) or a numeric
# comment id (only comments with a higher id). No argument lists all REPORT comments.
set -euo pipefail

REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
ISSUE="${ROXIRA_BRIDGE_ISSUE:-965}"
since="${1:-}"

if [ -z "$since" ]; then
  filter='true'
elif printf '%s' "$since" | grep -Eq '^[0-9]+$'; then
  filter=".id > $since"
elif printf '%s' "$since" | grep -Eq '^[A-Za-z0-9._-]+$'; then
  filter="((.body | split(\"\\n\")[0] | ltrimstr(\"REPORT: \")) > \"$since\")"
else
  echo "bad since value" >&2; exit 2
fi

gh api --paginate "repos/$REPO/issues/$ISSUE/comments?per_page=100" --jq \
  ".[] | select(.body | startswith(\"REPORT:\")) | select($filter) | \"--- comment \\(.id) by \\(.user.login) at \\(.created_at)\\n\\(.body)\\n\""
