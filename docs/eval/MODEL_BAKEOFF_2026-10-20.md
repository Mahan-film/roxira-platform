# Model bake-off 2026-10-20

Generated 2026-10-20T19:43:55+00:00 by `scripts/eval/model_bakeoff.py`. Raw answers: `/var/lib/roxira-eval/bakeoff/results_full-2026-10-20.jsonl`.

Questions: 40 (30 legal from the golden data, 6 small talk, 4 out of scope). Legal reference points are the golden `must_include` phrases; the second tax item and the small-talk / out-of-scope items have none.
Model-only prompt: production prompt_library.build_system_prompt + chat_fast.context_lines (top_k=4, 500 chars). Same retrieved context for every model (retrieval via the app's `/query`, cached).
LLM judge: `vip-pro`, rubric 1-5.

Quality (0-100) per question: judge 0.40 (when run), key-point coverage 0.25, citation validity 0.20, small-talk/out-of-scope handling 0.30 (for those kinds), Persian-only 0.05, weights renormalised over what exists; -25 for a forbidden phrase or a wrong refusal. Errors, empty answers and answers served by a different model than asked (gateway fallback) score 0 and are counted in `bad%`.

Caveats: golden `needs_lawyer` items are excluded; key-point coverage is a literal phrase match, so a correct paraphrase can miss. Citation validity = share of cited articles/rulings the app's own citation guard accepts (catalogue + Qdrant), `n/a` when an answer cites nothing. Free tiers rate-limit: a model at `bad%` > 20 may be quota, not quality, so rerun before demoting it.

## Tier free (`best-product-free`)

| rank pos | gateway group | model | n | quality | judge | coverage % | cite valid % (n) | bad % (err/empty/fallback) | p50 s | p95 s | TTFT p50 s | cost / 100 answers USD | halluc. | ungrounded | Persian % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `best-product-free` | gemini-3.8-flash | 40 | 4.6 | 2.00 | 0.0 | n/a (0) | 90.0 (78/0/12) | 14.6 | 37.9 | 12.54 | 0.0000 | 0 | 0 | 100 |
| 2 | `best-product-free__r2` | gemini-3.7-flash | 40 | 1.1 | 3.69 | 0.0 | n/a (0) | 92.5 (45/0/48) | 36.5 | 46.3 | 33.91 | 0.0000 | 0 | 0 | 100 |
| 3 | `best-product-free__r3` | openai/gpt-oss-120b | 40 | 39.6 | 2.65 | 5.2 | n/a (0) | 0.0 (0/0/0) | 1.0 | 1.8 | 0.34 | 0.0000 | 0 | 1 | 100 |
| 4 | `best-product-free__r4` | gemini-3.6-flash | 40 | 5.5 | 3.16 | 50.0 | n/a (0) | 92.5 (0/0/92) | 6.6 | 7.4 | 3.49 | 0.0000 | 0 | 0 | 95 |
| 5 | `best-product-free__r5` | mistral-medium-latest | 40 | 0.0 | 2.93 | n/a | n/a (0) | 100.0 (2/0/98) | n/a | n/a | n/a | n/a | 0 | 0 | 97 |
| 6 | `best-product-free__r6` | gemini-3.5-flash | 40 | 8.9 | 2.74 | 0.0 | n/a (0) | 82.5 (0/0/82) | 7.8 | 15.3 | 5.80 | 0.0000 | 0 | 0 | 100 |
| 7 | `best-product-free__r7` | gemini-3-flash-preview | 40 | 18.7 | 2.48 | 13.3 | n/a (0) | 50.0 (0/0/50) | 7.6 | 13.4 | 5.33 | 0.0000 | 0 | 1 | 95 |
| 8 | `best-product-free__r8` | gemma-4-31b-it | 40 | 13.8 | 2.75 | 0.0 | n/a (0) | 62.5 (12/0/50) | 45.5 | 57.0 | 39.89 | 0.0000 | 0 | 1 | 97 |
| 9 | `best-product-free__r9` | nvidia/nemotron-3-ultra-550b-a55b:free | 40 | 45.9 | 2.72 | 8.6 | n/a (0) | 0.0 (0/0/0) | 7.6 | 23.3 | 3.29 | 0.0000 | 0 | 0 | 92 |
| 10 | `best-product-free__r10` | nvidia/nemotron-3-super-120b-a12b:free | 40 | 0.0 | 2.29 | n/a | n/a (0) | 100.0 (5/0/95) | n/a | n/a | n/a | n/a | 0 | 0 | 97 |
| 11 | `best-product-free__r11` | google/gemma-4-31b-it:free | 40 | 0.0 | 2.52 | n/a | n/a (0) | 100.0 (2/0/98) | n/a | n/a | n/a | n/a | 0 | 0 | 100 |
| 12 | `best-product-free__r12` | gemini-3.5-flash-lite | 40 | 37.3 | 2.62 | 12.1 | n/a (0) | 0.0 (0/0/0) | 14.6 | 28.4 | 13.71 | 0.0000 | 0 | 0 | 100 |

Recommended order for `best-product-free` (best first):

1. `nvidia/nemotron-3-ultra-550b-a55b:free` (openrouter-free, now rank 11) quality 45.9, p50 7.6 s, cost/100 0.0000 USD
2. `openai/gpt-oss-120b` (groq, now rank 5) quality 39.6, p50 1.0 s, cost/100 0.0000 USD
3. `gemini-3.5-flash-lite` (gemini, now rank 14) quality 37.3, p50 14.6 s, cost/100 0.0000 USD
4. `gemini-3-flash-preview` (gemini, now rank 9) quality 18.7, p50 7.6 s, cost/100 0.0000 USD (demoted: unreliable in this run)
5. `gemma-4-31b-it` (gemini, now rank 10) quality 13.8, p50 45.5 s, cost/100 0.0000 USD (demoted: unreliable in this run)
6. `gemini-3.5-flash` (gemini, now rank 8) quality 8.9, p50 7.8 s, cost/100 0.0000 USD (demoted: unreliable in this run)
7. `gemini-3.6-flash` (gemini, now rank 6) quality 5.5, p50 6.6 s, cost/100 0.0000 USD (demoted: unreliable in this run)
8. `gemini-3.8-flash` (gemini, now rank 3) quality 4.6, p50 14.6 s, cost/100 0.0000 USD (demoted: unreliable in this run)
9. `gemini-3.7-flash` (gemini, now rank 4) quality 1.1, p50 36.5 s, cost/100 0.0000 USD (demoted: unreliable in this run)
10. `mistral-medium-latest` (mistral, now rank 7) quality 0.0, p50 n/a s, cost/100 n/a USD (demoted: unreliable in this run)
11. `nvidia/nemotron-3-super-120b-a12b:free` (openrouter-free, now rank 12) quality 0.0, p50 n/a s, cost/100 n/a USD (demoted: unreliable in this run)
12. `google/gemma-4-31b-it:free` (openrouter-free, now rank 13) quality 0.0, p50 n/a s, cost/100 n/a USD (demoted: unreliable in this run)

In `config/key_pool.yaml` terms, give these models these `rank:` values (the slots this group already uses, best model first): `nvidia/nemotron-3-ultra-550b-a55b:free` -> rank 3, `openai/gpt-oss-120b` -> rank 4, `gemini-3.5-flash-lite` -> rank 5, `gemini-3-flash-preview` -> rank 6, `gemma-4-31b-it` -> rank 7, `gemini-3.5-flash` -> rank 8, `gemini-3.6-flash` -> rank 9, `gemini-3.8-flash` -> rank 10, `gemini-3.7-flash` -> rank 11, `mistral-medium-latest` -> rank 12, `nvidia/nemotron-3-super-120b-a12b:free` -> rank 13, `google/gemma-4-31b-it:free` -> rank 14.

## Tier basic (`vip-product`)

| rank pos | gateway group | model | n | quality | judge | coverage % | cite valid % (n) | bad % (err/empty/fallback) | p50 s | p95 s | TTFT p50 s | cost / 100 answers USD | halluc. | ungrounded | Persian % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `vip-product` | anthropic/claude-haiku-5.5 | 40 | 47.1 | 2.90 | 17.2 | n/a (0) | 0.0 (0/0/0) | 4.6 | 6.5 | 1.09 | 0.0458 | 0 | 1 | 98 |
| 2 | `vip-product__r2` | deepseek/deepseek-v4.1-flash | 40 | 27.6 | 2.41 | 17.5 | n/a (0) | 22.5 (0/22/0) | 34.8 | 50.2 | 16.35 | 0.0487 | 0 | 0 | 100 |

Recommended order for `vip-product` (best first):

1. `anthropic/claude-haiku-5.5` (openrouter-private, now rank 1) quality 47.1, p50 4.6 s, cost/100 0.0458 USD
2. `deepseek/deepseek-v4.1-flash` (openrouter-private, now rank 2) quality 27.6, p50 34.8 s, cost/100 0.0487 USD (demoted: unreliable in this run)

In `config/key_pool.yaml` terms, give these models these `rank:` values (the slots this group already uses, best model first): `anthropic/claude-haiku-5.5` -> rank 1, `deepseek/deepseek-v4.1-flash` -> rank 2.

Note: `vip-product` falls back to the groups below it when a paid model fails; a candidate with fallback% > 0 was partly answered by another model.

## Tier pro (`vip-pro`)

| rank pos | gateway group | model | n | quality | judge | coverage % | cite valid % (n) | bad % (err/empty/fallback) | p50 s | p95 s | TTFT p50 s | cost / 100 answers USD | halluc. | ungrounded | Persian % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `vip-pro` | deepseek/deepseek-v4-pro | 40 | 42.7 | 3.12 | 22.0 | n/a (0) | 10.0 (2/8/0) | 13.2 | 35.0 | 5.17 | 0.0696 | 0 | 3 | 97 |
| 2 | `vip-pro__r2` | anthropic/claude-haiku-5.5 | 40 | 48.8 | 3.28 | 13.8 | n/a (0) | 0.0 (0/0/0) | 4.6 | 6.0 | 0.89 | 0.0456 | 0 | 1 | 95 |
| 3 | `vip-pro__r3` | z-ai/glm-5.3 | 40 | 40.5 | 2.79 | 18.2 | n/a (0) | 17.5 (0/18/0) | 7.2 | 25.2 | 1.19 | 0.3997 | 0 | 1 | 100 |

Recommended order for `vip-pro` (best first):

1. `anthropic/claude-haiku-5.5` (openrouter-private, now rank 2) quality 48.8, p50 4.6 s, cost/100 0.0456 USD
2. `deepseek/deepseek-v4-pro` (openrouter-private, now rank 1) quality 42.7, p50 13.2 s, cost/100 0.0696 USD
3. `z-ai/glm-5.3` (openrouter-private, now rank 3) quality 40.5, p50 7.2 s, cost/100 0.3997 USD

In `config/key_pool.yaml` terms, give these models these `rank:` values (the slots this group already uses, best model first): `anthropic/claude-haiku-5.5` -> rank 1, `deepseek/deepseek-v4-pro` -> rank 2, `z-ai/glm-5.3` -> rank 3.

Note: `vip-pro` falls back to the groups below it when a paid model fails; a candidate with fallback% > 0 was partly answered by another model.

## Tier premium (`vip-premium`)

| rank pos | gateway group | model | n | quality | judge | coverage % | cite valid % (n) | bad % (err/empty/fallback) | p50 s | p95 s | TTFT p50 s | cost / 100 answers USD | halluc. | ungrounded | Persian % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `vip-premium` | anthropic/claude-opus-5 | 40 | 39.9 | 2.56 | 20.7 | n/a (0) | 0.0 (0/0/0) | 30.3 | 34.5 | 1.45 | 3.6681 | 0 | 1 | 100 |
| 2 | `vip-premium__r2` | moonshotai/kimi-k3 | 40 | 41.7 | 3.21 | 18.8 | n/a (0) | 15.0 (0/15/0) | 21.1 | 46.4 | 14.77 | 0.8849 | 0 | 1 | 94 |

Recommended order for `vip-premium` (best first):

1. `moonshotai/kimi-k3` (openrouter-private, now rank 2) quality 41.7, p50 21.1 s, cost/100 0.8849 USD
2. `anthropic/claude-opus-5` (openrouter-private, now rank 1) quality 39.9, p50 30.3 s, cost/100 3.6681 USD

In `config/key_pool.yaml` terms, give these models these `rank:` values (the slots this group already uses, best model first): `moonshotai/kimi-k3` -> rank 1, `anthropic/claude-opus-5` -> rank 2.

Note: `vip-premium` falls back to the groups below it when a paid model fails; a candidate with fallback% > 0 was partly answered by another model.

## Reading the numbers

- `rank pos` is the position of the gateway group (1 = bare group name, N = `__rN`); `now rank` is the `rank:` value in config/key_pool.yaml.
- `bad%` includes answers where the served model differs from the requested one (gateway fallback). If a model shows 100% fallback the id comparison, not the model, is probably the problem (see `served_model` in the JSONL).
- Cost uses the gateway's `x-litellm-response-cost` header when present, else tokens x config/models.yaml prices; free tiers are 0.
- Treat differences under ~5 quality points as noise at this sample size (40 questions per model).
