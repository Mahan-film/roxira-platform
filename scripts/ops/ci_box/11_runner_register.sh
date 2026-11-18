#!/bin/bash
# Reads a short-lived registration token on stdin (never printed), registers, installs a user service.
set -u
read -r TOKEN
cd ~/actions-runner
./config.sh --unattended --replace --url https://github.com/Mahan-film/roxira-platform --token "$TOKEN" \
  --name roxira-ci --labels hp,linux-box --work /srv/data/ci-cache/_work 2>&1 | grep -vi token | tail -6
unset TOKEN
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/actions-runner.service <<'UNIT'
[Unit]
Description=GitHub Actions runner (roxira-ci)
After=docker.service
[Service]
WorkingDirectory=%h/actions-runner
Environment=DOCKER_HOST=unix:///run/user/%U/docker.sock
ExecStart=%h/actions-runner/run.sh
Restart=always
RestartSec=10
[Install]
WantedBy=default.target
UNIT
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user daemon-reload && systemctl --user enable --now actions-runner && sleep 5 && systemctl --user is-active actions-runner
