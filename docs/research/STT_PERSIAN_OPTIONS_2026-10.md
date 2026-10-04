# Persian STT options (2026-10-04)

Companion to `STT_PERSIAN_RESEARCH_2026-10.md`. Tags: FETCHED = read from the source this session; SEARCH-ONLY/UNVERIFIED = search snippet or own arithmetic. Nothing here was measured on Persian audio: run `scripts/dev/stt_bakeoff.py`.

## 1. MAI-Transcribe-2

- Persian (Farsi) is on the supported-language list. FETCHED, Microsoft model card PDF, "Supported languages" section (60 languages incl. "Persian (Farsi)", Urdu, Arabic, Hebrew, Turkish): https://microsoft.ai/pdf/MAI-Transcribe-2-Model-Card.pdf. The 5.2% average FLEURS WER is an average over 60 languages (FETCHED, https://microsoft.ai/news/mai-transcribe-2); no Persian-only WER was found. Do not assume Persian is near 5%.
- OpenRouter with the existing key: yes. FETCHED: `microsoft/mai-transcribe-2` (and `-20260903`, plus older `mai-transcribe-1.5`) is in the public catalogue with output modality `transcription` (https://openrouter.ai/api/v1/models?output_modalities=all) and microsoft.ai lists OpenRouter as a channel. Endpoint `POST https://openrouter.ai/api/v1/audio/transcriptions`, JSON body `{model, input_audio:{data:<base64>, format}, language?:"fa"}` (https://openrouter.ai/docs/guides/overview/multimodal/stt). No Azure key needed.
- Price: $0.10 per audio hour, limited-time through end of 2026 (FETCHED, microsoft.ai news page; catalogue shows 0.1). After 2026 the price is unknown. Azure/Foundry direct is the other channel (separate Azure account and key; price not fetched).
- Caveat: OpenRouter's catalogue "price" unit for transcription models is per second for most (whisper-1 0.0001/s = $0.36/h) but MAI lists 0.1; treated as $/hour. Check the first real `usage.cost` in the response.

## 2. What the OpenRouter screenshot prices mean (catalogue, FETCHED)

- STT models are billed per audio time, not per token: 1 h of Persian audio = 1 h of billing regardless of language.
- "$0.50 / $9 per million" = `google/gemini-3.8-flash-tts` (and lite: 0.5 / 6): input text tokens / output audio tokens. "$15-$30 per million" = TTS models billed per million input characters (grok-voice-tts 15, voxtral-mini-tts 16, qwen-audio-3.0-tts-flash 15 / plus 20). These are text-to-speech (Roxira's voice replies), not STT. Per-character basis is an assumption (UNVERIFIED).
- Rough TTS cost per hour of generated speech (UNVERIFIED arithmetic): ~25 audio tokens/s assumed => 90k tokens => about $0.81 at $9/M; ~55k characters/hour => $0.8 to $1.65 at $15-30/M.
- Gemini audio-input LLMs (not ASR APIs) bill audio at ~32 tokens/s (Google docs, SEARCH-ONLY): 1 h = ~115k tokens. `gemini-3.8-flash` audio $0.75/M => ~$0.09 in, plus ~20k output tokens at $3.75/M => ~$0.07: roughly $0.16/h. `google/gemini-3.5-transcribe` ($2 in / $12 out per M) => roughly $0.45/h. UNVERIFIED.

## 3. Cost of 1 hour of Persian audio

| Option | Persian support | $/hour | Evidence |
|---|---|---|---|
| MAI-Transcribe-2 (OpenRouter) | listed | 0.10 (promo) | FETCHED |
| AssemblyAI Universal-2 | yes, "moderate accuracy (>25% to <=50% WER)" | 0.15 | FETCHED (docs supported-languages; pricing page) |
| AssemblyAI Universal-3.5 Pro | NO Persian (18 languages) | 0.21 | FETCHED; the OpenRouter `assemblyai/universal-3-5-pro` is therefore useless for Persian |
| OpenRouter whisper-large-v3-turbo | Whisper multilingual | ~0.012 (unit assumed) | catalogue FETCHED, unit UNVERIFIED |
| OpenRouter whisper-large-v3 | yes | ~0.027 | same |
| OpenRouter whisper-1 | yes | 0.36 | FETCHED |
| OpenRouter gpt-4o-transcribe | not verified | ~0.36 | SEARCH-ONLY |
| Deepgram nova-3 (OpenRouter) | Persian not verified | ~0.258 | catalogue; Persian UNVERIFIED |
| Gemini via chat completions `input_audio` | probable | ~0.16 to 0.45 | UNVERIFIED |
| Mistral Voxtral | Persian NOT listed (prior research) | n/a | prior doc |
| Local mlx-whisper / whisper.cpp large-v3-turbo | yes | 0 | see below |

Local on Apple Silicon 16 GB: large-v3-turbo (~800M params) fits comfortably (~1.6 GB fp16). Expected speed is typically 10-30x real time on M-series with MLX (SEARCH-ONLY/UNVERIFIED, depends on chip); this Mac already has `whisper-cli` at /opt/homebrew/bin; `mlx_whisper` is not installed (`pip install mlx-whisper`). The script uses `mlx_whisper` or `whisper-cli` with `--whisper-cpp-model`.

## 4. Not found / not verified

- Persian-specific WER for MAI-Transcribe-2, Deepgram, Gemini, gpt-4o-transcribe.
- Post-2026 MAI price; Azure direct price.
- OpenRouter's model-level `language` support per provider.

## 5. Recommendation: test first

1. Run `--make-sample`, read the sentences aloud (~2 min, include legal terms and digits), record WAV.
2. Bakeoff: `microsoft/mai-transcribe-2` (cheapest, Persian listed, existing OpenRouter key) vs `openai/whisper-large-v3-turbo` (current baseline) vs AssemblyAI Universal-2 vs local mlx-whisper. Total cost under 1 cent for 2 min.
3. Adopt only on a measured WER win; keep local whisper as the privacy fallback (customer audio and `:free`-tier rules in AGENTS.md section 4 still apply: send only your own recorded samples now).
4. MAI's promo price ends 2026-12-31: budget for an unknown later price.
