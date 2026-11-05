#!/usr/bin/env bash
# Run the shared LLM pool proxy for the trusted laptop. Meant to be started by launchd
# (ir.roxira.pool-share, see install.sh); runs in the FOREGROUND so launchd can restart it.
#   - LiteLLM (image already on this Mac) + a private Postgres container (virtual keys need a DB).
#   - Config is rendered from config/key_pool.yaml at every start; real provider keys stay on this Mac.
#   - Binds ONLY to the LAN interface address (never 0.0.0.0), default en0, port 4180.
# Env: ROXIRA_REPO (checkout to render from), POOL_SHARE_IFACE (en0), POOL_SHARE_BIND (override address,
#      e.g. a Tailscale 100.x address), POOL_SHARE_PORT (4180).
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
REPO="${ROXIRA_REPO:-$HOME/Developer/roxira-platform}"
KP="$REPO/scripts/infra/key_pool"
STATE="${POOL_SHARE_STATE:-$HOME/.config/roxira-pool-share}"
SECRETS="${ROXIRA_SECRETS:-$HOME/Secrets/roxira}"
IFACE="${POOL_SHARE_IFACE:-en0}"
PORT="${POOL_SHARE_PORT:-4180}"
IMAGE="${POOL_SHARE_IMAGE:-ghcr.io/berriai/litellm:main-stable}"
PGIMAGE="${POOL_SHARE_PG_IMAGE:-postgres:16-alpine}"
NET=pool-share-net; DB=pool-share-db; APP=pool-share
log() { printf '[pool-share] %s\n' "$*"; }
die() { printf '[pool-share] ERROR: %s\n' "$*" >&2; exit 1; }

umask 077
mkdir -p "$STATE" "$HOME/Library/Logs/roxira-pool-share"
BIND="${POOL_SHARE_BIND:-$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)}"
[ -n "$BIND" ] || die "no IPv4 address on $IFACE (not on Wi-Fi?)"
case "$BIND" in 0.0.0.0|127.*) die "refusing to bind $BIND" ;; esac
docker info >/dev/null 2>&1 || die "docker is not running"
INNER=$((PORT + 1))   # container is published on 127.0.0.1:$INNER only; lan_forward.py exposes it on $BIND:$PORT
docker rm -f "$APP" >/dev/null 2>&1 || true
pkill -f "lan_forward.py $BIND $PORT" 2>/dev/null || true
for p in "$PORT" "$INNER"; do
  lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | grep -q . && die "port $p busy (AGENTS.md section 7)"
done

# secrets: master key + db password, generated once, never printed
gen() { [ -s "$1" ] || { openssl rand -hex 24 > "$1"; chmod 600 "$1"; }; }
gen "$SECRETS/pool-share.master"; gen "$SECRETS/pool-share-db.pass"
MASTER="sk-$(cat "$SECRETS/pool-share.master")"; DBPASS="$(cat "$SECRETS/pool-share-db.pass")"

# config + env file (names from key_pool.yaml only; values copied from roxira.env, never printed)
SRC_ENV="${KEYPOOL_SRC_ENV:-$SECRETS/roxira.env}"
(cd "$KP" && python3 render_litellm.py --env-file "$SRC_ENV" --out "$STATE/rendered.yaml") 2>&1 | cut -c1-200
python3 - "$KP" "$SRC_ENV" "$STATE" "$MASTER" "$DBPASS" <<'PY'
import sys, yaml
sys.path.insert(0, sys.argv[1])
import keypool_config as k
kp, src, st, master, dbpass = sys.argv[1:6]
pool = k.load_pool(); got = k.parse_env_names(src, k.all_key_names(pool))
with open(f"{st}/keys.env", "w") as fh:
    for n, v in got.items(): fh.write(f"{n}={v}\n")
    fh.write(f"KEYPOOL_MASTER_KEY={master}\nLITELLM_SALT_KEY=sk-{master[-24:]}\n")
    fh.write(f"DATABASE_URL=postgresql://litellm:{dbpass}@pool-share-db:5432/litellm\nKEYPOOL_COST_LOG=/logs/requests.jsonl\n")
cfg = yaml.safe_load(open(f"{st}/rendered.yaml"))
# omniroute runs on this host: reach it from inside the container
for m in cfg["model_list"]:
    b = m["litellm_params"].get("api_base")
    if b and "127.0.0.1:20128" in b: m["litellm_params"]["api_base"] = b.replace("127.0.0.1", "host.docker.internal")
cfg.setdefault("general_settings", {})["store_prisma_audit_logs"] = False
cfg["general_settings"]["allow_requests_on_db_unavailable"] = False
cfg["litellm_settings"]["callbacks"] = ["cost_logger.proxy_handler_instance"]
yaml.safe_dump(cfg, open(f"{st}/config.yaml", "w"), sort_keys=False)
PY
chmod 600 "$STATE"/keys.env "$STATE"/config.yaml

# private network + database (no published port)
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
if ! docker ps -a --format '{{.Names}}' | grep -qx "$DB"; then
  docker run -d --name "$DB" --restart unless-stopped --network "$NET" -v pool-share-pgdata:/var/lib/postgresql/data \
    -e POSTGRES_USER=litellm -e POSTGRES_DB=litellm -e POSTGRES_PASSWORD="$DBPASS" "$PGIMAGE" >/dev/null
else docker start "$DB" >/dev/null 2>&1 || true; fi
for _ in $(seq 1 30); do docker exec "$DB" pg_isready -U litellm >/dev/null 2>&1 && break; sleep 1; done

log "serving on http://$BIND:$PORT (image $IMAGE)"
docker run --rm --name "$APP" --network "$NET" --add-host host.docker.internal:host-gateway \
  --env-file "$STATE/keys.env" -p "127.0.0.1:$INNER:4000" \
  -v "$STATE/config.yaml:/app/config.yaml:ro" -v "$KP/cost_logger.py:/app/cost_logger.py:ro" \
  -v "$HOME/Library/Logs/roxira-pool-share:/logs" \
  "$IMAGE" --config /app/config.yaml --port 4000 &
DPID=$!
python3 "$(dirname "$0")/lan_forward.py" "$BIND" "$PORT" "$INNER" &
FPID=$!
trap 'kill $DPID $FPID 2>/dev/null; docker rm -f "$APP" >/dev/null 2>&1' EXIT TERM INT
# either process dying ends the script so launchd restarts everything (macOS bash 3.2 has no wait -n)
while kill -0 "$DPID" 2>/dev/null && kill -0 "$FPID" 2>/dev/null; do sleep 5; done
