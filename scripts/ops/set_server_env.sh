#!/usr/bin/env bash
# Owner-run: put ONE variable into the PRODUCTION server .env without ever printing its value.
#
# Usage:
#   scripts/ops/set_server_env.sh NAME              # asks for the value (hidden input)
#   scripts/ops/set_server_env.sh NAME --from-local # copies the value of NAME from ~/Secrets/roxira/roxira.env
#   scripts/ops/set_server_env.sh NAME --generate   # makes a random 64-hex value, saves it ALSO in
#                                                   # ~/Secrets/roxira/roxira.env (only after the server write
#                                                   # is verified; atomic, previous file kept as .bak-STAMP)
#   add --replace to overwrite an existing non-empty value (a timestamped backup of .env is always made)
#
# The value travels over ssh stdin only (never on a command line), the server file keeps its
# permissions, and only variable NAMES and value LENGTHS are printed. L4: owner-only.
set -euo pipefail

SSH_HOST="${DEPLOY_SSH_HOST:-5.75.200.67}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/roxira_platform}"
ENV_FILE="$REMOTE_DIR/.env"
LOCAL_ENV="${ROXIRA_LOCAL_ENV:-$HOME/Secrets/roxira/roxira.env}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
usage() { sed -n '2,12p' "$0" >&2; exit 2; }

NAME="${1:-}"
[ -n "$NAME" ] || usage
shift || true
[[ "$NAME" =~ ^[A-Z][A-Z0-9_]{1,63}$ ]] || die "NAME must look like MY_VAR_NAME (capitals, digits, underscore)"

MODE="ask"; REPLACE=0
for a in "$@"; do
  case "$a" in
    --from-local) MODE="local" ;;
    --generate) MODE="generate" ;;
    --replace) REPLACE=1 ;;
    *) usage ;;
  esac
done

rsh() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@"; }

value=""
case "$MODE" in
  ask)
    printf '%s (hidden, Enter to finish): ' "$NAME" >&2
    IFS= read -rs value; printf '\n' >&2 ;;
  local)
    [ -r "$LOCAL_ENV" ] || die "cannot read $LOCAL_ENV"
    value="$(python3 - "$LOCAL_ENV" "$NAME" <<'PY'
import sys
path, name = sys.argv[1], sys.argv[2]
for line in open(path, encoding="utf-8"):
    if line.startswith(name + "="):
        print(line.rstrip("\n").split("=", 1)[1], end="")
        break
PY
)" ;;
  generate)
    # The local file is NOT touched here: it is updated only after the server write is verified.
    value="$(openssl rand -hex 32)"
    log "generated a new random $NAME (value not shown; local file updated only after the server write succeeds)" ;;
esac

# Atomic local update (generate mode only, called after the server write was verified).
# Keeps one timestamped backup of the previous local file (chmod 600); the value is passed via env.
save_local() {
  mkdir -p "$(dirname "$LOCAL_ENV")"
  ROXIRA_NEW_VALUE="$value" python3 - "$LOCAL_ENV" "$NAME" "$1" <<'PY'
import os, pathlib, re, shutil, sys, tempfile
path, name, stamp = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
val = os.environ["ROXIRA_NEW_VALUE"]
text = path.read_text(encoding="utf-8") if path.exists() else ""
line = f"{name}={val}"
if re.search(rf"(?m)^{re.escape(name)}=", text):
    text = re.sub(rf"(?m)^{re.escape(name)}=.*$", lambda m: line, text)
else:
    text = text.rstrip("\n") + ("\n" if text else "") + line + "\n"
if path.exists():
    bak = path.with_name(path.name + ".bak-" + stamp)
    shutil.copy2(path, bak)
    os.chmod(bak, 0o600)
fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".tmp.")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
except BaseException:
    if os.path.exists(tmp):
        os.unlink(tmp)
    raise
PY
}

[ -n "$value" ] || die "empty value: nothing written"
case "$value" in *$'\n'*|*$'\r'*) die "value must be a single line" ;; esac
log "value length: ${#value}"

# What does the server already have? (names/length only)
existing_len="$(rsh "grep -E '^${NAME}=' '$ENV_FILE' | head -n1 | cut -d= -f2- | awk '{print length(\$0)}'" || true)"
existing_len="${existing_len:-}"
if [ -n "$existing_len" ] && [ "$existing_len" != "0" ] && [ "$REPLACE" != "1" ]; then
  die "$NAME already has a value on the server (length $existing_len). Use --replace to overwrite."
fi

stamp="$(date +%Y%m%d%H%M%S)"
rsh "cp -p '$ENV_FILE' '$ENV_FILE.bak-$stamp'" || die "could not back up the server .env"
log "backed up the server .env to .env.bak-$stamp"

# Remove an old/empty line for this name, keep inode+permissions (cat >), then append the new line.
rsh "grep -v '^${NAME}=' '$ENV_FILE' > '$ENV_FILE.new' && cat '$ENV_FILE.new' > '$ENV_FILE' && rm -f '$ENV_FILE.new'" \
  || die "could not rewrite the server .env (backup kept)"
printf '%s=%s\n' "$NAME" "$value" | rsh "cat >> '$ENV_FILE'" || die "could not append (restore from the backup)"

new_len="$(rsh "grep -E '^${NAME}=' '$ENV_FILE' | head -n1 | cut -d= -f2- | awk '{print length(\$0)}'" || true)"
log "server .env now has $NAME with value length ${new_len:-?}"
if [ "$MODE" = "generate" ]; then
  [ "${new_len:-}" = "${#value}" ] || die "server value length (${new_len:-?}) does not match the generated one (${#value}); local file NOT changed"
  save_local "$stamp" || die "server updated but could not save the local copy; local file unchanged"
  chmod 600 "$LOCAL_ENV" 2>/dev/null || true
  log "saved the new $NAME in $LOCAL_ENV (previous local file kept as .bak-$stamp; value not shown)"
fi
unset value
log "done. Containers read .env only at (re)start: the new value takes effect at the next deploy/restart."
