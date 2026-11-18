#!/bin/bash
# Run as user 'runner' (no sudo): rootless Docker + GitHub Actions runner files.
set -u
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export PATH=/usr/share/docker.io/contrib:$HOME/bin:$PATH
echo "== rootless docker"
if ! systemctl --user is-active -q docker 2>/dev/null; then
  if command -v dockerd-rootless-setuptool.sh >/dev/null; then
    dockerd-rootless-setuptool.sh install 2>&1 | tail -15
  else
    echo "NO dockerd-rootless-setuptool.sh found"; ls /usr/share/docker.io/contrib 2>&1 | head
  fi
fi
systemctl --user enable --now docker 2>/dev/null
grep -q DOCKER_HOST ~/.bashrc || echo 'export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock' >> ~/.bashrc
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
docker info --format 'rootless={{.SecurityOptions}} driver={{.Driver}}' 2>&1 | head -2
docker pull -q public.ecr.aws/docker/library/postgres:17 2>&1 | tail -1
echo "== actions runner"
mkdir -p ~/actions-runner && cd ~/actions-runner
if [ ! -x ./config.sh ]; then
  V=$(curl -fsSL -m 20 https://api.github.com/repos/actions/runner/releases/latest | grep -oP '"tag_name":\s*"v\K[^"]+')
  curl -fsSL -m 300 -o r.tgz "https://github.com/actions/runner/releases/download/v$V/actions-runner-linux-x64-$V.tar.gz" && tar xzf r.tgz && rm r.tgz && echo "runner $V unpacked"
fi
ls ~/actions-runner | head -5
