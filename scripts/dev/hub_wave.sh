#!/usr/bin/env bash
# Mac hub: post a WAVE comment on the bridge issue (#965 by default).
#   bash scripts/dev/hub_wave.sh wave.yaml        # YAML file
#   cat wave.yaml | bash scripts/dev/hub_wave.sh  # or stdin
#   add --dry-run to print the comment instead of posting it
# YAML fields: lane (required), task (required), acceptance (list), max_turns (default 30),
# mode (read|write, default read). Any `id:` line is replaced: the id is YYYYMMDD-HHMM-<lane>.
# Never put secrets, IPs or hostnames in a WAVE: the repo is public.
set -euo pipefail

REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
ISSUE="${ROXIRA_BRIDGE_ISSUE:-965}"

dry=0
file=""
for a in "$@"; do
  case "$a" in
    --dry-run) dry=1 ;;
    -*) echo "unknown flag $a" >&2; exit 2 ;;
    *) file="$a" ;;
  esac
done

yaml="$(if [ -n "$file" ]; then cat "$file"; else cat; fi)"
[ -n "$yaml" ] || { echo "empty WAVE yaml" >&2; exit 2; }

lane="$(printf '%s\n' "$yaml" | sed -n 's/^lane:[[:space:]]*//p' | head -1 | tr -d "\"' \r")"
printf '%s' "$lane" | grep -Eq '^[a-z0-9][a-z0-9-]{0,31}$' \
  || { echo "yaml needs a lane: matching [a-z0-9-]{1,32}" >&2; exit 2; }
printf '%s\n' "$yaml" | grep -Eq '^task:' || { echo "yaml needs a task:" >&2; exit 2; }
if printf '%s\n' "$yaml" | grep -Eq 'ghp_|ghs_|github_pat_|sk-ant-|sk-or-v1-|AIza|gsk_|BEGIN [A-Z ]*PRIVATE KEY'; then
  echo "refusing: yaml looks like it contains a secret" >&2; exit 2
fi

id="$(date +%Y%m%d-%H%M)-$lane"
rest="$(printf '%s\n' "$yaml" | grep -Ev '^id:')"
body="$(printf 'WAVE: %s\n```yaml\nid: %s\n%s\n```\n' "$id" "$id" "$rest")"

if [ "$dry" = 1 ]; then printf '%s\n' "$body"; exit 0; fi

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$body" > "$tmp"
url="$(gh api -X POST "repos/$REPO/issues/$ISSUE/comments" -F "body=@$tmp" -q .html_url)"
echo "posted WAVE $id"
echo "$url"
echo "poll for the answer: bash scripts/dev/hub_reports.sh $id"
