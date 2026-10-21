#!/usr/bin/env bash
# Hourly code mirror: GitHub (source of truth) -> Codeberg (private off-site copy).
# See docs/ops/OFFSITE_BACKUP.md.
#
# Runs ON the production host as root from roxira-codeberg-mirror.timer.
#   1. keep a bare clone in /var/lib/roxira-mirror/roxira-platform.git, fetched from the SAME
#      remote URL (and credentials/deploy key) as the deployed checkout's `origin`
#   2. fetch only refs/heads/* and refs/tags/* (GitHub-only refs/pull/* are never fetched)
#   3. push those refs to https://codeberg.org/<CODEBERG_USER>/roxira-platform.git with --prune
#      (mirror semantics: deleted branches/tags disappear there too)
# The token comes from $CODEBERG_TOKEN and reaches git via GIT_ASKPASS (codeberg_askpass.sh);
# it is never in argv, a URL, a git config, or the log (output is redacted).
#
# Usage: codeberg_mirror.sh [--dry-run]
# Env: CODEBERG_TOKEN (required), CODEBERG_USER (mahanofficial), CODEBERG_REPO (roxira-platform),
#      MIRROR_DIR (/var/lib/roxira-mirror), MIRROR_SOURCE_URL (default: origin of /opt/roxira_platform)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=offsite_lib.sh
. "$SCRIPT_DIR/offsite_lib.sh"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

load_names CODEBERG_TOKEN CODEBERG_USER CODEBERG_REPO
CB_USER="${CODEBERG_USER:-mahanofficial}"
CB_REPO="${CODEBERG_REPO:-roxira-platform}"
MIRROR_ROOT="${MIRROR_DIR:-/var/lib/roxira-mirror}"
BARE="$MIRROR_ROOT/roxira-platform.git"
DEST_URL="https://codeberg.org/$CB_USER/$CB_REPO.git"
export REDACT_ENV_NAMES="CODEBERG_TOKEN"

# Refspecs: branches and tags only. refs/pull/* (GitHub-only) and anything else are excluded.
FETCH_SPECS=('+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*')
PUSH_SPECS=('+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*')

build_push_args() { # prints the git push argv, one per line (token is not part of it)
  printf '%s\n' git -C "$BARE" push --prune --no-progress "$DEST_URL" "${PUSH_SPECS[@]}"
}

source_url() {
  if [ -n "${MIRROR_SOURCE_URL:-}" ]; then printf '%s' "$MIRROR_SOURCE_URL"; return; fi
  git -C "$REPO_DIR" remote get-url origin 2>/dev/null
}

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] source  : \$(git -C $REPO_DIR remote get-url origin)   (fetch via the server's existing GitHub access)"
  echo "[dry-run] mirror  : $BARE  (fetch specs: ${FETCH_SPECS[*]})"
  echo "[dry-run] push    : $(build_push_args | tr '\n' ' ')"
  echo "[dry-run] auth    : GIT_ASKPASS=$SCRIPT_DIR/codeberg_askpass.sh (token from env CODEBERG_TOKEN, answers codeberg.org only)"
  exit 0
fi

fail() { # fail <message>: log, throttled owner notice (every 6h), exit 1
  log "ERROR: $*"
  mkdir -p "$OFFSITE_STATE_DIR"
  if due_since "$OFFSITE_STATE_DIR/mirror.last_fail_notice" $((6 * 3600)); then
    notify_owner "Codeberg mirror FAILED: $*. See: journalctl -u roxira-codeberg-mirror -n 60"
    : >"$OFFSITE_STATE_DIR/mirror.last_fail_notice"
  fi
  exit 1
}

[ -n "${CODEBERG_TOKEN:-}" ] || fail "CODEBERG_TOKEN is not set (scripts/ops/set_server_env.sh CODEBERG_TOKEN)"
command -v git >/dev/null 2>&1 || fail "git not found"
mkdir -p "$MIRROR_ROOT" "$OFFSITE_STATE_DIR" && chmod 700 "$MIRROR_ROOT" "$OFFSITE_STATE_DIR"
exec 9>"$OFFSITE_STATE_DIR/mirror.lock"
flock -n 9 || { log "another mirror run is in progress; skipping"; exit 0; }

SRC="$(source_url)" || true
[ -n "$SRC" ] || fail "cannot determine the GitHub URL (set MIRROR_SOURCE_URL or fix origin of $REPO_DIR)"

export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS="$SCRIPT_DIR/codeberg_askpass.sh"
export CODEBERG_USER="$CB_USER"
export GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=120

if [ ! -d "$BARE" ]; then
  log "creating bare mirror $BARE"
  git init --bare -q "$BARE" || fail "git init failed"
  git -C "$BARE" remote add origin "$SRC" || fail "remote add failed"
fi
git -C "$BARE" remote set-url origin "$SRC"
git -C "$BARE" config --unset-all remote.origin.fetch 2>/dev/null || true
for s in "${FETCH_SPECS[@]}"; do git -C "$BARE" config --add remote.origin.fetch "$s"; done
git -C "$BARE" config remote.origin.mirror false

log "fetching from GitHub (branches + tags)"
out="$(git -C "$BARE" fetch --prune --no-progress origin 2>&1)" || { fail "fetch from GitHub failed: $(printf '%s' "$out" | redact | tail -n 3 | tr '\n' ' ')"; }

log "pushing to Codeberg ($CB_USER/$CB_REPO)"
mapfile -t PUSH_ARGV < <(build_push_args)
out="$("${PUSH_ARGV[@]}" 2>&1)" || { fail "push to Codeberg failed: $(printf '%s' "$out" | redact | tail -n 3 | tr '\n' ' ')"; }
printf '%s\n' "$out" | redact | tail -n 5 >&2
log "mirror up to date"
: >"$OFFSITE_STATE_DIR/mirror.last_ok"
exit 0
