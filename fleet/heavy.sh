#!/usr/bin/env bash
# Run a heavy command (jest, tsc, npm ci, playwright, local CI) in one of N shared slots.
# Usage: heavy.sh <cmd...>. Slots: HEAVY_SLOTS (default 2 when WSL has >= 4.5 GB RAM, else 1).
D=/home/mahan/Developer/roxira-wt/_fleet
mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)
def=1; [ "$mem_kb" -ge 4500000 ] && def=2
n=${HEAVY_SLOTS:-$def}
while :; do
  for i in $(seq 1 "$n"); do
    lock="$D/heavy.lock"; [ "$i" -gt 1 ] && lock="$D/heavy$i.lock"
    exec 9>"$lock"
    if flock -n 9; then exec "$@"; fi
    exec 9>&-
  done
  sleep 5
done
