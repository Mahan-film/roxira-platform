#!/usr/bin/env bash
# JIT runner launcher for one slot (R20-8, #1024). Runs as user `runner` from the user unit
# roxira-jit@<slot>.service (installed by 08_root_ci_pool.sh into /usr/local/lib/roxira-jit, root-owned,
# so job code cannot change it). One job at a time per slot:
#   1. touch <spool>/<slot>/.alive (the controller mints only for live launchers);
#   2. claim the oldest <spool>/<slot>/jit-*.jit (atomic rename), read it, delete it;
#   3. light:  a fresh container from image roxira-ci-light (no Docker socket, --cap-drop ALL,
#              no-new-privileges, 1 CPU, 2 GB, own tool-cache volume) runs `run.sh` with the JIT config;
#      docker: a fresh copy of the runner template in its own work dir runs on the host with the
#              rootless Docker socket (service containers, compose); the dir is deleted afterwards;
#   4. GitHub de-registers a JIT runner after its one job; loop.
# The JIT config travels in an env file (mode 600, deleted right after `docker create`) or the
# environment of the runner process, never on a command line. Nothing here prints it.
# Control files in /srv/data/ci-jit/control (group ci-jit):
#   retire-old-runner   once present, the old persistent runner service (actions-runner) is disabled.
# Env (tests): JIT_SPOOL, JIT_CONTROL, JIT_HOME, JIT_ONCE=1 (one iteration), JIT_POLL (seconds).
set -euo pipefail

slot="${1:?usage: jit_launcher.sh light|docker}"
case "$slot" in light|docker) ;; *) echo "unknown slot $slot" >&2; exit 2 ;; esac

spool="${JIT_SPOOL:-/srv/data/ci-jit/spool}/$slot"
control="${JIT_CONTROL:-/srv/data/ci-jit/control}"
home="${JIT_HOME:-/srv/data/ci-cache/jit}"
template="${JIT_TEMPLATE:-$HOME/jit/runner-template}"
image="${JIT_IMAGE:-roxira-ci-light:latest}"
poll="${JIT_POLL:-3}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DOCKER_HOST="${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}"
umask 077

say() { echo "jit-$slot: $*"; }

retire_old_runner() {
  [ -e "$control/retire-old-runner" ] || return 0
  if systemctl --user is-enabled -q actions-runner 2>/dev/null; then
    say "retire-old-runner flag found: disabling the persistent runner service"
    systemctl --user disable --now actions-runner || true
  fi
}

claim() {
  # prints the claimed path, or nothing
  local f
  for f in "$spool"/jit-*.jit; do
    [ -e "$f" ] || return 0
    if mv "$f" "$f.claimed.$$" 2>/dev/null; then
      printf '%s\n' "$f.claimed.$$"
      return 0
    fi
  done
}

run_light() {
  local name="$1" cfg="$2" envf cid rc
  envf="$(mktemp "$XDG_RUNTIME_DIR/jit-env.XXXXXX")"
  printf 'ACTIONS_RUNNER_INPUT_JITCONFIG=%s\n' "$cfg" > "$envf"
  cid="$(docker create --rm --name "$name" \
    --cpus 1 --memory 2g --memory-swap 2g --pids-limit 4096 \
    --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,exec,size=2g \
    -v roxira-jit-toolcache-light:/opt/hostedtoolcache \
    -e RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    --env-file "$envf" \
    --label roxira.jit.slot=light \
    "$image" /home/runner/actions-runner/run.sh)" || { rm -f "$envf"; return 1; }
  rm -f "$envf"
  say "container ${cid:0:12} for $name"
  set +e
  docker start -a "$cid"
  rc=$?
  set -e
  return "$rc"
}

run_docker() {
  local name="$1" cfg="$2" dir rc
  dir="$home/docker/$name"
  rm -rf "$dir"
  mkdir -p "$dir" "$home/toolcache-docker"
  cp -a "$template/." "$dir/"
  set +e
  (
    cd "$dir"
    env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin USER="$(id -un)" LANG=C.UTF-8 \
      XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" DOCKER_HOST="$DOCKER_HOST" \
      RUNNER_TOOL_CACHE="$home/toolcache-docker" \
      ACTIONS_RUNNER_INPUT_JITCONFIG="$cfg" \
      ./run.sh
  )
  rc=$?
  set -e
  # The runner removes its own service containers and networks at job end (also on cancel).
  rm -rf "$dir"
  return "$rc"
}

mkdir -p "$spool" "$home"
while :; do
  touch "$spool/.alive"
  retire_old_runner
  claimed="$(claim)"
  if [ -n "$claimed" ]; then
    name="$(basename "$claimed")"; name="${name%%.jit.claimed.*}"
    cfg="$(cat "$claimed")"
    rm -f "$claimed"
    say "start $name"
    # keep .alive fresh while a long job runs
    ( while sleep 30; do touch "$spool/.alive"; done ) </dev/null >/dev/null 2>&1 & keep=$!
    rc=0
    if [ "$slot" = light ]; then run_light "$name" "$cfg" || rc=$?; else run_docker "$name" "$cfg" || rc=$?; fi
    kill "$keep" 2>/dev/null || true
    wait "$keep" 2>/dev/null || true
    cfg=""
    say "done $name (exit $rc)"
  fi
  [ "${JIT_ONCE:-0}" = 1 ] && exit 0
  sleep "$poll"
done
