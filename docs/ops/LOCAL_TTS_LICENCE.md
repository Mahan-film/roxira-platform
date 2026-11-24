# Local Persian TTS Architecture & Licence Review (T251 / #990)

## Overview
This document records the licence verification and component architecture for the local Persian Text-to-Speech (TTS) runtime in Roxira Smart Judge and the voice phone agent, replacing dependence on the unofficial `edge-tts` scrape with a 100% permissively licensed engine.

## Licence Audit Matrix

| Component | Upstream Project | Licence | GPL Clean? | Status | Notes |
|---|---|---|---|---|---|
| Inference Engine | `sherpa-onnx` (k2-fsa) | **Apache-2.0** | **Yes** | Approved | In v2.0.0, sherpa-onnx removed GPL-licensed `espeak-ng` and `piper-phonemize` to achieve strict Apache-2.0 runtime compliance (verified in `docs/strategy/research/R18_VERIFIED.md` item 7). |
| Acoustic Model | Piper VITS Persian (`fa_IR-amir-medium` / `fa_IR-gy-medium`) | **MIT** | **Yes** | Approved | Piper voice checkpoints are permissively licensed under MIT. Phonemization is handled via native tokens/lexicon or grapheme tokens without linking GPL libraries. |
| Spoken Normaliser | `persian_spoken_normaliser.py` | **MIT / Apache-2.0** | **Yes** | Approved | Built in-house. Standard library only (`re`, `typing`, `math`). Zero external dependencies. Normalizes numbers, Jalali dates, statutory articles, legal abbreviations, percentages, and currencies. |
| Streaming Clause Flusher | `StreamingClauseFlusher` | **MIT / Apache-2.0** | **Yes** | Approved | Built in-house. Flushes on clause delimiters (`،`, `؛`, `:`) after `>= 6` words, reducing time-to-first-audio while preserving natural clause pauses. |
| Fallback Adapters | `voice_tts.py`, `tts_server.py` | **MIT / Apache-2.0** | **Yes** | Approved | Seamless fallback to `edge-tts` (development/testing) and Azure AI Speech (F0/keyed production fallback). |

## Licence Policy Adherence
- **Zero GPL / AGPL / SSPL / ELv2**: Meets Roxira's hard constraint in AGENTS.md §4 and CI runtime licence gate (`scripts/ci/check_licences.py` / T252).
- **Offline & Self-Contained**: Can run fully offline on the local Linux box (`roxira-ci`) with no outbound network calls required for speech synthesis.
