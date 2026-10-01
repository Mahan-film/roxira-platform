#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '%s\n' "$*"
}

dry_run=0

if [[ $# -gt 1 ]]; then
  log "usage: $0 [--dry-run]"
  exit 2
fi

if [[ ${1:-} == "--dry-run" ]]; then
  dry_run=1
elif [[ $# -eq 1 ]]; then
  log "usage: $0 [--dry-run]"
  exit 2
fi

project_dir=${PROJECT_DIR:-/opt/roxira_platform}
cd "$project_dir"

if [[ -e .deploy-freeze ]]; then
  exit 0
fi

git fetch -q origin main
sha=$(git rev-parse origin/main)
head_sha=$(git rev-parse HEAD)

if [[ $sha == "$head_sha" ]]; then
  log "pull deploy: origin/main is already deployed ($sha)"
  exit 0
fi

min_age=${PULL_DEPLOY_MIN_AGE_S:-1200}
commit_timestamp=$(git show -s --format=%ct "$sha")
now=$(date +%s)
commit_age=$((now - commit_timestamp))

if (( commit_age < min_age )); then
  log "pull deploy: $sha is ${commit_age}s old; waiting for minimum age of ${min_age}s"
  exit 0
fi

if [[ ${PULL_DEPLOY_REQUIRE_GREEN:-0} == "1" ]]; then
  checks_url="https://api.github.com/repos/Mahan-film/roxira-platform/commits/$sha/check-runs?per_page=100"
  curl_args=(--fail --silent --max-time 10 -H 'Accept: application/vnd.github+json')
  if [[ -n ${GITHUB_TOKEN:-} ]]; then
    curl_args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi

  if ! checks_json=$(curl "${curl_args[@]}" "$checks_url"); then
    log "pull deploy: could not retrieve GitHub check runs for $sha; retrying next tick"
    exit 0
  fi

  if ! printf '%s' "$checks_json" | python3 -c '
import json
import sys

try:
    runs = json.load(sys.stdin)["check_runs"]
except (json.JSONDecodeError, KeyError, TypeError):
    sys.exit(1)

allowed = {"success", "skipped", "neutral"}
sys.exit(0 if runs and all(run.get("conclusion") in allowed for run in runs) else 1)
' 2>/dev/null; then
    log "pull deploy: checks for $sha are missing, incomplete, or unsuccessful; retrying next tick"
    exit 0
  fi
fi

if (( dry_run )); then
  log "pull deploy: dry-run would deploy $sha"
  exit 0
fi

log "pull deploy: deploying $sha"
SSH_ORIGINAL_COMMAND="deploy $sha" exec scripts/ops/ci-deploy.sh
