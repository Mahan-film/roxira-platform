#!/usr/bin/env bash
# Lane environment: put worktrees and big caches on the external work disk when it is mounted (#1341).
#   source scripts/dev/lane_env.sh
# Safe to source more than once. Changes nothing when the disk is not mounted (Linux laptop, CI).
# No secrets here: only paths.
# ROXIRA_WORK_DISK overrides the work folder (default /Volumes/ssd/roxira-work, see docs/owner/ANTIGRAVITY_GUIDE_FA.md).

_rx_work="${ROXIRA_WORK_DISK:-/Volumes/ssd/roxira-work}"
if [ -d "$_rx_work/wt" ] && [ -w "$_rx_work/wt" ]; then
  export ROXIRA_WT_ROOT="$_rx_work/wt"
  export npm_config_cache="$_rx_work/npm-cache"
  export PIP_CACHE_DIR="$_rx_work/pip-cache"
  export PLAYWRIGHT_BROWSERS_PATH="$_rx_work/pw-browsers"
  export ROXIRA_SCRATCH="$_rx_work/tmp"
  echo "lane_env: work disk $_rx_work (worktrees, npm, pip and Playwright caches)"
else
  echo "lane_env: work disk not mounted; using the internal disk"
fi
unset _rx_work
