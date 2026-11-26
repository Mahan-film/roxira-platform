#!/usr/bin/env bash
# JIT runner launcher for one slot (R20-8, #1024). Runs as user `runner` from the user unit
# roxira-jit@<slot>.service (installed by 08_root_ci_pool.sh into /usr/local/lib/roxira-jit, root-owned,
# so job code cannot change it). One job at a time per slot:
#   1. touch <spool>/<slot>/.alive.<instance> (and .alive); the controller mints one config per
#      live launcher plus `ahead` spares. Instances: `light`, `light-2`, `light-3` (units
#      roxira-jit@light-2 ...) share the light spool; claims are atomic renames;
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

inst="${1:?usage: jit_launcher.sh light|light-<n>|docker}"
case "$inst" in
  light|docker) slot="$inst" ;;
  light-[2-9]) slot=light ;;
  *) echo "unknown slot $inst" >&2; exit 2 ;;
esac

spool="${JIT_SPOOL:-/srv/data/ci-jit/spool}/$slot"
control="${JIT_CONTROL:-/srv/data/ci-jit/control}"
home="${JIT_HOME:-/srv/data/ci-cache/jit}"
template="${JIT_TEMPLATE:-$HOME/jit/runner-template}"
image="${JIT_IMAGE:-roxira-ci-light:latest}"
poll="${JIT_POLL:-3}"
# Wall-time cap per job (jit_watchdog.py): default 1110 s = longest of the last 20 real runs (739 s) + 50%.
# Override: JIT_MAX_WALL_S, or the control file $control/max-wall-s (seconds; mahanfilms can write it).
watchdog="${JIT_WATCHDOG:-$(dirname "$(readlink -f "$0")")/jit_watchdog.py}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DOCKER_HOST="${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}"
umask 077

say() { echo "jit-$inst: $*"; }

retire_old_runner() {
  [ -e "$control/retire-old-runner" ] || return 0
  systemctl --user is-enabled -q actions-runner 2>/dev/null || return 0
  # Never cut a running job short: wait until the old runner has no Runner.Worker.
  if pgrep -u "$(id -u)" -f 'actions-runner/bin/Runner.Worker' >/dev/null 2>&1; then
    say "retire-old-runner flag found: old runner busy, retrying next loop"
    return 0
  fi
  say "retire-old-runner flag found: disabling the persistent runner service"
  systemctl --user disable --now actions-runner || true
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

# guard <on-timeout cmd> <cmd...>: run cmd under the wall-time watchdog. If the watchdog file is
# missing, fall back to coreutils timeout: never run an unbounded job.
guard() {
  local on_to="$1"; shift
  if [ -f "$watchdog" ]; then
    python3 "$watchdog" --control-file "$control/max-wall-s" --on-timeout "$on_to" -- "$@"
  else
    say "watchdog missing, falling back to timeout"
    timeout --kill-after=10 "${JIT_MAX_WALL_S:-1110}" "$@"
  fi
}

run_light() {
  local name="$1" cfg="$2" envf cid rc
  envf="$(mktemp "$XDG_RUNTIME_DIR/jit-env.XXXXXX")"
  printf 'ACTIONS_RUNNER_INPUT_JITCONFIG=%s\n' "$cfg" > "$envf"
  cid="$(docker create --rm --name "$name" \
    --cpus 1 --memory 2g --memory-swap 2g --pids-limit 4096 \
    --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,exec,size=2g \
    --cpu-shares 512 \
    -v "roxira-jit-toolcache-$inst:/opt/hostedtoolcache:ro" \
    -e RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    -e BASH_ENV=/usr/local/share/roxira-pip-venv.sh \
    -e PIP_CACHE_DIR=/tmp/pip-cache \
    --env-file "$envf" \
    --label roxira.jit.slot=light --label "roxira.jit.instance=$inst" \
    "$image" /home/runner/actions-runner/run.sh)" || { rm -f "$envf"; return 1; }
  rm -f "$envf"
  say "container ${cid:0:12} for $name"
  set +e
  guard "docker kill $name" docker start -a "$cid"
  rc=$?
  set -e
  return "$rc"
}

# The docker slot's runner and job steps are pinned to 4 CPUs (brief section 7: phone keeps 0-1).
# Without it, tools that size by core count (Jest, npm, Next) see 8 threads under a 4-CPU quota and
# get throttled: the first JIT run timed out a CPU-heavy Jest spec. Service containers run under
# dockerd and are not pinned. JIT_DOCKER_CPUS="" disables pinning.
pin_prefix() {
  local cpus="${JIT_DOCKER_CPUS-2-5}" last
  [ -n "$cpus" ] && command -v taskset >/dev/null 2>&1 || return 0
  last="$(printf '%s' "$cpus" | grep -oE '[0-9]+' | sort -n | tail -1)"
  [ -n "$last" ] && [ "$last" -lt "$(nproc --all)" ] || return 0
  printf 'taskset -c %s' "$cpus"
}

run_docker() {
  local name="$1" cfg="$2" dir rc pin
  pin="$(pin_prefix)"
  dir="$home/docker/$name"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -a "$template/." "$dir/"
  set +e
  (
    cd "$dir"
    # shellcheck disable=SC2086
    guard "" $pin env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin USER="$(id -un)" LANG=C.UTF-8 \
      XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" DOCKER_HOST="$DOCKER_HOST" \
      RUNNER_TOOL_CACHE=/opt/hostedtoolcache AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache \
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
# Re-exec between jobs when 08_root_ci_pool.sh installed a newer launcher (never mid-job).
self_sig="$(stat -c %Y:%i "$0" 2>/dev/null || true)"
# runner_setup.sh compares this with the installed file to tell whether a restart is needed.
printf '%s\n' "$self_sig" > "$spool/.launcher-sig.$inst" 2>/dev/null || true
while :; do
  if [ "$(stat -c %Y:%i "$0" 2>/dev/null || true)" != "$self_sig" ]; then
    say "launcher updated on disk: re-exec"
    exec bash "$0" "$inst"
  fi
  touch "$spool/.alive" "$spool/.alive.$inst"
  retire_old_runner
  claimed="$(claim)"
  if [ -n "$claimed" ]; then
    name="$(basename "$claimed")"; name="${name%%.jit.claimed.*}"
    cfg="$(cat "$claimed")"
    rm -f "$claimed"
    say "start $name"
    # keep .alive fresh while a long job runs
    ( while sleep 30; do touch "$spool/.alive" "$spool/.alive.$inst"; done ) </dev/null >/dev/null 2>&1 & keep=$!
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
