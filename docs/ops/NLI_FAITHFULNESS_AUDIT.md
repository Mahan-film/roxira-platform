# Async Persian NLI Faithfulness Audit (`roxira-ci`, T249 / #988)

## 1. Purpose

Runs asynchronously on `roxira-ci` after the nightly Smart Judge eval (T248 / `#987`):
1. Splits each generated answer into atomic factual/legal claims (`split_answer_into_claims`).
2. Scores every `(cited_chunk, claim)` pair using an MIT-licensed multilingual NLI INT8 ONNX model (`MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`), with a `BAAI/bge-m3` cosine similarity fallback for paraphrases.
3. Calibrates `entailment_threshold` and `cosine_fallback_threshold` against a 50-claim hand-labeled set and a licence-checked public Persian NLI set.
4. Writes summary faithfulness scores (`support_rate`, `contradiction_rate`, `labeled_eval`) atomically into the nightly eval JSON report under `"nli_faithfulness"`.

## 2. Licence & Config Policy

All model IDs, licence metadata, and thresholds live in `config/nli_faithfulness.json`:
- Runtime models must be **MIT / Apache-2.0 / BSD / PostgreSQL** only (T252).
- `verified` remains `false` until the box hub checks the model card/licence and runs calibration.

## 3. Box Run Commands (`NEEDS BOX RUN`)

```bash
# 1. Verify offline unit tests on the box
pytest -q src/ops/test_nli_faithfulness_audit.py

# 2. Calibrate thresholds on 50 hand-labeled claims + public Persian NLI set (with local INT8 ONNX weights)
python3 scripts/ops/ci_box/nli_faithfulness_audit.py \
  --labeled-claims /srv/data/eval/nli_50_hand_labeled.jsonl \
  --onnx-model-dir /srv/data/models/mdeberta-v3-xnli-int8 \
  --calibrate --json

# 3. Audit nightly eval answers and update nightly report
python3 scripts/ops/ci_box/nli_faithfulness_audit.py \
  --eval-answers /srv/data/eval/nightly_answers.jsonl \
  --nightly-report /srv/data/eval/nightly_report.json \
  --onnx-model-dir /srv/data/models/mdeberta-v3-xnli-int8 \
  --json
```

## 4. Measurement Results (To Fill After Box Run)

| Metric | Target | Measured | Notes |
|---|---|---|---|
| Precision (50 hand-labeled claims) | >= 0.85 | *pending box run* | |
| Recall (50 hand-labeled claims) | >= 0.85 | *pending box run* | |
| Nightly batch runtime | Inside nightly window | *pending box run* | |
