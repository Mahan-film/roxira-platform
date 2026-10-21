# Answer-quality plan — retrieval + prompt (2026-10-21)

Source: [MODEL_BAKEOFF_2026-10-20.md](MODEL_BAKEOFF_2026-10-20.md). Every model scored 40–49/100 and
key-point coverage was 13–22 %, while citation validity was `n/a` (0 citations) and Persian-only was
≥ 92 %. A model that never cites and misses the must-include phrases is not losing points on language or
reasoning; it is not being given the right article to cite. **The bottleneck is retrieval + prompt, not
the model.** This plan lists concrete, testable changes ranked by expected gain / cost; each names the
exact code location and how to measure it with `scripts/eval/legal_gate.py retrieval` (retrieval@k, **$0**,
no LLM, no network beyond Qdrant + the query embedder).

## How to measure (no model calls)

Run on the server (Qdrant + `BAAI/bge-m3` embedder available), from the repo root:

    # baseline (flags OFF = production):
    python3 scripts/eval/legal_gate.py retrieval --json-out /tmp/lg_before.json
    # store it once so later runs can be diffed:
    python3 scripts/eval/legal_gate.py retrieval | python3 scripts/eval/legal_gate.py capture \
        --out data/eval/chat_golden/legal_gate_baseline.json

    # candidate (one flag ON):
    SMARTJUDGE_MUSTCITE_BOOST=1 python3 scripts/eval/legal_gate.py retrieval --json-out /tmp/lg_after.json
    python3 scripts/eval/legal_gate.py compare --baseline /tmp/lg_before.json --current /tmp/lg_after.json

`retrieval` reuses the chat retrieval path (`lightrag_engine.qdrant_fallback_laws` + `source_filter`)
and reports **recall@{1,3,5,10}** with a raw (pre-filter) figure, split into `dev` / `held_out`, plus a
`by_category` / `by_law` breakdown (`scripts/eval/legal_gate.py:175` `run_retrieval`, `:196`
`retrieval_report`). `compare` warns when retrieval@5 drops more than `--warn-drop` points. Because the
same code path serves chat, a recall@5 gain here is a real gain for the product.

Why retrieval@k is the right cheap proxy: the bake-off fed every model the *same* context
(`prompt_library.build_system_prompt` + `chat_fast.context_lines`, top_k=4, 500 chars) and key-point
coverage is 13–22 % — exactly the share of questions whose must-cite article was in the retrieved top-k.
Moving the correct article into the seeded context is necessary (not sufficient) for coverage, and it is
measurable for free.

---

## Ranked changes

| # | Change | Expected gain | Cost | Measurable at retrieval@k | Status |
|---|--------|---------------|------|---------------------------|--------|
| 1 | must-cite boost: article/law named in the question ranks first | high | low | yes (@1/@5) | **implemented, flag OFF** |
| 2 | query rewrite for Persian legal terms | med-high | low | yes (@3/@5) | **implemented, flag OFF** |
| 3 | grow the topic→article keyword map | medium | low | yes | planned |
| 4 | context budget: `CHAT_CTX_TOPK` 4→8, `CHAT_CTX_CHARS` 600→900 | medium | low | proxy (see below) | planned |
| 5 | must-cite first in the prompt context (`context_lines`) | medium | low | proxy | planned |
| 6 | answer structure in the prompt | low-med | low | no ($0); needs `answer` mode / judge | planned |

### 1. must-cite boost — article/law named in the question first (IMPLEMENTED, OFF)

- What: the bake-off questions that name a law or article (e.g. «مهلت تجدیدنظرخواهی ماده ۳۳۶») rely on
  the vector ranking, which prefers lexical/embedding neighbours and can push the exact provision past
  position 5. `exact_article_lookup` only fires for an explicit «ماده N» *and* a recognized law name
  (`lightrag_engine.py:1249`); when the question names a law without a number, nothing boosts it.
- Where:
  - `output_apps/generated_modules/smartjudge/legal_graph/retrieval_boost.py` — flag
    `MUSTCITE_BOOST_ENV = "SMARTJUDGE_MUSTCITE_BOOST"`, `MUSTCITE_WEIGHT`, `mustcite_boost_enabled()`
    (`:142-158`).
  - `output_apps/generated_modules/smartjudge/legal_graph/lightrag_engine.py` — `_mustcite_keys()`
    (`:483`) and the fusion in `_rank_payloads()` (`:517`).
- How it works: the named article (then the other articles of a named law) is added as a third ranking to
  the existing RRF (`vector×1.0`, `lexical×0.5`, `must-cite×2.0`), so a correct-but-lower-ranked
  provision wins within the ~20 vector candidates. Pure reordering of already-retrieved rows: no new
  I/O, no extra Qdrant query, no latency.
- Flag: `SMARTJUDGE_MUSTCITE_BOOST=1` (default OFF; unset/repeated-invalid → production path unchanged).
- Measure: `SMARTJUDGE_MUSTCITE_BOOST=1 … legal_gate.py retrieval` → recall@1/@5; expect the biggest move
  on `by_law`/`by_category` groups whose questions name a law. Watch the raw-vs-kept columns: a rise only
  in `raw` but not `kept` means `source_filter` now drops the boosted row (then revisit
  `SMARTJUDGE_MIN_SOURCE_SCORE`, `retrieval_boost.is_relevant`).

### 2. query rewrite for Persian legal terms (IMPLEMENTED, OFF)

