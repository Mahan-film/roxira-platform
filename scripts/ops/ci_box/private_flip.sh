#!/usr/bin/env bash
# Private flip of Mahan-film/roxira-platform. Default is --dry-run (read-only); --apply --owner-go does the flip and
# refuses when a prerequisite fails. Logic: private_flip.py (tested in src/ops/test_box_private_flip.py).
# Run as mahanfilms on the box (gh through the local proxy):
#   HTTPS_PROXY=http://127.0.0.1:10809 NODE_USE_ENV_PROXY=1 bash scripts/ops/ci_box/private_flip.sh [--dry-run]
set -euo pipefail
exec python3 "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/private_flip.py" "$@"
