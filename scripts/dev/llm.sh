#!/usr/bin/env bash
# llm.sh "prompt" [-g GROUP]   free-first LLM call via the key pool (gateway if AGENT_GATEWAY_URL is set, else direct).
# Thin wrapper around scripts/dev/llm_pool.py; see its --help. Groups: agent-free (default), private.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then P="$1"; shift; exec python3 "$HERE/llm_pool.py" -p "$P" "$@"; fi
exec python3 "$HERE/llm_pool.py" "$@"
