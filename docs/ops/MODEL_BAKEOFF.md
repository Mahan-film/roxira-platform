# Model bake-off (owner-run)

Compares candidate models for the executor/reviewer/strong roles on the synthetic
legal set `data/eval/legal_rag_eval.jsonl` (30 questions). Pass = answer names the
expected law and cites the expected article; citation validity = article cited.
Scoring reuses `_law_name_matches` / `_article_in_text` from `scripts/eval_legal_rag.py`.

Candidates live in `config/bakeoff_candidates.json`. All ids are PLACEHOLDERS
(`verified: false`). Fix ids/prices, then flip `verified`.

Safety: only files under `data/eval/` are read or sent; the key comes from
`OPENROUTER_API_KEY` and is never printed; a case with `"sensitive": true` is
never sent to a `:free` id; JSON results go to `~/.local/state/roxira/`, never the repo.

## Commands

```bash
export OPENROUTER_API_KEY=...            # your key, not stored anywhere
python3 scripts/dev/model_bakeoff.py --list-verify          # which ids exist live
python3 scripts/dev/model_bakeoff.py --dry-run              # plan + cost estimate, no network
python3 scripts/dev/model_bakeoff.py --limit 5 --max-usd 0.10   # tiny smoke run
python3 scripts/dev/model_bakeoff.py --max-usd 0.50         # full run (default cap $0.50)
python3 scripts/dev/model_bakeoff.py --models deepseek/deepseek-v4.1-flash,openai/gpt-oss-120b
```

Output: `docs/research/BAKEOFF_<date>.md` plus
`~/.local/state/roxira/bakeoff_<date>.json`. Concurrency 2, 2 retries with backoff.
The budget cap uses worst-case reservations then actual token usage; remaining
calls are skipped (`budget_stopped`) once the cap would be exceeded.
Baseline for comparison: `deepseek/deepseek-v4.1-flash`.
