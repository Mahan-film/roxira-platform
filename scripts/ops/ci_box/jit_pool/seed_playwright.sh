#!/usr/bin/env bash
# Seed Playwright's Chromium for CI on the box (#1024). Run as mahanfilms (its egress goes through the
# local proxy; the browser CDN is blocked from this network for the `runner` user, which has no proxy).
# Installs the browser of the Playwright version pinned in e2e/package-lock.json into
# /srv/data/ci-jit/ms-playwright, which CI uses on self-hosted runners (PLAYWRIGHT_BROWSERS_PATH in
# ci.yml). Re-run after every Playwright upgrade; old browser builds are left for the previous version.
#   bash scripts/ops/ci_box/jit_pool/seed_playwright.sh [<repo checkout>]
set -euo pipefail
repo="${1:-$HOME/roxira-platform}"
dest="${PLAYWRIGHT_SEED_DIR:-/srv/data/ci-jit/ms-playwright}"
[ -d "$dest" ] || { echo "$dest missing: the owner runs 08_root_ci_pool.sh first" >&2; exit 1; }
[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] || { echo "no HTTPS_PROXY in this shell; run it as mahanfilms" >&2; exit 1; }
ver="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["packages"]["node_modules/playwright"]["version"])' \
  "$repo/e2e/package-lock.json")"
case "$ver" in [0-9]*.[0-9]*.[0-9]*) ;; *) echo "bad playwright version in $repo/e2e/package-lock.json" >&2; exit 1 ;; esac
echo "seeding chromium for playwright $ver into $dest"
umask 022
cd "$(mktemp -d)"
PLAYWRIGHT_BROWSERS_PATH="$dest" npx -y "playwright@$ver" install chromium
# `playwright install` in CI writes a marker into .links even when the browser exists; runner may
# write there (browsers themselves stay read-only for runner).
mkdir -p "$dest/.links"
setfacl -m "u:runner:rwx" -m "d:u:runner:rw" "$dest/.links"
ls -1 "$dest"
