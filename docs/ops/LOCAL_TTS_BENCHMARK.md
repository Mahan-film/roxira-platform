# Local Persian TTS & Spoken Normaliser Benchmark (T251)

- **Date**: 2026-11-24 11:28:20 UTC
- **Normaliser p50**: 63.4 µs (0.063 ms)
- **Normaliser p95**: 109.1 µs (0.109 ms)
- **Target First Audio**: <= 300.0 ms p95
- **Overall Status**: NEEDS_BOX_RUN

## Spoken Normaliser Results

| Metric | Latency |
|---|---|
| p50 | 63.4 µs |
| p95 | 109.1 µs |
| p99 | 194.1 µs |
| max | 235.5 µs |

## Local Synthesis Results

> **Note**: Local sherpa-onnx / Piper weights not mounted on this runner.
> Requires box execution on Linux laptop `roxira-ci` via `python3 scripts/ops/bench_local_tts.py`.

### Sample Test Phrases & Normalized Forms

| Key | Raw Phrase | Normalized Spoken Text |
|---|---|---|
| `greeting_short` | سلام، به سامانه خوش آمدید. | سلام، به سامانه خوش آمدید. |
| `clause_boundary` | با عنایت به مفاد ماده ۱۰ قانون مدنی، | با عنایت به مفاد ماده ده قانون مدنی، |
| `legal_statute` | مهلت تجدیدنظرخواهی بیست روز پس از ابلاغ است. | مهلت تجدیدنظرخواهی بیست روز پس از ابلاغ است. |
| `complex_legal` | طبق ماده ۱۲ ق.م. و دادنامه مورخ ۱۴۰۳/۰۸/۱۵، مبلغ ۵۰۰۰۰۰۰ ریال تعیین شد. | طبق ماده دوازده قانون مدنی و دادنامه مورخ پانزدهم آبان هزار و چهارصد و سه، مبلغ پنج میلیون ریال تعیین شد. |
