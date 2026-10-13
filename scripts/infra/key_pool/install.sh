#!/usr/bin/env bash
# Install the LiteLLM key-pool gateway on the SERVER (127.0.0.1:4000). Dry-run by default.
#   install.sh            show what would happen (renders config to a temp file, checks port, lists key NAMES)
#   install.sh --apply    write generated/, pull the pinned image, docker compose up -d
# Run on the server from the repo checkout. Reads $KEYPOOL_SRC_ENV (default /opt/roxira_platform/.env)
# by parsing it; only the key NAMES in config/key_pool.yaml are copied, values are never printed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SRC_ENV="${KEYPOOL_SRC_ENV:-/opt/roxira_platform/.env}"
GEN="$HERE/generated"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
log() { printf '[keypool] %s\n' "$*"; }
die() { printf '[keypool] ERROR: %s\n' "$*" >&2; exit 1; }

cd "$HERE"
[ -r "$SRC_ENV" ] || die "cannot read $SRC_ENV (set KEYPOOL_SRC_ENV)"
PORT="$(python3 -c 'import keypool_config as k; print(k.load_pool()["gateway"]["port"])')"
IMAGE="$(python3 -c 'import keypool_config as k; print(k.load_pool()["gateway"]["image"])')"
MASTER="$(python3 -c 'import keypool_config as k; print(k.load_pool()["gateway"]["master_key_env"])')"

# Port guard (AGENTS.md section 7): refuse when 4000 is busy, unless it is our own container.
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx roxira_keypool; then log "port $PORT is held by our own roxira_keypool: upgrade in place"
  else die "port $PORT is busy (ss -tlnp | grep $PORT); not touching it"; fi
fi

# Which key names are actually set (names only).
SET_NAMES="$(python3 - "$SRC_ENV" <<'PY'
import sys, keypool_config as k
pool = k.load_pool()
got = k.parse_env_names(sys.argv[1], k.all_key_names(pool))
print(" ".join(sorted(got)))
PY
)"
log "key names set in $SRC_ENV: ${SET_NAMES:-<none>}"
case " $SET_NAMES " in *" $MASTER "*) ;; *) die "$MASTER missing: bash scripts/ops/set_server_env.sh $MASTER --generate" ;; esac

TMPCFG="$(mktemp)"; trap 'rm -f "$TMPCFG"' EXIT
python3 render_litellm.py --env-file "$SRC_ENV" --out "$TMPCFG"
log "image: $IMAGE (bind 127.0.0.1:$PORT)"
if [ "$APPLY" != 1 ]; then log "dry-run only. Re-run with --apply to install."; exit 0; fi

umask 077
mkdir -p "$GEN"
cp "$TMPCFG" "$GEN/litellm.config.yaml"
python3 - "$SRC_ENV" "$GEN/keypool.env" <<'PY'
import sys, keypool_config as k
pool = k.load_pool()
got = k.parse_env_names(sys.argv[1], k.all_key_names(pool))
with open(sys.argv[2], "w") as fh:
    for n, v in got.items():
        fh.write(f"{n}={v}\n")
PY
chmod 600 "$GEN/keypool.env"
export KEYPOOL_IMAGE="$IMAGE"
docker pull "$IMAGE" >/dev/null || die "docker pull $IMAGE failed: fix gateway.image in config/key_pool.yaml"
docker compose -f "$HERE/docker-compose.keypool.yml" -p roxira-keypool up -d
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx roxira_keypool; then
  docker restart roxira_keypool >/dev/null
  log "restarted roxira_keypool to load the new config"
fi
log "up. Check: bash $HERE/health.sh"
