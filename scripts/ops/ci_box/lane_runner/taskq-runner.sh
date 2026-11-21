#!/usr/bin/env bash
# TASKQ_RUNNER for the box: taskq calls this like run_task.sh. It hands over to lane-run (gateway key, box-local
# state, budget caps, JSON log line). taskq only queues public tasks here, so --public is always set.
# Direct-provider ladder steps (--model ds-flash/strong) are refused: this box holds no provider keys.
set -euo pipefail
for a in "$@"; do
  if [ "$a" = "--model" ]; then
    echo "[taskq-runner] direct-provider steps are not available on the box; queue tasks with --ladder free (or best,free)" >&2
    exit 3
  fi
done
HERE="$(cd "$(dirname "$0")" && pwd)"
exec "$HERE/lane-run" --lane "${LANE_RUN_LANE:-L5}" "$@"
