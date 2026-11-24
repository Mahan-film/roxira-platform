# Phone STT Bake-off Plan & Skeleton (2026-11, #1116 / T293 R30)

> **Status:** Skeleton ready; live vendor scoring pending box run with vendor API keys.
> **NEEDS BOX RUN:** `python3 scripts/dev/phone_stt_bakeoff.py --make-synthetic /tmp/stt_8k && python3 scripts/dev/phone_stt_bakeoff.py --manifest /tmp/stt_8k/manifest.json --report-out docs/research/PHONE_STT_BAKEOFF_2026-11.md`

## Scope
- Evaluate five STT candidates on synthetic 8 kHz narrowband audio for legal-term recognition in the default language (`fa`) and German (`de`):
  - `groq:whisper-large-v3-turbo`
  - `deepgram:nova-3`
  - `soniox:realtime`
  - `azure:speech`
  - `speechmatics:enhanced`
- All vendor prices and billing minimums are stored in effective-dated `config/phone_stt_bakeoff.json` (`status: requires-primary-check`).
- Per R30 policy (`docs/strategy/research/R30_DIGEST.md`), **no training-discount opt-in is permitted** (`accept_training_discount` is rejected at config load).

## Winner Selection Criteria
1. `training_opt_out == true` and `accept_training_discount == false`.
2. Entity Error Rate (`EER`) `< 10%` across the default-language and German legal-term suites.
3. Lowest estimated USD cost per suite (tie-break by lowest EER, then lowest p50 latency).

## Results (Pending Box Run)
| Vendor | EER | WER | Latency p50 (ms) | Est. Cost (USD) | Eligible | Price Status | Note |
|---|---:|---:|---:|---:|---|---|---|
| `groq:whisper-large-v3-turbo` | pending | pending | pending | pending | pending | requires-primary-check | needs box run |
| `deepgram:nova-3` | pending | pending | pending | pending | pending | requires-primary-check | needs box run |
| `soniox:realtime` | pending | pending | pending | pending | pending | requires-primary-check | needs box run |
| `azure:speech` | pending | pending | pending | pending | pending | requires-primary-check | needs box run |
| `speechmatics:enhanced` | pending | pending | pending | pending | pending | requires-primary-check | needs box run |
