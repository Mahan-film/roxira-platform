# Model routing decision — 2026-10-17

Input: the owner's FinOps report (October 2026) and a live check of every model id and price against
the OpenRouter catalogue on 2026-10-17. Config lives in `config/key_pool.yaml` and `config/models.yaml`.

## Decisions

| # | Traffic | Order | Why |
| --- | --- | --- | --- |
| 1 | Free users (Smart Judge chat), public agent work | Our own free keys first (4 Gemini AI Studio keys rotated per rank, Groq, SambaNova, Mistral), then OpenRouter `:free` (Nemotron 3 Ultra / Super / 3.5 Lightning, Gemma 4 31B), **never paid** | Each direct key has its own quota (4 Gemini keys = 4x), the direct models are stronger (Gemini 3.8 Flash), and they do not use up OpenRouter's shared `:free` cap (~1000 requests/day with ≥ $10 credit, 20/min). OpenRouter `:free` is the second pool, not the first. |
| 2 | Paid subscribers | Paid OpenRouter first, then the free ladder as a safety net | Quality is what they pay for, and the cost is small: Basic (Haiku 5.5) ≈ $0.001 per answer, Pro (DeepSeek V4 Pro) ≈ $0.002, Premium (Opus 5) ≈ $0.06 with an 8/day cap. The site never stops when credit runs out. |
| 3 | Factory agents | Free ladder (`best-all`) for public work → GLM-5.3 Flash → DeepSeek V4.1 Flash → strong model only for hard fixes | The cheapest paid workhorses that pass real tasks; free models alone fail multi-step tasks (measured 2026-10-15). |
| 4 | Caching | Static system prompt and instructions first, the user turn last; Anthropic `cache_control` on the system prefix; DeepSeek/GLM cache automatically | Cache reads are 90–98% cheaper. |
| 5 | Anthropic hidden reasoning | Off in product tiers | Live test: it used the whole `max_tokens` and returned empty answers (#729). |

## Not adopted now (and why)

- **Decisions API micro-models** (respan/span-02, pplx-decider, liquid/d1, typesafe/jev): not in the OpenRouter catalogue on 2026-10-17. Re-check monthly with `python3 scripts/check_models.py`; a good first use would be the chat difficulty router and the PII check.
- **`data_collection: deny` / ZDR for Google**: the owner allows free tiers that may log or train (all current customers are test accounts). Revisit before real customers with confidential data (AGENTS.md §4).
- **`:batch` slugs**: our background volume is small; batch is cheaper only for large asynchronous jobs.

## Next (small, when needed)

- `summarize-cheap` (scaledown/summarize, $0 output) in front of paid models for long uploaded case files (> 30k tokens). The group exists; the app is not wired yet.
- Heavy nightly jobs (ingestion, evals) inside DeepSeek's off-peak window (from 04:00 UTC = 07:30 Tehran, 50% off on DeepSeek's own host).
- `poolside/laguna-s-2.1:free` is deprecated on 2026-10-31: replaced by `nvidia/nemotron-3.5-lightning:free` today.

Owner rule recap: free users only free models; subscribers paid models; nothing stops when OpenRouter credit runs out.
