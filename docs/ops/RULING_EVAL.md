# Smart Judge ruling-draft eval (issue #456)

`scripts/eval_ruling_drafts.py` is the measurement gate for generated ruling
drafts. No claim that a draft is "good" is allowed without running it here and
showing the citation-validity, recall and refusal numbers. Drafts are advisory
only: every draft must carry the explicit non-binding banner and must never look
like an official court document (owner decision in
`docs/research/PLATFORM_CAPABILITY_ASSESSMENT_2026-10.md`).

The script is read-only. It reads a labelled case file and the tracked corpus,
prints a table, and with `--out` writes the full JSON report. It never touches
production state.

## 1. The labelled case set

Labelled cases live in `data/eval/ruling_drafts/cases.jsonl` — one JSON object
per line. It ships with 12 synthetic cases (6 `civil`, 6 `criminal`), including
2 that must be refused.

| field | meaning |
|---|---|
| `id` | unique case id |
| `court_type` | `civil` or `criminal` |
| `claimant` / `respondent` | civil party names |
| `complainant` / `accused` | criminal party names |
| `facts` | the fact pattern given to the generator |
| `claims` | what the party asks the court for |
| `evidence` | list of `{title, text}` evidence items |
| `expected_articles` | `[{law_name, article_no}]` the draft should cite |
| `must_refuse` | `true` when no valid basis exists in the corpus |
| `notes` | what the case is testing |

**Names must be fictional and reused from a fixed declared set** (the test
`test_cases_file_uses_only_declared_fictional_names` enforces this). Never paste
a real person, company or case into this file.

### Adding a case

1. Pick articles that are **active** in
   `data/legal/dotic_articles_2026-09-22.jsonl` (check `law_name`,
   `article_no`, `is_active`). A case whose `expected_articles` are not active
   in the corpus fails `test_every_expected_article_exists_and_is_active`.
2. For a `must_refuse` case, set `expected_articles: []` — the point is that the
   corpus has no basis for the subject (e.g. no labour law, no cybercrime law).
3. Use only declared fictional names; add any new name to `FICTIONAL_NAMES` in
   `src/billing/test_eval_ruling_drafts.py` in the same PR.
4. Run the tests (below); they are offline and deterministic.

## 2. Metrics

Per case the harness scores:

- **citation validity** — every cited article exists and `is_active` in the
  corpus. Any citation to a missing or inactive article makes the case fail.
- **expected recall** — fraction of the case's `expected_articles` that the
  draft actually cited (vacuously 1.0 when nothing is expected).
- **refusal correctness** — the draft refuses (`INSUFFICIENT_BASIS`) iff the case
  is labelled `must_refuse`.
- **banner present** — the non-binding AI-draft banner is shown.
- **no forbidden words** — no «قوه قضائیه» used as a whole-line header (an inline
  mention is fine) and no `approved` / `final`.

The report aggregates `citation_validity_rate`, `expected_recall_overall`,
`refusal_correct_rate`, `must_refuse_correct_rate`, `banner_present_rate` and
`no_forbidden_words_rate`.

## 3. Thresholds

Measured against the whole set before any per-court claim:

| metric | threshold |
|---|---|
| citation validity | **100%** |
| overall expected recall | **≥ 0.80** |
| refusal correctness on `must_refuse` cases | **100%** |
| banner present | 100% |
| no forbidden words | 100% |

Recall is the only soft threshold; citation validity and refusal are absolute —
a single fabricated or inactive citation, or one wrong refusal, blocks the
claim. Do not lower a threshold to make a run pass; fix the generator or the
corpus.

## 4. Run it

Offline (deterministic fake generator, no model call, no key):

```sh
python3 scripts/eval_ruling_drafts.py --mode offline \
    --out /tmp/ruling_eval.json
```

Live is a stub until the real call is wired. It needs a module exposing
`generate(case, corpus) -> {text, cited_articles, insufficient_basis}`; with no
`--generator-module` it exits with a clear error:

```sh
python3 scripts/eval_ruling_drafts.py --mode live \
    --generator-module path/to/generator.py --out /tmp/ruling_eval.json
```

The live generator **must** call the model through
`output_apps/generated_modules/smartjudge/llm_router.py` using the `strong` or
`cheap` role and **must never** send case data to the `free` tier
(`config/models.yaml` roles; `docs/STRATEGY.md` §3b). No model id is hardcoded
in the harness — read it from `config/models.yaml`.

Tests (only the new file, never the whole tree):

```sh
python3 -m pytest src/billing/test_eval_ruling_drafts.py -q
```

## 5. Read the result

```
id            court       cited  cit_valid  recall  refus_ok  banner  no_forbid
civil-01      civil           3       True    1.00      True    True       True
...
cases=12 citation_validity=1.000 expected_recall=1.000 refusal_correct=1.000 ...
```

The JSON report adds `thresholds`, `thresholds_met` (per metric) and the full
`per_case` rows, so a failing case can be inspected individually via
`invalid_citations` and `forbidden_words`. These numbers are **internal
evaluation only** — they are not a quality guarantee and must not be shown to a
customer as one.
