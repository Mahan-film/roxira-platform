#!/usr/bin/env bash
# One-time (and refresh) setup for the JIT pool, as user `runner` (R20-8, #1024).
# Called by 08_root_ci_pool.sh through runuser; can be re-run by the runner user any time.
#   1. download the actions/runner release matching the old runner (or RUNNER_VERSION), check its
#      SHA-256 against the release asset digest, unpack it into ~/jit/runner-template;
#   2. build the light image roxira-ci-light:latest from that template;
#   3. install user units roxira-jit@.service with per-slot limits and enable docker + the light
#      launchers light, light-2 .. light-$JIT_LIGHT_SLOTS (extra ones are disabled when idle);
#      restart a launcher still running older code, only while no job runs.
# Prints names and statuses only.
set -euo pipefail
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DOCKER_HOST="${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}"
lib="${JIT_LIB:-/usr/local/lib/roxira-jit}"
tpl="$HOME/jit/runner-template"
ver="${RUNNER_VERSION:-}"
if [ -z "$ver" ] && [ -x "$HOME/actions-runner/bin/Runner.Listener" ]; then
  ver="$("$HOME/actions-runner/bin/Runner.Listener" --version 2>/dev/null | tr -d '[:space:]')"
fi
case "$ver" in [0-9]*.[0-9]*.[0-9]*) ;; *) echo "runner version unknown; set RUNNER_VERSION" >&2; exit 1 ;; esac

if [ "$(cat "$tpl/.roxira-version" 2>/dev/null || true)" != "$ver" ]; then
  echo "runner template: fetching v$ver"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  asset="actions-runner-linux-x64-$ver.tar.gz"
  want="$(curl -fsSL -m 30 "https://api.github.com/repos/actions/runner/releases/tags/v$ver" \
    | python3 -c "import json,sys; a=[x for x in json.load(sys.stdin)['assets'] if x['name']=='$asset']; print((a[0].get('digest') or '').removeprefix('sha256:') if a else '')")"
  [ -n "$want" ] || { echo "no digest for $asset in the release metadata" >&2; exit 1; }
  curl -fsSL -m 600 -o "$tmp/r.tgz" "https://github.com/actions/runner/releases/download/v$ver/$asset"
  got="$(sha256sum "$tmp/r.tgz" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || { echo "runner tarball SHA-256 mismatch" >&2; exit 1; }
  rm -rf "$tpl.new" && mkdir -p "$tpl.new" && tar xzf "$tmp/r.tgz" -C "$tpl.new"
  echo "$ver" > "$tpl.new/.roxira-version"
  rm -rf "$tpl" && mv "$tpl.new" "$tpl"
  echo "runner template: v$ver ok"
else
  echo "runner template: v$ver present"
fi

echo "light image: building"
docker build -q -t roxira-ci-light:latest -t "roxira-ci-light:$ver" -f "$lib/Dockerfile.light" "$tpl" >/dev/null
echo "light image: roxira-ci-light:$ver ok"

units="$HOME/.config/systemd/user"
# Light launcher units: light, light-2 .. light-<n> (JIT_LIGHT_SLOTS from 08_root_ci_pool.sh, 1..9).
light_n="${JIT_LIGHT_SLOTS:-1}"
case "$light_n" in [1-9]) ;; *) echo "JIT_LIGHT_SLOTS must be 1..9" >&2; exit 1 ;; esac
light_units="light"
i=2; while [ "$i" -le "$light_n" ]; do light_units="$light_units light-$i"; i=$((i + 1)); done
mkdir -p "$units/roxira-jit@docker.service.d"
for u in $light_units; do mkdir -p "$units/roxira-jit@$u.service.d"; done
install -m 0644 "$lib/roxira-jit@.service" "$units/roxira-jit@.service"
# docker slot: the runner process and job steps (brief section 7: 4 threads, 6 GB). Service
# containers run under rootless dockerd, outside this unit; the user-wide cap from the root script
# bounds them.
# No MemoryHigh below the budget: reclaim throttling at 5G slowed Jest and the timed pg specs.
printf '[Service]\nCPUQuota=400%%\nMemoryHigh=infinity\nMemoryMax=6G\nTasksMax=4096\n' > "$units/roxira-jit@docker.service.d/limits.conf"
# light slot: the launcher only; the container itself is limited by docker run (--cpus 1 --memory 2g).
for u in $light_units; do
  printf '[Service]\nCPUQuota=50%%\nMemoryMax=256M\n' > "$units/roxira-jit@$u.service.d/limits.conf"
done
# The old persistent runner gets the same tool cache path (setup-python needs /opt/hostedtoolcache).
# It is restarted only when no job is running; otherwise the next restart picks it up.
mkdir -p "$units/actions-runner.service.d"
printf '[Service]\nEnvironment=RUNNER_TOOL_CACHE=/opt/hostedtoolcache\nEnvironment=AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache\n' \
  > "$units/actions-runner.service.d/toolcache.conf"
systemctl --user daemon-reload
if pgrep -u "$(id -u)" -f Runner.Worker >/dev/null 2>&1; then
  echo "old runner: busy, tool cache path applies at its next restart"
else
  systemctl --user try-restart actions-runner.service && echo "old runner: restarted with /opt/hostedtoolcache"
fi
systemctl --user enable --now roxira-jit@docker.service
for u in $light_units; do systemctl --user enable --now "roxira-jit@$u.service"; done
# Fewer light slots than before: stop the extra units only when they are idle (one job each).
i=$((light_n + 1)); while [ "$i" -le 9 ]; do
  u="roxira-jit@light-$i.service"
  if systemctl --user is-enabled -q "$u" 2>/dev/null; then
    if docker ps -q --filter "label=roxira.jit.instance=light-$i" 2>/dev/null | grep -q .; then
      echo "$u: running a job; rerun this script to stop it afterwards"
    else
      systemctl --user disable --now "$u" && echo "$u: disabled (JIT_LIGHT_SLOTS=$light_n)"
    fi
  fi
  i=$((i + 1))
done
# A running launcher re-execs itself between jobs when jit_launcher.sh changed (#1276 on) and then
# writes the file's signature to <spool>/<slot>/.launcher-sig. A slot whose signature does not match
# the installed file runs older code: restart it, but only when no job runs anywhere on the box (the
# idle JIT runner it holds is dropped; the controller deletes it as offline and mints a fresh one).
want_sig="$(stat -c %Y:%i "$lib/jit_launcher.sh")"
for s in $light_units docker; do
  d="${JIT_SPOOL:-/srv/data/ci-jit/spool}/${s%%-*}"
  have_sig="$(cat "$d/.launcher-sig.$s" 2>/dev/null || cat "$d/.launcher-sig" 2>/dev/null || true)"
  [ "$have_sig" != "$want_sig" ] || { echo "roxira-jit@$s: runs the installed launcher"; continue; }
  if pgrep -f 'bin/Runner.Worker' >/dev/null 2>&1; then
    echo "roxira-jit@$s: older launcher, a job is running; it re-execs after that job (rerun to check)"
  else
    systemctl --user restart "roxira-jit@$s.service" && echo "roxira-jit@$s: restarted with the new launcher"
  fi
done
for s in $light_units docker; do echo "roxira-jit@$s: $(systemctl --user is-active roxira-jit@$s.service || true)"; done
echo "old runner (actions-runner): $(systemctl --user is-active actions-runner.service || true) (kept until two JIT runs pass)"
