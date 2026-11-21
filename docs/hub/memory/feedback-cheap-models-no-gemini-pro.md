---
name: feedback-cheap-models-no-gemini-pro
description: "Model priority for any LLM call I make or configure: free first, then DeepSeek V4.1 Flash; Gemini Flash only if essential; NEVER Gemini Pro"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-09T23:46:35.708Z
---

Priority for every LLM call the hub makes or configures (reviews, agents via OpenRouter/OpenCode, scripts): 1) `:free` models (only for non-sensitive input such as public-repo code diffs — never customer/case data), 2) DeepSeek V4.1 Flash, 3) other cheap models. Gemini only when essential and then only Gemini Flash. **Never use Gemini Pro** (any version).

**Why:** On 2026-10-09 my PR reviews via `~google/gemini-pro-latest` cost $3.90 in one evening, exhausted the shared $3/day OpenRouter key and took production chat down. Owner had asked repeatedly for cheap/efficient models and was angry.

**How to apply:** Before any OpenRouter call, pick the model from this order and state the expected cost; never use `~google/gemini-pro-latest` or `*gemini*-pro*`. Use a dev key, never the prod key. Related: [[project-keys-and-local-infra]], [[feedback-cheap-execution-only]].

**Update 2026-10-16 (owner):** on FREE AI Studio keys (no billing) Gemini Pro/argon are allowed and should lead a quality-first ladder (gemini-best group); the 'never Gemini Pro' rule is about paid spend.
