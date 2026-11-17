#!/usr/bin/env bash
# Point-in-time restore drill for WAL-G (row T204). Runs on the Mac (or any docker host); never touches production.
# Restores the newest base backup (or --backup NAME) plus WAL up to --target-time into a THROWAWAY container
# published on 127.0.0.1:<port> (default 55770, range 55770-55799), runs a verification query, prints
# "walg restore drill passed" (exit 0) or "walg restore drill FAILED" (exit 1), and removes the container.
#
#   bash scripts/ops/walg/restore_to_time.sh --env-file ~/Secrets/roxira/walg.env \
#        --target-time '2026-11-17 09:30:00+00'            # or --latest (replay all archived WAL)
#   options: --backup LATEST|base_...  --port 55770  --image roxira-postgres-walg:17-walg3.0.9
#            --verify-sql "SELECT ..."  --keep (leave the container running)  --dry-run
#
# Safety: the restored cluster starts with archive_mode=off and an empty archive_command, so it can never write
# to the production walg/ prefix. Use a READ-ONLY R2 token in the env file for drills if you can.
# T198's Mac drill can call this script (exit code + the "passed" line are the contract).
# The env file holds secrets: it is only passed to docker with --env-file and is never printed.
set -euo pipefail

port=55770 image="roxira-postgres-walg:17-walg3.0.9" backup="LATEST" target="" latest=0 keep=0 dry=0 env_file=""
verify_sql="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"
timeout_s=900

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }
fail() { echo "walg restore drill FAILED: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) env_file="${2:?}"; shift 2 ;;
    --target-time) target="${2:?}"; shift 2 ;;
    --latest) latest=1; shift ;;
    --backup) backup="${2:?}"; shift 2 ;;
    --port) port="${2:?}"; shift 2 ;;
    --image) image="${2:?}"; shift 2 ;;
    --verify-sql) verify_sql="${2:?}"; shift 2 ;;
    --timeout) timeout_s="${2:?}"; shift 2 ;;
    --keep) keep=1; shift ;;
    --dry-run) dry=1; shift ;;
    -h | --help) usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 2 ;;
  esac
done

[[ "$port" =~ ^[0-9]+$ ]] || fail "port must be a number"
{ [ "$port" -ge 55770 ] && [ "$port" -le 55799 ]; } || fail "port must be in 55770-55799 (non-reserved range)"
[[ "$backup" =~ ^[A-Za-z0-9_]+$ ]] || fail "bad --backup name"
if [ "$latest" = 1 ] && [ -n "$target" ]; then fail "use either --latest or --target-time"; fi
if [ "$latest" = 0 ] && [ -z "$target" ]; then fail "give --target-time 'YYYY-MM-DD HH:MM:SS+00' or --latest"; fi
if [ -n "$target" ] && ! [[ "$target" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[\ T][0-9]{2}:[0-9]{2}:[0-9]{2}([+-][0-9]{2}(:?[0-9]{2})?|Z)?$ ]]; then
  fail "target time must look like '2026-11-17 09:30:00+00' (give a time zone; UTC is safest)"
fi

name="roxira_walg_restore_$(date -u +%Y%m%d%H%M%S)"

# Recovery settings go into postgresql.auto.conf. archive_mode=off + empty archive_command: never write to prod.
conf_lines="restore_command = 'wal-g wal-fetch %f %p'
archive_mode = off
archive_command = ''
recovery_target_action = 'promote'"
[ -n "$target" ] && conf_lines="$conf_lines
recovery_target_time = '$target'
recovery_target_inclusive = on"

# Runs inside the throwaway container as root, drops to postgres via su-exec. Values are passed through the
# environment (RESTORE_BACKUP / RESTORE_CONF), not interpolated into the script.
# shellcheck disable=SC2016  # the inner script is single-quoted on purpose: it expands inside the container
inner='set -eu
mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"
su-exec postgres wal-g backup-fetch "$PGDATA" "$RESTORE_BACKUP"
printf "%s\n" "$RESTORE_CONF" >>"$PGDATA/postgresql.auto.conf"
touch "$PGDATA/recovery.signal"
exec su-exec postgres postgres -c listen_addresses=* -c archive_mode=off -c "archive_command=" -c max_wal_senders=0 -c hot_standby=on'

if [ "$dry" = 1 ]; then
  echo "[dry-run] docker run -d --name $name -p 127.0.0.1:$port:5432 --env-file <env-file> -e RESTORE_BACKUP=$backup --entrypoint sh $image -c '<fetch base backup, write recovery settings, start postgres>'"
  echo "[dry-run] recovery settings:"
  printf '%s\n' "$conf_lines" | sed 's/^/[dry-run]   /'
  echo "[dry-run] wait until pg_is_in_recovery() = false (timeout ${timeout_s}s), run: $verify_sql"
  echo "[dry-run] docker rm -f -v $name"
  exit 0
fi

command -v docker >/dev/null || fail "docker not found"
[ -n "$env_file" ] && [ -r "$env_file" ] || fail "--env-file <walg.env> is required and must be readable"
docker image inspect "$image" >/dev/null 2>&1 \
  || fail "image $image not found; build it: docker build -t $image docker/postgres-walg"
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then fail "port $port is already in use"; fi

cleanup() {
  if [ "$keep" = 1 ]; then
    echo "kept container $name on 127.0.0.1:$port (remove: docker rm -f -v $name)"
  else
    docker rm -f -v "$name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# The container gets prod-style PG* names from the env file; the restored cluster listens only on the published port.
docker run -d --name "$name" -p "127.0.0.1:$port:5432" --env-file "$env_file" \
  -e "RESTORE_BACKUP=$backup" -e "RESTORE_CONF=$conf_lines" -e "PGDATA=/var/lib/postgresql/data" \
  --entrypoint sh "$image" -c "$inner" >/dev/null || fail "could not start the restore container"

user="$(docker exec "$name" printenv PGUSER 2>/dev/null || echo postgres)"
db="$(docker exec "$name" printenv PGDATABASE 2>/dev/null || echo postgres)"
psql_in() { docker exec "$name" psql -U "$user" -d "$db" -Atqc "$1"; }

deadline=$(($(date +%s) + timeout_s))
while :; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != true ]; then
    docker logs --tail 15 "$name" 2>&1 | sed 's/^/  | /' >&2
    fail "container stopped during recovery (target time after the last archived WAL, missing key or wrong prefix?)"
  fi
  state="$(psql_in 'SELECT pg_is_in_recovery()' 2>/dev/null || true)"
  [ "$state" = "f" ] && break
  [ "$(date +%s)" -lt "$deadline" ] || { docker logs --tail 15 "$name" 2>&1 | sed 's/^/  | /' >&2; fail "recovery did not finish within ${timeout_s}s"; }
  sleep 3
done

stop_line="$(docker logs "$name" 2>&1 | grep -E 'recovery stopping|recovery ended|last completed transaction' | tail -3 || true)"
[ -n "$stop_line" ] && printf '%s\n' "$stop_line" | sed 's/^/  | /'

result="$(psql_in "$verify_sql" 2>&1)" || fail "verification query failed: $result"
echo "verify query result: $result"
[ -n "$result" ] || fail "verification query returned nothing"
if [ "$verify_sql" = "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" ] && [ "$result" = "0" ]; then
  fail "restored cluster has no user tables"
fi
echo "restored to: ${target:-end of archived WAL} (base backup: $backup), 127.0.0.1:$port"
echo "walg restore drill passed"
