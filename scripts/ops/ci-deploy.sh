#!/usr/bin/env bash
# ci-deploy.sh — the ONLY command the GitHub Actions deploy key may run on prod.
#
# Install (owner, once): in /root/.ssh/authorized_keys put the CI public key with
#   command="/opt/roxira_platform/scripts/ops/ci-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... roxira-ci-deploy
# The client sends "deploy <40-hex-sha>" as the ssh command (SSH_ORIGINAL_COMMAND).
#
# What it does: validate the request, take a lock, honour the freeze file, fetch,
# refuse a sha that is not on origin/main, map the changed paths to compose
# services, and run scripts/ops/deploy.sh for them (auto-rollback is in deploy.sh).
#
# Freeze: `touch /opt/roxira_platform/.deploy-freeze` stops all automatic deploys
# (use it while a long job such as a Qdrant ingest runs inside roxira_app_prod).
#
# Test helper: `ci-deploy.sh --map-stdin` reads changed paths on stdin and prints
# the services that would be deployed (no git, no docker).
set -euo pipefail

PROJECT_DIR="/opt/roxira_platform"
FREEZE_FILE="${PROJECT_DIR}/.deploy-freeze"
LOCK_FILE="/var/lock/roxira-ci-deploy.lock"

map_paths() {
  # Reads one repo-relative path per line, prints unique service names.
  # Plain flags (no associative arrays) so it also runs on bash 3.2 (macOS).
  local path app=0 backend=0 frontend=0
  while IFS= read -r path || [ -n "$path" ]; do
    case "$path" in
      output_apps/enterprise_hub/frontend/*) frontend=1 ;;
      output_apps/enterprise_hub/backend/*)  backend=1 ;;
      output_apps/generated_modules/*|output_apps/ecosystem_core/*|Dockerfile.prod|pyproject.toml|config/*.yaml)
        app=1 ;;
    esac
  done
  if [ "$app" = 1 ]; then printf '%s\n' enterprise_app; fi
  if [ "$backend" = 1 ]; then printf '%s\n' roxira_enterprise_backend; fi
  if [ "$frontend" = 1 ]; then printf '%s\n' roxira_enterprise_frontend; fi
  return 0
}

if [ "${1:-}" = "--map-stdin" ]; then
  map_paths
  exit 0
fi

log() { printf '[%s] ci-deploy: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

request="${SSH_ORIGINAL_COMMAND:-}"
if ! [[ "$request" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  fail "refusing request (expected: deploy <40-hex-sha>)"
fi
sha="${BASH_REMATCH[1]}"

if [ -e "$FREEZE_FILE" ]; then
  log "deploy freeze file present; skipping ${sha:0:12}"
  exit 0
fi

exec 9>"$LOCK_FILE"
flock -n 9 || fail "another deploy is running"

cd "$PROJECT_DIR" || fail "cannot cd to ${PROJECT_DIR}"
git fetch origin main || fail "git fetch failed"
git cat-file -e "${sha}^{commit}" 2>/dev/null || fail "unknown commit ${sha}"
git merge-base --is-ancestor "$sha" origin/main || fail "${sha:0:12} is not on origin/main"

old_head="$(git rev-parse HEAD)"
if [ "$old_head" = "$sha" ]; then
  log "already at ${sha:0:12}; nothing to do"
  exit 0
fi
git merge-base --is-ancestor "$old_head" "$sha" || fail "prod HEAD ${old_head:0:12} is not an ancestor of ${sha:0:12}"

mapfile -t services < <(git diff --name-only "$old_head" "$sha" | map_paths)

if [ "${#services[@]}" -eq 0 ]; then
  log "no service-affecting changes between ${old_head:0:12} and ${sha:0:12}; fast-forwarding only"
  git merge --ff-only "$sha" || fail "fast-forward failed"
  exit 0
fi

log "deploying ${sha:0:12} (services: ${services[*]})"
for svc in "${services[@]}"; do
  "${PROJECT_DIR}/scripts/ops/deploy.sh" "$svc" || fail "deploy of ${svc} failed (deploy.sh rolled back)"
done
log "deploy OK: ${sha:0:12}"
