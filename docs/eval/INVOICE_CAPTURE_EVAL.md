# Invoice capture: extraction evaluation

Dataset: 36 synthetic Persian invoices (12 variants x 3 seeds), generated deterministically by `eval/dataset.ts`.
Input is invoice TEXT as OCR or a PDF text layer would deliver it (Persian/Arabic/Latin digits, Jalali dates, toman, OCR letter noise).
Scoring is exact per field after normalisation; there is no partial credit.

> Offline run: only the deterministic baseline was executed (scorer + pipeline check, a floor, not a model).

| Run | n | parse failures | kind | seller_name | seller_tax_id | invoice_number | date | currency | items | subtotal | tax | total | paid | all critical | all fields | cost USD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline (regex, not a model) | 36 | 0 | 100.0% | 97.2% | 100.0% | 100.0% | 100.0% | 100.0% | 94.4% | 97.2% | 100.0% | 100.0% | 100.0% | 97.2% | 91.7% | 0.0000 |

## All-fields-correct rate by variant

| Run | clean_fa_digits | latin_digits | arabic_digits | toman | no_vat | multi_item | missing_tax_id | foreign_usd | paid_cash | sales | compact_date | ocr_noise |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline (regex, not a model) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% |

**Live model accuracy was NOT measured in this run.** Run with `--live` and a key.

## What this does and does not prove

- Measured here: the 36-invoice set, the exact-match scorer, and a deterministic regex baseline (no model, no network). The baseline
  is a floor and a pipeline check (parse -> normalise -> validate); its misses are all in the `ocr_noise` variant, whose item rows
  it cannot parse once spacing is damaged.
- **Not measured: any real model.** This session had no `OPENROUTER_API_KEY` and no outbound network, so the free models
  (`invoice_extraction` role of `config/models.yaml`) were never called. There is no accuracy figure for them, and none should be quoted.
- **Not measured: images.** Rendering Persian invoice images needs a text-shaping engine that was not available offline
  (Pillow without raqm cannot join Arabic-script letters), so the set is text as OCR / a PDF text layer would deliver it. Vision accuracy
  on photos and scans is unknown. Whether the free models listed in the role accept images at all is also unverified.
- Voice notes: only the transcription call shape is implemented and unit-tested against a mock; no real audio was transcribed.

## How to measure the real models (owner, ~36 calls per model, free tier costs 0)

```bash
cd output_apps/enterprise_hub
OPENROUTER_API_KEY=... npx ts-node modules/invoice_capture/eval/run-eval.ts --live --out ../../docs/eval/INVOICE_CAPTURE_EVAL.md
```

Each model of the role is called alone (no fallback) with synthetic text only. Read the `all critical` column (seller, date, total,
tax, kind): auto mode must stay off for a tenant until that number, on a sample of that tenant's real invoices, is acceptable.
