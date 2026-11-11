#!/usr/bin/env bash
# Provision a GitHub Actions self-hosted runner VM (Ubuntu 24.04). Run ON the VM as root:
#   RUNNER_TOKEN=<token> SRV1_HOST=<ip> bash setup_runner.sh [--dry-run]
# All outbound HTTP(S) goes through an SSH tunnel to the tinyproxy on srv1.
set -euo pipefail

# ---- settings (no secrets here; the token comes from the environment) ----
SRV1_HOST="${SRV1_HOST:-}"                           # srv1 address (required)
SRV1_USER="${SRV1_USER:-root}"
SRV1_SSH_PORT="${SRV1_SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-/home/runner/.ssh/id_ed25519}"   # key authorised on srv1; create it yourself
PROXY_PORT="${PROXY_PORT:-3128}"
REPO_URL="https://github.com/Mahan-film/roxira-platform"
RUNNERS="${RUNNERS:-2}"
LABEL="roxira-ci"
RUNNER_VERSION="${RUNNER_VERSION:-}"                 # empty = latest release
# --------------------------------------------------------------------------
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
PROXY="http://127.0.0.1:${PROXY_PORT}"
NOPROXY="localhost,127.0.0.1,::1"

run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
put() { # put <path> <mode>, content on stdin
  if [ "$DRY" = 1 ]; then echo "[dry-run] write $1"; cat >/dev/null; else cat > "$1"; chmod "$2" "$1"; fi
}

if [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then echo "run as root" >&2; exit 1; fi
if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo "RUNNER_TOKEN is empty: gh api -X POST repos/Mahan-film/roxira-platform/actions/runners/registration-token --jq .token" >&2
  exit 1
fi
[ -n "$SRV1_HOST" ] || { echo "SRV1_HOST is empty" >&2; exit 1; }
export RUNNER_TOKEN

# 1. packages
run apt-get update
run env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io git jq curl autossh ca-certificates

# 2. user
id runner >/dev/null 2>&1 || run useradd -m -s /bin/bash runner
run usermod -aG docker runner

# 3. autossh tunnel to the proxy on srv1 (the key must exist and be authorised on srv1)
put /etc/systemd/system/roxira-proxy-tunnel.service 0644 <<UNIT
[Unit]
Description=SSH tunnel to the forward proxy on srv1
After=network-online.target
Wants=network-online.target

[Service]
User=runner
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 -N -L 127.0.0.1:${PROXY_PORT}:127.0.0.1:${PROXY_PORT} \\
  -i ${SSH_KEY} -p ${SRV1_SSH_PORT} \\
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \\
  -o StrictHostKeyChecking=accept-new ${SRV1_USER}@${SRV1_HOST}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# 4. proxy settings: system, docker daemon, npm, pip
if [ "$DRY" = 1 ]; then
  echo "[dry-run] set proxy vars in /etc/environment"
else
  sed -i -E '/^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy)=/d' /etc/environment
  for k in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; do echo "${k}=${PROXY}"; done >> /etc/environment
  for k in NO_PROXY no_proxy; do echo "${k}=${NOPROXY}"; done >> /etc/environment
fi
run mkdir -p /etc/systemd/system/docker.service.d
put /etc/systemd/system/docker.service.d/http-proxy.conf 0644 <<CONF
[Service]
Environment="HTTP_PROXY=${PROXY}" "HTTPS_PROXY=${PROXY}" "NO_PROXY=${NOPROXY}"
CONF
put /home/runner/.npmrc 0644 <<CONF
proxy=${PROXY}
https-proxy=${PROXY}
noproxy=${NOPROXY}
CONF
run mkdir -p /home/runner/.config/pip
put /home/runner/.config/pip/pip.conf 0644 <<CONF
[global]
proxy = ${PROXY}
CONF
run chown -R runner:runner /home/runner/.npmrc /home/runner/.config
run systemctl daemon-reload
run systemctl enable --now roxira-proxy-tunnel.service
run systemctl enable docker
run systemctl restart docker

# 5. GitHub Actions runner instances
if [ -z "$RUNNER_VERSION" ] && [ "$DRY" = 0 ]; then
  RUNNER_VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')
fi
RUNNER_VERSION="${RUNNER_VERSION:-latest}"
TARBALL="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
for i in $(seq 1 "$RUNNERS"); do
  dir="/opt/actions-runner-${i}"
  if [ -f "${dir}/.runner" ]; then echo "runner ${i} already configured, skipping"; continue; fi
  run mkdir -p "$dir"
  run curl -fsSL -o "${dir}/${TARBALL}" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"
  run tar -xzf "${dir}/${TARBALL}" -C "$dir"
  run rm -f "${dir}/${TARBALL}"
  run chown -R runner:runner "$dir"
  run "${dir}/bin/installdependencies.sh"
  run runuser -u runner -- bash -c "cd ${dir} && ./config.sh --unattended --replace --url ${REPO_URL} --token \"\$RUNNER_TOKEN\" --labels ${LABEL} --name ${LABEL}-${i}"
  run bash -c "cd ${dir} && ./svc.sh install runner && ./svc.sh start"
done

# 6. weekly docker prune so the disk does not fill
put /etc/systemd/system/roxira-docker-prune.service 0644 <<UNIT
[Unit]
Description=Prune old docker images and build cache

[Service]
Type=oneshot
ExecStart=/usr/bin/docker system prune -af --filter until=72h
ExecStart=/usr/bin/docker builder prune -af --filter until=72h
UNIT
put /etc/systemd/system/roxira-docker-prune.timer 0644 <<UNIT
[Unit]
Description=Weekly docker prune

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
UNIT
run systemctl daemon-reload
run systemctl enable --now roxira-docker-prune.timer
echo "done: ${RUNNERS} runner(s) labelled ${LABEL}"
