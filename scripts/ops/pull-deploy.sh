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

if [[ -n ${PULL_DEPLOY_SSH_KEY:-} ]]; then
  export GIT_SSH_COMMAND="ssh -i \"${PULL_DEPLOY_SSH_KEY}\" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

if [[ ${PULL_DEPLOY_SIGNED_TAG_GUARD:-0} == "1" ]]; then
  git fetch -q --tags --force origin main
else
  git fetch -q origin main
fi
sha=$(git rev-parse origin/main)
head_sha=$(git rev-parse HEAD)

if [[ ${PULL_DEPLOY_SIGNED_TAG_GUARD:-0} == "1" ]]; then
  needs_signed_tag=0
  if [[ ${PULL_DEPLOY_REQUIRE_SIGNED_TAG:-0} == "1" ]]; then
    needs_signed_tag=1
  elif git diff --name-only "$head_sha" "$sha" | grep -qE '^(output_apps/enterprise_hub/migrations/|docker-compose.*\.ya?ml$|scripts/ops/|\.github/workflows/)'; then
    needs_signed_tag=1
  fi

  if (( needs_signed_tag )); then
    guard_script="${SIGNED_TAG_GUARD_SCRIPT:-$(dirname "$0")/signed_tag_guard.sh}"
    if ! tag_out=$("$guard_script"); then
      log "pull deploy: signed-tag guard failed (no valid SSH-signed deploy/* tag); refusing deploy"
      exit 1
    fi
    signed_tag="${tag_out%% *}"
    sha="${tag_out#* }"
    log "pull deploy: signed-tag guard selected $signed_tag ($sha)"
  fi
fi

if [[ $sha == "$head_sha" ]]; then
  log "pull deploy: target is already deployed ($sha)"
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
