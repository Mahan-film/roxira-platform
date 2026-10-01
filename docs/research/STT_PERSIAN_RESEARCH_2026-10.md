# Persian STT research — 2026-10-01

## Decision

**Recommendation:** keep the current Whisper-family baseline, but make a
locally hosted `faster-whisper large-v3-turbo` the first evaluated/eligible
engine; do not change `config/models.yaml` yet.  First fix speech capture,
force `fa` on *both* paths, add a small approved legal-vocabulary prompt, and
re-ask on low confidence.  Run the same offline Persian corpus against that
engine and `vosk-model-fa-0.42`; promote only the measured winner.  This is
more likely to fix `سلام تو کی هستی` -> `سلام از فتیر دویستی` than an
unmeasured provider swap, avoids the observed OpenRouter 429 dependency, and
keeps case audio on Roxira infrastructure.

Scope/read-first: the configured `stt` primary is
`openai/whisper-large-v3-turbo` and the TTS is Edge Persian Neural in
`config/models.yaml`; `docs/W15_stt_plan.md` records a CPU-only 8-core/16-GB
server with `faster-whisper` already installed.  The direct voice route sends
`language: "fa"`; the `stt_engine.py` fallback presently does not.  Therefore
the sample failure is not evidence that Persian language forcing was tried on
the failing fallback, nor that the received audio contained both ends of the
short phrase.

## Options and evidence

WER values below are publisher/model-card numbers, not an apples-to-apples
leaderboard: corpus version, text normalisation, split, decoder, and speech
style differ.  Persian spacing/compound-word conventions make CER important.

