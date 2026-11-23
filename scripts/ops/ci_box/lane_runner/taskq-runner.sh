#!/usr/bin/env bash
# TASKQ_RUNNER for the box: taskq calls this like run_task.sh. It hands over to lane-run (gateway key, box-local
# state, budget caps, JSON log line). taskq only queues public tasks here, so --public is always set.
# Direct-provider ladder steps (--model ds-flash/strong) are refused: this box holds no provider keys.
set -euo pipefail
TIER_GIVEN=0
for a in "$@"; do
  if [ "$a" = "--tier" ]; then TIER_GIVEN=1; fi
  if [ "$a" = "--model" ]; then
    echo "[taskq-runner] direct-provider steps are not available on the box; set TASKQ_LADDER=light,free,paid (or pass --ladder) and see docs/ops/BOX_LANE_POLICY.md" >&2
    exit 3
  fi
done
# taskq's `free` step passes no --tier and means the strong free group; without this lane-run would use the config's
# TIER (light on a light-only box), so `free` would silently repeat `light`.
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$TIER_GIVEN" = 0 ]; then set -- "$@" --tier strong; fi
exec "$HERE/lane-run" --lane "${LANE_RUN_LANE:-L5}" "$@"