- What: users write colloquial/compound forms («تجدیدنظرخواهی», «چک برگشتی», «مهریه») while the corpus
  text uses the canonical term («تجدیدنظر», «صدور چک», «مهر»). Both the embedding and the lexical
  tie-breaker then miss the article.
- Where:
  - `output_apps/generated_modules/smartjudge/legal_graph/retrieval_boost.py` — `LEGAL_TERM_EXPANSIONS`,
    `rewrite_query()` (`:174`), flag `QUERY_REWRITE_ENV = "SMARTJUDGE_QUERY_REWRITE"` (`:141`).
  - `output_apps/generated_modules/smartjudge/legal_graph/lightrag_engine.py:1387` — the vector/keyword
    branches use `search_text = rewrite_query(text)`; the exact-article lookup always sees the original
    so «ماده N» still parses.
- How it works: appends canonical variants to the search text (never removes the user's words), single
  query, single embedding — no extra Qdrant call. Keep the map short and high-confidence; every entry is
  a candidate to prune by measurement.
- Flag: `SMARTJUDGE_QUERY_REWRITE=1` (default OFF).
- Measure: same as #1; expect recall@3/@5 up with @1 roughly flat. Both flags compose; measure them
  separately first, then together, and keep only the combination that beats the baseline on the
  `held_out` split.

### 3. Grow the topic→article keyword map

- Where: `retrieval_boost.KEYWORD_RULES` (`retrieval_boost.py:102`) consumed by
  `lightrag_engine.keyword_boost_laws()` (`:1312`). The map already covers appeal, cheque, lease,
  custody, inheritance, dowry, fraud; add the frequent golden topics still missing (e.g. contract
  termination, delay penalty, social-security, administrative-court competence) — each rule is a
  where-to-look hint over real payload filters, never answer text.
- Measure: `legal_gate.py retrieval` `by_category` recall@5; a rule that does not lift `kept` recall is
  removed. Cost is only the extra scroll for questions that fire it (bounded, `_BOOST_PER_RULE`).

### 4. Context budget: `CHAT_CTX_TOPK` 4→8 and `CHAT_CTX_CHARS` 600→900

- Where: `output_apps/generated_modules/smartjudge/smartjudge_module.py:1710-1711`
  (`CHAT_CTX_TOPK`, `CHAT_CTX_CHARS`) consumed at `:2241-2251`; `chat_fast.context_lines`
  (`chat_fast.py:96`, defaults `top_k=4, summary_chars=500`).
- Rationale: with top_k=4 (and 3 for precedents) the prompt drops everything below rank 4 even if the
  must-cite article is at 5–8. The bake-off's `chat_fast.context_lines(laws, top_k=4, summary_chars=500)`
  (`scripts/eval/model_bakeoff.py:360-366`) is exactly this budget.
- Measure: `legal_gate.py retrieval` already reports recall@10; the gap between recall@5 and recall@10 is
  the *upper bound* of what raising top_k to 8 can add. Confirm the actual answer-quality gain with
  `legal_gate.py answer` (live, capped at 0.05 USD) key-point coverage, not retrieval@k. Env already
  exists, so this is a config change first (`SMARTJUDGE_CTX_TOPK`, `SMARTJUDGE_CTX_CHARS`), no code.

### 5. must-cite first in the prompt context

- Where: `chat_fast.context_lines()` (`chat_fast.py:96`) currently emits rows in retrieval order. Sort
  the emitted top-k so rows matching an article/law named in the question come first (reuse
  `retrieval_boost`/`lightrag_engine` target extraction). Deterministic, prompt-only.
- Measure: retrieval@k cannot see prompt ordering; use `legal_gate.py answer` key-point coverage /
  `cited_ok`. Deferred because it needs the paid `answer` mode; the retrieval-side ordering (#1)
  already does most of the work.

### 6. Answer structure in the prompt

- Where: `prompt_library.build_system_prompt` (`prompt_library.py:248`) and `_TEXT_STRUCTURE` (`:171`)
  already require «خلاصه پاسخ / مبنای قانونی / نکات عملی / هشدار مشورتی». The bake-off shows 0 citations:
  strengthen «مبنای قانونی» to force the article number is copied from the seeded context, and add an
  explicit «if the context has no article, say so» line.
- Measure: **not** retrieval@k. Needs `legal_gate.py answer --confirm-spend` (`cited_ok`,
  `must_include`) or the LLM judge; treat as a later step after #1–#3 move retrieval@k.

---

## What was implemented in this change

Two low-risk, retrieval-only changes, both behind env flags that default **OFF** (production untouched
until measured), each with offline unit tests:

- `SMARTJUDGE_MUSTCITE_BOOST` — `retrieval_boost.py` flags + `lightrag_engine._mustcite_keys` /
  `_rank_payloads` fusion.
- `SMARTJUDGE_QUERY_REWRITE` — `retrieval_boost.rewrite_query` wired into
  `lightrag_engine._qdrant_fallback_laws_impl`.

Tests: `output_apps/generated_modules/smartjudge/tests/test_retrieval_answer_quality.py` (no network, no
Qdrant, no LLM; verifies flags default OFF, the rewrite is pure and additive, the must-cite boost
reorders only when the question names a target, and the vector branch gets the rewritten text while the
exact lookup keeps the original).

Suggested rollout: baseline `retrieval` → enable #1 only → enable #2 only → enable both → compare
`retrieval@5` on `dev` and `held_out`; keep a flag ON (in config, not code) only if `held_out` recall@5
improves and no group regresses by more than the `--warn-drop` threshold.