| Option | Persian evidence / licence / date | Latency & cost | Fit |
|---|---|---|---|
| **Local Whisper large-v3 / large-v3-turbo via faster-whisper** | OpenAI released large-v3 in Nov 2023 and turbo in Sep 2024; both are multilingual (large 1.55B, turbo 798M). [Official card](https://github.com/openai/whisper/blob/main/model-card.md); HF lists large-v3 as Apache-2.0 and 99 languages ([card](https://huggingface.co/openai/whisper-large-v3)). The reviewed official card has comparative CV/FLEURS plots, but no extractable, directly citable fa WER; measure locally. | W15's deployment estimate is ~1–3 s for a 5-s clip on the existing CPU, zero per-call API cost. `faster-whisper` supports CPU int8 and VAD; its published benchmarks are not Persian. | **Primary evaluation candidate.** Same family as production, no external rate-limit/hop; turbo favours response time, full v3 is the accuracy control. |
| **Vosk/Kaldi `vosk-model-fa-0.42`** | Apache-2.0, 1.6 GB; publisher reports **16.7% WER CV17** and **11.1% FLEURS**. Small 53-MB variant: 23.4% / 14.0%. [Vosk model table](https://alphacephei.com/vosk/models). | Local/offline; no per-minute fee. Its decoder/vocabulary approach is worth testing on brief commands. | **Quality challenger and low-risk fallback**, not automatically better on Roxira's spontaneous legal speech. |
| **NVIDIA NeMo FastConformer Persian** | NVIDIA says its CV15 Persian model scored **13.16% WER / 3.85% CER** and warns WER is fragile for Persian compounds; the published model is CC-BY-4.0 (commercial use allowed). [NVIDIA announcement](https://developer.nvidia.com/blog/new-support-for-dutch-and-persian-released-by-nemo-asr/). A newer community Parakeet-CTC 1.1B Persian checkpoint is Apache-2.0 but 4.25 GB; verify its own evaluation and hardware before use ([card](https://huggingface.co/MohammadGholizadeh/parakeet-ctc-1.1b-persian.nemo)). | Local/offline, but large dependency/model footprint; likely a poorer first CPU-only experiment. | Benchmark later if Whisper/Vosk miss the acceptance gate. |
| **Persian fine-tuned Whisper checkpoint** | `MohammadGholizadeh/whisper-large-v3-persian-common-voice-17`: Apache-2.0, dated 2025, trained on >250k CV17 Persian clips; its card reports **21.43% WER**, with no timestamps. [Model card](https://huggingface.co/MohammadGholizadeh/whisper-large-v3-persian-common-voice-17). Treat the self-reported validation metric as non-comparable. A small CV21 fine-tune reports 31.93% WER ([card](https://huggingface.co/aliyzd95/whisper-small-persian-v1)). | Self-hostable; large-v3 needs materially more CPU time/RAM than turbo. | Candidate only after a licence, provenance, latency, and held-out legal-speech check; do not assume “Persian-fine-tuned” wins. |
| **Groq hosted Whisper large-v3 / turbo** | OpenAI-compatible hosted endpoint. Groq publishes multilingual support; its generic (not Persian) table reports 10.3% WER/full v3, 12%/turbo, speed factors 189/216. [STT docs](https://console.groq.com/docs/speech-to-text). | **$0.111/hr** large-v3; **$0.04/hr** turbo; 100-MB dev limit. [Model list](https://console.groq.com/docs/models). | Good contingency benchmark only. Iran reachability, billing, sanctions/terms, data residency, and DPA must be verified by Roxira before any customer audio is sent. |
| **OpenAI `gpt-4o-transcribe`** | OpenAI states improved WER/language recognition vs original Whisper, but the reviewed model page supplies no Persian CV/FLEURS WER. [Model page](https://developers.openai.com/api/docs/models/gpt-4o-transcribe). | **$0.006/min** transcription ([pricing](https://platform.openai.com/pricing)); external latency and availability/compliance must be measured. | A paid accuracy control, not the default for legal audio. Do not infer Iran availability from the public documentation. |
| **Mistral Voxtral** | Current official transcription documentation lists 13 languages and **does not list Persian**. It has context biasing and realtime sub-200-ms configuration, but that does not establish fa support. [Docs](https://docs.mistral.ai/studio/audio/speech_to_text). | Provider claims sub-200-ms configurable realtime; obtain current price/contract before comparison. | **Exclude for Persian now.** Do not select a Mistral/OpenRouter-style endpoint merely because it is audio-capable. |

The current OpenRouter Whisper integration remains usable as a measured remote
fallback (W15 observed 429s rather than a 404), but model availability is not
enough: record provider, status, retry count and latency, never transcript
text, and require a successful Iran-origin connectivity/compliance test.

## Fixing short utterances

1. **Capture before decoding.** Convert/retain 16-kHz mono PCM/WAV, preserve
   250 ms pre-roll and 300 ms post-roll; do not cut on the first quiet frame.
   Groq independently documents 16-kHz mono downsampling as optimal and WAV
   as lower-latency input ([docs](https://console.groq.com/docs/speech-to-text)).
   Keep browser echo cancellation/noise suppression where it improves speech,
   log only non-content audio diagnostics (duration/RMS/clipping), and compare
   raw vs denoised clips offline.
2. **VAD/endpointing, tuned on short Persian.** Start with speech threshold
   0.5, minimum speech 250 ms, hangover/minimum silence 600–800 ms, and an
   8-s max utterance. Never discard a 1–3-word turn just because it is short.
   `faster-whisper` exposes Silero VAD, its thresholds and silence/speech
   padding controls ([source](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/vad.py)).
   These are starting values, not universal “best” settings: choose with the
   corpus by phrase-intent accuracy plus end-clipping rate.
3. **Force transcription, not translation, in Persian.** Send `language="fa"`,
   `task="transcribe"`, deterministic decoding (`temperature=0`) on every
   Whisper path.  Whisper otherwise detects a language from the opening audio;
   its code documents `language` as optional and performs detection when absent
   ([source](https://github.com/openai/whisper/blob/main/whisper/transcribe.py)).
4. **Vocabulary bias, narrowly.** For local Whisper use an `initial_prompt`
   such as: `فارسی ایران. سامانه قاضی هوشمند؛ قوه قضائیه؛ دادگاه؛ دادخواست؛
   لایحه؛ رأی وحدت رویه؛ سلام، تو کی هستی.` Rotate a short, versioned approved
   list, rather than a giant legal corpus. Whisper explicitly supports prompts
   for custom vocabulary/proper nouns ([source](https://github.com/openai/whisper/blob/main/whisper/transcribe.py)).
   For a hosted API, use biasing only if its actual endpoint documents it;
   never silently assume OpenRouter accepts Whisper decoder fields.
5. **Confidence-based repair, not confident hallucination.** Use local
   segment `avg_logprob`, `no_speech_prob`, VAD duration, empty/near-empty
   text, and a short-turn intent match. Calibrate thresholds on the corpus;
   below threshold say **`متوجه نشدم، لطفاً یک بار دیگر تکرار کنید.`** and
   retain no transcript. A re-ask is preferable to routing a wrong legal
   request. Remote text-only responses should be treated as “confidence
   unavailable”, not as high confidence.
6. **Post-correction may only select from a phrase list.** Normalise Arabic
   ي/ك and spacing, then apply audited exact/phonetic mappings only when the
   whole utterance is within a bounded greeting/identity/command list (e.g.
   the observed bad output -> `سلام تو کی هستی`). Store rule id/version and
   raw/corrected *hashes*, not case content. Do not use the existing free-form
   LLM rescorer to reconstruct legal facts: it can turn an ASR uncertainty
   into an invented legal assertion.

## Latency, cost, and acceptance criteria

For a 5-s utterance, end-to-end latency is capture hangover + decode + network
(if any). A 700-ms endpoint delay is intentional and should be shown
separately from decode time; it prevents lost final phonemes. Compare p50/p95
`capture_ms`, `vad_ms`, `stt_ms`, total turn time, fallback/429 rate, WER/CER,
and—most importantly—exact short-phrase intent accuracy.  The current server
has no GPU, so CPU p95 under the live budget must be demonstrated; do not use
vendor speed factors as a deployment promise.  Local has no variable STT fee;
Groq turbo is about $0.00067/min and OpenAI is $0.006/min at the published
prices.  For Persian legal data, provider contract and reachability are hard
gates, not cost trade-offs.

Suggested promotion gate: on a locally held, consented, non-production set
containing greetings, identity questions, legal terms, noise and Iranian
accents, the candidate must beat the current remote baseline on exact intent
and normalized WER/CER, have **zero end-clipped gold phrases**, and meet a
pre-agreed CPU p95 target. Keep a disjoint hold-out set; do not tune prompts,
rules or VAD on it.

## Adoption plan — six small, offline-testable tasks

1. In `src/test_stt_engine.py`, add mocked request assertions that every
   Whisper call contains `language: "fa"`, deterministic options, and the
   versioned approved prompt; add unit cases for the re-ask decision and
   phrase-list-only correction. No API key/network/audio is needed.
2. In `output_apps/ecosystem_core/src/factory/stt_engine.py`, centralise a
   `PersianSttProfile` used by both remote request shapes: 16-kHz conversion,
   `fa`, prompt/rule-list version, timeout/retry metadata, and no raw-text log.
   Preserve the registry-derived fallback chain.
3. Add `output_apps/ecosystem_core/src/factory/stt_local_whisper.py`: lazy
   singleton `faster-whisper` loader with CPU `int8`, `language="fa"`,
   `initial_prompt`, segment confidences and Silero VAD. Unit-test it with an
   injected fake model in `src/test_stt_local_whisper.py`, rather than
   downloading weights.
4. In `output_apps/ecosystem_core/src/factory/smartjudge_live_voice.py`, use
   the profile/local engine behind an off-by-default environment switch, add
   the calibrated re-ask response, and make remote OpenRouter a timeout/429
   fallback. Extend its focused tests in `src/test_stt_engine.py` (or add
   `src/test_smartjudge_live_voice.py`) with fakes only.
5. Add `scripts/stt_offline_eval.py` and a locally supplied, gitignored
   consented manifest path. It must produce deterministic JSON/CSV with
   normalized WER, CER, exact intent, clipping, confidence and p50/p95 for
   current remote-recorded outputs, local turbo, Vosk, and full v3; it must
   run without network once models/audio are cached.
6. After the hold-out result, update only `config/models.yaml`,
   `docs/W15_stt_plan.md`, and `src/test_stt_engine.py` to promote the measured
   engine/ordered fallback and pin thresholds/prompt-rule version. Retain the
   losing engine only as a justified fallback; re-run the offline suite before
   deployment.

## Source notes

All URLs above were opened on 2026-10-01.  GitHub/Hugging Face popularity
counts and living provider prices change; they are deliberately not selection
criteria.  Licences cited are the licensors' published labels and must be
rechecked at the exact model revision before shipping.
