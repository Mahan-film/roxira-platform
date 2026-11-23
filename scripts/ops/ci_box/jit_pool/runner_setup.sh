#!/usr/bin/env bash
# One-time (and refresh) setup for the JIT pool, as user `runner` (R20-8, #1024).
# Called by 08_root_ci_pool.sh through runuser; can be re-run by the runner user any time.
#   1. download the actions/runner release matching the old runner (or RUNNER_VERSION), check its
#      SHA-256 against the release asset digest, unpack it into ~/jit/runner-template;
#   2. build the light image roxira-ci-light:latest from that template;
#   3. install user units roxira-jit@.service with per-slot limits and enable light + docker;
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
mkdir -p "$units/roxira-jit@docker.service.d" "$units/roxira-jit@light.service.d"
install -m 0644 "$lib/roxira-jit@.service" "$units/roxira-jit@.service"
# docker slot: the runner process and job steps (brief section 7: 4 threads, 6 GB). Service
# containers run under rootless dockerd, outside this unit; the user-wide cap from the root script
# bounds them.
printf '[Service]\nCPUQuota=400%%\nMemoryHigh=5G\nMemoryMax=6G\nTasksMax=4096\n' > "$units/roxira-jit@docker.service.d/limits.conf"
# light slot: the launcher only; the container itself is limited by docker run (--cpus 1 --memory 2g).
printf '[Service]\nCPUQuota=50%%\nMemoryMax=256M\n' > "$units/roxira-jit@light.service.d/limits.conf"
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
systemctl --user enable --now roxira-jit@light.service roxira-jit@docker.service
# A launcher started before the installed jit_launcher.sh keeps running the old code (bash holds the
# old file). Launchers from #1276 on re-exec themselves between jobs; older ones must be restarted.
# Restart only when no job runs anywhere on the box: the idle JIT runner it holds is dropped, the
# controller deletes it as offline (stale_after_s) and mints a fresh one.
lmt="$(stat -c %Y "$lib/jit_launcher.sh")"
for s in light docker; do
  started="$(systemctl --user show -p ExecMainStartTimestamp --value "roxira-jit@$s.service" || true)"
  [ -n "$started" ] || continue
  st="$(date -d "$started" +%s 2>/dev/null || echo 0)"
  [ "$st" -lt "$lmt" ] || continue
  if pgrep -f 'bin/Runner.Worker' >/dev/null 2>&1; then
    echo "roxira-jit@$s: older launcher, a job is running; rerun this script when idle"
  else
    systemctl --user restart "roxira-jit@$s.service" && echo "roxira-jit@$s: restarted with the new launcher"
  fi
done
for s in light docker; do echo "roxira-jit@$s: $(systemctl --user is-active roxira-jit@$s.service || true)"; done
echo "old runner (actions-runner): $(systemctl --user is-active actions-runner.service || true) (kept until two JIT runs pass)"
