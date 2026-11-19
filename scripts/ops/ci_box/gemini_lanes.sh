#!/bin/bash
# gemini_lanes.sh start|stop|status|attach|prompts
# Fallback builders for lanes L5-L7 on roxira-ci (user mahanfilms): one tmux session "lanes"
# with windows L5, L6, L7, each running Gemini CLI (auto-approve) in ~/roxira-platform with
# its lane prompt. Use only when the Antigravity quota runs out; nothing starts it automatically.
#
# When gemini exits, the window waits 10 min and restarts it, at most 6 restarts per lane per day.
# Traffic must go through the box proxy: a lane refuses to run when HTTPS_PROXY is unset.
# Optional: GEMINI_LANES_MODEL=<id> passes -m <id> (the free tier's default model allows
# about 20 requests a day; see docs/ops/LINUX_CI_BOX.md).
set -euo pipefail

SESSION=lanes
LANES=(L5 L6 L7)
REPO="${GEMINI_LANES_REPO:-$HOME/roxira-platform}"
STATE="${GEMINI_LANES_STATE:-$HOME/.local/state/gemini-lanes}"
MAX_RESTARTS=6
RESTART_WAIT="${GEMINI_LANES_WAIT:-600}"
SELF="$(readlink -f "$0")"

port_for() { case "$1" in L5) echo 55605 ;; L6) echo 55606 ;; L7) echo 55607 ;; *) return 1 ;; esac; }

gen_prompt() { # $1 = lane; writes $STATE/prompts/<lane>.txt from docs/antigravity/prompts/<lane>.txt
  local lane=$1 src="$REPO/docs/antigravity/prompts/$1.txt" out="$STATE/prompts/$1.txt"
  [ -f "$src" ] || { echo "missing $src" >&2; return 1; }
  mkdir -p "$STATE/prompts"
  {
    echo "You run in Gemini CLI on roxira-ci as mahanfilms. Never print env, keys or .env files. Never touch nftables, ufw, xray, sudoers or proxy settings. FRESH_DB_PORT: L5 55605, L6 55606, L7 55607."
    echo "You are lane $lane: use FRESH_DB_PORT=$(port_for "$lane")."
    echo
    sed -e 's/--agent antigravity/--agent gemini/g' -e 's#[[:space:]]*/boost##g' "$src"
  } > "$out"
  echo "$out"
}

run_lane() { # runs inside a tmux window; loops with restart limits
  local lane=$1 day count file prompt
  port_for "$lane" >/dev/null || { echo "unknown lane $lane" >&2; exit 2; }
  if [ -z "${HTTPS_PROXY:-}" ]; then
    echo "$lane: HTTPS_PROXY is not set; refusing to run without the box proxy." >&2
    exec sleep infinity
  fi
  export FRESH_DB_PORT
  FRESH_DB_PORT=$(port_for "$lane")
  local model_args=()
  [ -n "${GEMINI_LANES_MODEL:-}" ] && model_args=(-m "$GEMINI_LANES_MODEL")
  while :; do
    prompt=$(cat "$(gen_prompt "$lane")")
    cd "$REPO"
    echo "[$(date -Is)] $lane: starting gemini"
    gemini --approval-mode yolo "${model_args[@]}" -i "$prompt" || true
    day=$(date +%F); file="$STATE/restarts-$lane-$day"
    count=$(cat "$file" 2>/dev/null || echo 0)
    if [ "$count" -ge "$MAX_RESTARTS" ]; then
      echo "[$(date -Is)] $lane: gemini exited; $MAX_RESTARTS restarts already used today. Stopping this lane."
      exec sleep infinity
    fi
    echo $((count + 1)) > "$file"
    echo "[$(date -Is)] $lane: gemini exited; restart $((count + 1))/$MAX_RESTARTS in $((RESTART_WAIT / 60)) min."
    sleep "$RESTART_WAIT"
  done
}

case "${1:-status}" in
  start)
    command -v gemini >/dev/null || { echo "gemini CLI not found" >&2; exit 1; }
    [ -n "${HTTPS_PROXY:-}" ] || { echo "HTTPS_PROXY is not set; start from a login shell (box proxy)." >&2; exit 1; }
    if tmux has-session -t "$SESSION" 2>/dev/null; then echo "session '$SESSION' already running"; exit 0; fi
    mkdir -p "$STATE"
    for lane in "${LANES[@]}"; do gen_prompt "$lane" >/dev/null; done
    tmux new-session -d -s "$SESSION" -n L5 -c "$REPO" "$SELF _run L5"
    tmux new-window -t "$SESSION" -n L6 -c "$REPO" "$SELF _run L6"
    tmux new-window -t "$SESSION" -n L7 -c "$REPO" "$SELF _run L7"
    echo "started tmux session '$SESSION' (L5 L6 L7); attach with: $0 attach"
    ;;
  stop)
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "stopped" || echo "not running"
    ;;
  status)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux list-windows -t "$SESSION" -F '#{window_name}: #{pane_current_command}'
    else
      echo "not running"
    fi
    for lane in "${LANES[@]}"; do
      echo "$lane restarts today: $(cat "$STATE/restarts-$lane-$(date +%F)" 2>/dev/null || echo 0)/$MAX_RESTARTS"
    done
    ;;
  attach)
    exec tmux attach -t "$SESSION"
    ;;
  prompts)
    for lane in "${LANES[@]}"; do gen_prompt "$lane"; done
    ;;
  _run)
    run_lane "${2:?lane}"
    ;;
  *)
    echo "usage: $0 start|stop|status|attach|prompts" >&2; exit 2
    ;;
esac
