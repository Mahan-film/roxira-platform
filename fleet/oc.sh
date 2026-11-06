#!/usr/bin/env bash
# oc.sh <worktree> <brief.md> -- run one brief through OpenCode. Never commits or pushes; Claude reviews the diff.
# Ladder: srv1 gateway first (ssh tunnel 127.0.0.1:4181, stable IP, docs/ops/TWO_COMPUTERS.md); direct providers are the last fallback: free first (Groq, OpenRouter :free, SambaNova, Gemini, Mistral), then cheap (DeepSeek Flash).
# OPENROUTER_API_KEY has a ZDR guardrail that blocks :free models; OPENROUTER_API_KEY_AGENTS does not. Groq and Gemini depend on the egress IP.
# Each rung gets a 1-call preflight, so a 429/403/402 moves on at once.
# OpenCode runs in a clean environment holding ONLY the key of its rung; prod secrets never reach it.
# Free tiers may log prompts: public repo code only, never customer data.
set -uo pipefail
WT="$1"; BRIEF="$2"; D=/home/mahan/Developer/roxira-wt/_fleet; TMO="${OC_TIMEOUT:-1200}"
set -a; . "$HOME/Secrets/roxira/roxira.env"; set +a
# Gateway rungs are skipped until this file exists (empty key).
GWF="$HOME/Secrets/roxira/llm-gateway.env"; if [ -f "$GWF" ]; then set -a; . "$GWF"; set +a; fi
GW=http://127.0.0.1:4181/v1/chat/completions
CFG='{"provider":{"pool":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://127.0.0.1:4181/v1","apiKey":"{env:LLM_GATEWAY_KEY}"},"models":{"agent-strong-free":{},"agent-light-free":{},"agent-free-paid":{}}}},"enabled_providers":["pool","groq","sambanova","openrouter","mistral","google","cloudflare-workers-ai","opencode"],"permission":{"external_directory":"deny"}}'
OR=https://openrouter.ai/api/v1/chat/completions; G=https://api.groq.com/openai/v1/chat/completions
S=https://api.sambanova.ai/v1/chat/completions; M=https://api.mistral.ai/v1/chat/completions; CF="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID:-none}/ai/v1/chat/completions"; GM=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
# rung = opencode-model | env-var | endpoint | native model (order: slot offset rotates the Groq keys)
n=$(( ${OC_SLOT:-0} % 3 )); GK=(GROQ_API_KEY GROQ_API_KEY_2 GROQ_API_KEY_3); GK=("${GK[@]:$n}" "${GK[@]:0:$n}")
RUNGS=()
for m in agent-strong-free agent-free-paid; do RUNGS+=("pool/$m|LLM_GATEWAY_KEY|$GW|$m"); done
for m in cohere/north-mini-code:free nvidia/nemotron-3-ultra-550b-a55b:free recursive/flint-v1.0:free nvidia/nemotron-3.5-lightning:free; do RUNGS+=("openrouter/$m|OPENROUTER_API_KEY_AGENTS|$OR|$m"); done
RUNGS+=("sambanova/gpt-oss-120b|SAMBANOVA_API_KEY|$S|gpt-oss-120b")
for m in @cf/moonshotai/kimi-k2.7-code @cf/zai-org/glm-5.3-flash; do RUNGS+=("cloudflare-workers-ai/$m|CF_AI_TOKEN|$CF|$m"); done
# Groq free tier allows 8000 tokens/min; one OpenCode request on this repo asks for about 15000, so it comes after the roomier free models.
for k in "${GK[@]}"; do RUNGS+=("groq/openai/gpt-oss-120b|$k|$G|openai/gpt-oss-120b"); done
for k in GEMINI_API_KEY GEMINI_API_KEY_2 GEMINI_API_KEY_3 GEMINI_API_KEY_4; do RUNGS+=("google/gemini-flash-latest|$k|$GM|gemini-flash-latest"); done
for k in MISTRAL_API_KEY MISTRAL_API_KEY_2 MISTRAL_API_KEY_3 MISTRAL_API_KEY_4; do RUNGS+=("mistral/mistral-medium-latest|$k|$M|mistral-medium-latest"); done
RUNGS+=("openrouter/deepseek/deepseek-v4.1-flash|OPENROUTER_API_KEY_AGENTS|$OR|deepseek/deepseek-v4.1-flash")
# OC_FIRST=<pattern>: try matching rungs first, for tasks the weaker free models keep failing.
# Default order since 2026-11-06 (owner: use the keys): DeepSeek Flash first. It finished 10 of 10 runs here at about $0.05/$0.57 per million;
# the free rungs failed about 40% and waste supervising tokens. OC_FIRST=- restores the plain ladder.
OC_FIRST="${OC_FIRST:-deepseek}"; [ "$OC_FIRST" = "-" ] && OC_FIRST=""
if [ -n "${OC_FIRST:-}" ]; then
  A=(); B=(); for r in "${RUNGS[@]}"; do if [[ "$r" == *$OC_FIRST* ]]; then A+=("$r"); else B+=("$r"); fi; done; RUNGS=("${A[@]}" "${B[@]}")
