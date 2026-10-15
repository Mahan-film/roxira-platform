#!/usr/bin/env bash
# Server-side, fully-automatic deploy for the production host (owner decision 2026-10-14:
# "everything fully automatic, I must not type commands"). Runs as root from the
# roxira-autodeploy.timer systemd timer.
#
# It deploys every new origin/main commit with the SAME safety as the owner-run flow: it
# copies scripts/ops/deploy_local.sh from the target commit and runs it with
# DEPLOY_SSH_HOST=local (so ssh is replaced by local bash) -- freeze file, clean tree,
# pg_dump backup before migrations, smoke tests and automatic rollback all live in that
# script. A SHA whose deploy or migration failed is remembered and never retried; a newer
# commit starts a fresh attempt.
#
# Opt-in: the timer does nothing unless /etc/roxira/autodeploy.enabled exists (created by
# scripts/ops/autodeploy/install.sh). Pause everything with
# `touch /opt/roxira_platform/.deploy-freeze`.
#
# Never prints secret values. See docs/ops/AUTODEPLOY.md.
set -euo pipefail

REPO="${AUTODEPLOY_REPO:-/opt/roxira_platform}"
ENABLED_FILE="${AUTODEPLOY_ENABLED_FILE:-/etc/roxira/autodeploy.enabled}"
FREEZE_FILE="$REPO/.deploy-freeze"
STATE_DIR="${AUTODEPLOY_STATE_DIR:-/root/deploy-state}"
FAILED_SHAS="$STATE_DIR/autodeploy-failed-shas"
LAST_JSON="$STATE_DIR/autodeploy-last.json"
LOG_DIR="${AUTODEPLOY_LOG_DIR:-/var/log/roxira-autodeploy}"
LOCK_FILE="${AUTODEPLOY_LOCK:-/run/roxira-autodeploy.lock}"
KEEP_LOGS=50
MIG_DIR="output_apps/enterprise_hub/migrations"
DEPLOY_REL="scripts/ops/deploy_local.sh"

STARTED="$(date '+%Y-%m-%dT%H:%M:%S%z')"
TARGET=""
DEPLOYED_BEFORE=""
TARGET_SHORT=""
MIGRATED=false
RESULT="skipped"
LOG_FILE=""
DEPLOY_TMP=""

log() { printf '[%s] autodeploy: %s\n' "$(date '+%H:%M:%S')" "$*"; }

record_failure() {
  mkdir -p "$STATE_DIR"
  grep -qxF "$TARGET" "$FAILED_SHAS" 2>/dev/null || printf '%s\n' "$TARGET" >>"$FAILED_SHAS"
}

# Always runs: writes the status JSON and keeps only the newest KEEP_LOGS log files.
write_status() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$RESULT" != "failed" ]; then RESULT="failed"; fi
  if [ -n "$LOG_FILE" ]; then
    mkdir -p "$STATE_DIR" 2>/dev/null || true
    printf '{"time":"%s","target":"%s","deployed_before":"%s","migrated":%s,"result":"%s","log":"%s"}\n' \
      "$STARTED" "$TARGET" "$DEPLOYED_BEFORE" "$MIGRATED" "$RESULT" "$LOG_FILE" \
      >"$LAST_JSON" 2>/dev/null || true
    ls -1t "$LOG_DIR"/*.log 2>/dev/null | tail -n +$((KEEP_LOGS + 1)) | xargs -r rm -f 2>/dev/null || true
    # Best effort: notify the owner for a real outcome, never for a no-op/skip.
    if [ "$RESULT" = "ok" ] || [ "$RESULT" = "failed" ]; then
      python3 "$REPO/scripts/ops/notify/notify.py" "استقرار ${TARGET_SHORT:0:7}: $RESULT" >/dev/null 2>&1 || true
    fi
  fi
  [ -z "$DEPLOY_TMP" ] || rm -f "$DEPLOY_TMP"
  [ -z "${LOCK_DIR:-}" ] || rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap write_status EXIT

mkdir -p "$LOG_DIR" "$STATE_DIR"
LOG_FILE="$LOG_DIR/$(date '+%Y%m%d-%H%M%S').log"
exec > >(tee -a "$LOG_FILE") 2>&1

# Never overlap runs (the timer may fire again while a deploy is still running).
# flock on Linux (the server); a mkdir lock where flock is missing (macOS, local CI).
LOCK_DIR=""
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "another run holds $LOCK_FILE; skipping"
    exit 0
  fi
elif mkdir "$LOCK_FILE.d" 2>/dev/null; then
  LOCK_DIR="$LOCK_FILE.d"
else
  log "another run holds $LOCK_FILE.d; skipping"
  exit 0
fi

if [ ! -e "$ENABLED_FILE" ]; then
  log "disabled: $ENABLED_FILE is missing; nothing to do"
  exit 0
fi
if [ -e "$FREEZE_FILE" ]; then
  log "frozen: $FREEZE_FILE is present; nothing to do"
  exit 0
fi

# deploy_local.sh's local_root is resolved from the cwd, so run from the repo.
cd "$REPO"

git -C "$REPO" fetch -q origin main || { log "git fetch origin main failed"; RESULT="failed"; exit 1; }
TARGET="$(git -C "$REPO" rev-parse origin/main)"
TARGET_SHORT="$(git -C "$REPO" rev-parse --short=8 origin/main)"
DEPLOYED_BEFORE="$(git -C "$REPO" rev-parse HEAD)"

if [ "$TARGET" = "$DEPLOYED_BEFORE" ]; then
  log "already at $TARGET_SHORT; nothing to do"
  exit 0
fi

if [ -f "$FAILED_SHAS" ] && grep -qxF "$TARGET" "$FAILED_SHAS"; then
  log "target $TARGET_SHORT is recorded as failed; not retrying until a newer commit"
  exit 0
fi

# Copy the deploy script FROM THE TARGET commit, exactly like the owner flow
# (`git show ... > /tmp/deploy_local.sh`), so the safety rails match the code being shipped.
DEPLOY_TMP="$(mktemp "${TMPDIR:-/tmp}/roxira-autodeploy-deploy.XXXXXX.sh")"
git -C "$REPO" show "$TARGET:$DEPLOY_REL" >"$DEPLOY_TMP" || { log "cannot read $DEPLOY_REL from $TARGET_SHORT"; RESULT="failed"; exit 1; }
[ -s "$DEPLOY_TMP" ] || { log "deploy script from $TARGET_SHORT is empty"; RESULT="failed"; exit 1; }

if git -C "$REPO" diff --name-only "$DEPLOYED_BEFORE" "$TARGET" | grep -q "^$MIG_DIR/"; then
  log "migration files changed in the diff; running migrate (pg_dump backup first) before deploy"
  MIGRATED=true
  if ! DEPLOY_SSH_HOST=local DEPLOY_AUTO_CONFIRM="$TARGET_SHORT" bash "$DEPLOY_TMP" migrate --yes; then
    log "migrate failed for $TARGET_SHORT; recording as failed and NOT deploying"
    record_failure
    RESULT="failed"
    exit 1
  fi
fi

log "deploying $TARGET_SHORT (deployed was ${DEPLOYED_BEFORE:0:8})"
if ! DEPLOY_SSH_HOST=local DEPLOY_AUTO_CONFIRM="$TARGET_SHORT" bash "$DEPLOY_TMP" deploy --yes; then
  log "deploy failed for $TARGET_SHORT; recording as failed"
  record_failure
  RESULT="failed"
  exit 1
fi

RESULT="ok"
log "deploy OK: $TARGET_SHORT"
