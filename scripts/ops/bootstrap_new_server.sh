#!/usr/bin/env bash
# MOVED: the single bootstrap script is now scripts/infra/bootstrap_new_server.sh (host baseline, --restore for the data restore).
echo "scripts/ops/bootstrap_new_server.sh moved to scripts/infra/bootstrap_new_server.sh (running it with --restore, as this script used to restore too)" >&2
exec "$(dirname "$0")/../infra/bootstrap_new_server.sh" --restore "$@"
