# Local LLM fallback measurement (llama.cpp)

`scripts/llm_fallback_bench.py` measures whether a quantized local model served
by `llama-server` (or any OpenAI-compatible `/chat/completions` endpoint) is
usable as an **offline fallback for low-risk, non-customer-data tasks** before
anyone relies on it. It covers the `llama.cpp` fallback trial in the "Scale and
resilience" wave of `docs/research/NEXTGEN_ROADMAP_2026-10.md` and the posture
in `docs/research/nextgen/C_execution_delivery_substrate.md` §4.

## Hard rule: never send customer data

This endpoint is for **low-risk, non-customer-data** work only — local lint and
type-error explanations, template selection, test summarization and simple
Persian drafting. **Customer or case data must NEVER go through it**, for
quality and confidentiality reasons: a small quantized model is not an
acceptable substitute for the measured cloud models, and the local box has no
data-handling review. `config/models.yaml` remains the only place model ids are
defined; this endpoint is not part of the product routing.

## 1. Memory budget

The production host has about **15 GB RAM shared with all running services**. A
fallback model must therefore stay **under about 6 GB** total (weights plus KV
cache), leaving headroom for Postgres, Qdrant, Redis, nginx and the app. A raw
BF16 8B model exceeds that budget on its own; use a quantized GGUF (for example
`Q4_K_M`) and keep the context small. Measure the actual resident set with the
script's `--pid` flag instead of guessing.

## 2. Start the server

`llama.cpp` is MIT-licensed and publishes an OpenAI-compatible server. Build or
obtain a release binary from <https://github.com/ggml-org/llama.cpp> and
download a quantized GGUF model file to a local path.

```sh
# Do not commit model files. Keep them outside the repository.
llama-server \
    --model /path/to/model-Q4_K_M.gguf \
    --host 127.0.0.1 --port 8080 \
    --ctx-size 4096 --threads 4
```

The server exposes the OpenAI-compatible API at
`http://127.0.0.1:8080/v1`, so the benchmark needs no key. If a deployment
requires one, pass `--api-key-env NAME` — never hardcode or commit a key.

No `llama.cpp` release tag or model file hash is pinned in this document:
verify the current release and checksum from the upstream project and the model
publisher before pinning either in a deployment.

## 3. Run the benchmark

```sh
# Default 8 built-in prompts; JSON report plus a table.
python3 scripts/llm_fallback_bench.py \
    --base-url http://127.0.0.1:8080/v1 --model NAME

# Sample the server's RSS and write the full report.
python3 scripts/llm_fallback_bench.py \
    --base-url http://127.0.0.1:8080/v1 --model NAME \
    --pid "$(pgrep -f llama-server | head -1)" \
    --out /tmp/llm_fallback_result.json

# Re-run with a custom prompt set (JSON list of {id, messages, check, ...}).
python3 scripts/llm_fallback_bench.py \
    --base-url http://127.0.0.1:8080/v1 --model NAME --prompts /tmp/prompts.json
```

The built-in set is 4 Persian prompts (summarise a sentence, fix a Persian typo
list, classify intent into 5 labels, extract a date) and 4 English
coding/lint-explanation prompts. Each carries a trivial deterministic check: an
expected substring, or exactly the expected label out of an allowed set. A
failed request for a prompt that has a check counts as a failure, not as "not
run".

## 4. Read the result

```
id            lang ok        ms   tok   tok/s  check
fa-summarize  fa   yes     3120    38    12.2   pass
fa-intent     fa   yes      180     4    22.2   pass
...

n=8 failed=0 pass_rate=0.88 (7/8 checked)
latency_ms mean=1950 p50=1400 p95=3900 mean_tokens_per_sec=15.4
server_rss_mb=5100
```

- `pass_rate` — deterministic checks passed / prompts that had a check. It is
  `n/a` when every prompt lacks a check.
- `latency_ms` — end-to-end request latency (mean / p50 / p95) in ms.
- `mean_tokens_per_sec` — mean of per-prompt completion tokens / latency, over
  successful responses that report `usage.completion_tokens`.
- `server_rss_mb` — resident set of the `--pid` server at report time, from
  `/proc/<pid>/status` (Linux) or `ps -o rss=` (macOS/Linux fallback).

The JSON report (`--out`) keeps every per-prompt row (latency, tokens,
tokens/second, check result, response or error) for inspection of a specific
failure.

## 5. Promotion gate

Promoting the fallback is a measured decision: run this benchmark on the target
host, confirm the server stays **under ~6 GB RSS** while serving, and that the
pass rate is high enough for the non-customer tasks it is allowed to handle.
Record the result in the relevant PR before anyone wires the endpoint into an
automated lane. Do not run this in cron or CI; it is an owner-run decision, not
a monitor.
