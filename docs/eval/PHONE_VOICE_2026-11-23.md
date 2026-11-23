# Phone voice: "robotic" feedback, 2026-11-23

The owner's feedback after the 2026-11-23 call: the answers are "generally right but robotic". This note covers only what the phone side controls (T250, #989). The answer text comes from Smart Judge and is hub-only (B1).

## What the call log shows

There were three answered turns on the 2026-11-23 call:

| Measure | Value | Note |
|---|---|---|
| `stt_ms` | 3.2 s on every turn | The backup `gemini-3.5-flash-lite` won each time. The preferred `gemini-3-flash-preview` gave no text before its copies ended. The log never said why; this PR adds the reason. |
| `first_audio_ms` | 6.6 to 7.9 s | The filler («بله، یک لحظه.») played on every turn: the same words each time. |
| Greeting | 11.9 s | It said «سامانه هوشمند قاضی هوشمند», with the product name twice. |
| Dates | read as digit groups | For example «1405/07/21». |

## Phone-side changes in this PR

- **Spoken shaping** (`src/speak.ts`). It is deterministic and leaves the legal content alone. It makes three changes:
  - Jalali dates are read as «21 مهر 1405»;
  - written-answer labels such as «پاسخ کوتاه:» are dropped;
  - «... in this message» becomes «in my sources».
- **Sentence chunks.** A streamed sentence without a full stop is cut at a comma after `MAX_SENTENCE_CHARS` (160; it was 220).
- **Fillers rotate** among three short phrases (`FILLER_TEXT`, separated by `|`).
- **Greeting.** Only the opening is shorter: «سلام، قاضی هوشمند هستم.» The notice sentence is kept word for word, because voice answer policy text waits for the owners and the lawyer (HUB-ANSWER on #965, 2026-11-23).
- **Pitch.** `TTS_PITCH` reaches edge-tts through the sidecar. The prompt cache key includes rate and pitch, so a voice change also re-synthesizes the fixed prompts.
- **STT log.** The caller line now says why the preferred Gemini model lost, for example `gemini-3-flash-preview lost: 429,timeout`. It gives status codes only, never keys.

## Voice samples (for the owner to choose)

There are only two Persian edge voices: `fa-IR-FaridNeural` (male, the current one) and `fa-IR-DilaraNeural` (female). The samples are phone-band WAVs (300 to 3400 Hz, 8 kHz). They are kept on the box, not in git, in `phone-voice-samples-2026-11-23/`:

| File | Voice | Rate | Pitch | Text |
|---|---|---|---|---|
| 1 | Farid | +8% | +0Hz | logged reply, raw (today's sound) |
| 2 | Farid | +0% | -4Hz | raw |
| 3 | Dilara | +0% | +0Hz | raw |
| 4 | Dilara | +5% | -2Hz | raw |
| 5 | Farid | +8% | +0Hz | logged reply after `speakable` (the PR's output) |
| 6 | Farid | +4% | -2Hz | after `speakable` |
| 7 | Dilara | +4% | -2Hz | after `speakable` |

Samples 5 to 7 were made with this PR's sidecar (`tts_server.py` with pitch) and this PR's `SentenceSplitter`, run on the reply logged on 2026-11-23. Samples 1 to 4 hold only the reply's first two sentences, so compare durations only within each group.

The defaults are unchanged (Farid, +8%, +0Hz) until the owner picks. To pick, set `TTS_VOICE`, `TTS_RATE` and `TTS_PITCH` in the phone `.env` and restart the agent.

## Not changed here (server side, asked of the main hub on #965)

- The voice reply was cut mid-word at the 200-token voice cap.
- The "latest circular" catalog intent reads the rulings collection.
- The grounding prompt's "in this message" wording.