fi
# Provider access follows the VPN exit IP, which can change. Retry the whole ladder before giving up.
for round in $(seq 1 "${OC_ROUNDS:-60}"); do
  for r in "${RUNGS[@]}"; do
    IFS='|' read -r om kv url nm <<<"$r"; key="${!kv:-}"; [ -n "$key" ] || continue
    code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$url" -H "Authorization: Bearer $key" -H 'content-type: application/json' -H 'User-Agent: roxira-keypool/1.0' -d "{\"model\":\"$nm\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"max_tokens\":5}")
    [ "$code" = 200 ] || { [ "${round:-1}" = 1 ] && echo "skip $om ($kv) http=$code" >&2; continue; }
    case "$om" in pool/*) ev=LLM_GATEWAY_KEY;; groq/*) ev=GROQ_API_KEY;; sambanova/*) ev=SAMBANOVA_API_KEY;; openrouter/*) ev=OPENROUTER_API_KEY;; mistral/*) ev=MISTRAL_API_KEY;; google/*) ev=GOOGLE_GENERATIVE_AI_API_KEY;; cloudflare-workers-ai/*) ev=CLOUDFLARE_API_KEY;; esac
    echo "run $om ($kv)" >&2
    env -i HOME="$HOME" PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" TMPDIR="${TMPDIR:-/tmp}" TERM=dumb LANG=C.UTF-8 ROXIRA_ENV_FILE=/dev/null LLM_GATEWAY_ENV_FILE=/dev/null CLOUDFLARE_ACCOUNT_ID="${CF_ACCOUNT_ID:-}" OPENCODE_CONFIG_CONTENT="${CFG%\}},\"small_model\":\"$om\"}" "$ev=$key" \
      "$D/dispatch_opencode.sh" -w "$WT" -F "$BRIEF" -m "$om" --public -t "$TMO" -o "$D/logs" > "$D/logs/last-$(basename "$BRIEF").diff" </dev/null; rc=$?
      # opencode can exit 0 after a provider error or a cut-off turn: the log decides, not the exit code.
    lg=$(ls -t "$D/logs/$(basename "$WT")"-*.log 2>/dev/null | head -1)
    if [ $rc -eq 0 ] && tail -c 2500 "$lg" | grep -qE 'Error: |Request too large|<\|end\|>|<\|call\|>'; then echo "provider error or cut-off turn in $lg" >&2; rc=9; fi
    [ $rc -eq 0 ] && { echo "OK model=$om key=$kv"; exit 0; }
    echo "failed $om rc=$rc" >&2
  done
  [ "$round" = 1 ] && echo "no rung available, retrying every 3 min" >&2
  sleep 180
done
echo "all rungs failed" >&2; exit 3
