# Smart Judge on the phone: why the answers were poor (diagnosis, 2026-11-21)

Box hub (roxira-ci), lane L7. Inputs:

- the owner's test call on 2026-11-21, 05:58 to 06:02, 7 turns, from the agent journal on the box (caller number and room names left out);
- the box hub's anonymous replays of the correctly worded questions against the public judge API, in text and voice mode;
- a code reading of `services/voice_phone_agent` and `output_apps/generated_modules/smartjudge`.

Production was not touched or inspected.

## Summary

Three causes stack up:

1. **STT** garbles the legal terms.
2. **Retrieval and the catalog intents** therefore never see the right words.
3. **The voice path** turns a weak context into a non-answer. It uses a cheap model, 200 tokens and no escalation, and asks a clarifying question when ungrounded.

Fixing STT alone is not enough. With the right wording, the text-mode replays still answered "not found in the retrieved sources", even for the basic list of judges' and lawyers' disciplinary offences. So the corpus has a gap too.

## The call, turn by turn

Each turn's timings are counted from the end of the caller's speech. `first sentence` is the first sentence back from Smart Judge; `first audio` is when the caller first hears it.

| # | Whisper heard | Caller meant | Whisper logprob | STT | First sentence | First audio | Outcome |
|---|---|---|---|---|---|---|---|
| 1 | تنم ازت شیر. | unintelligible (right after the greeting) | -0.64 | 0.9 s | 3.3 s | 5.7 s | "not a legal question" |
| 2 | آخرین بخشنامه **قول به غذایی** چی بوده؟ | قوه قضاییه | -0.27 | 0.5 s | 6.6 s | 8.4 s | "no circular called قول به غذایی", asks to clarify |
| 3 | انامه‌بیره **تخلافات** دادگاه عالی انتظامی **قضاک** … وکلا چی ها هستش؟ | تخلفات … قضات | -0.30 | 1.1 s | 3.2 s | 6.0 s | "I can list them only with the legal text, which I do not have" |
| 4 | … آخرین قانون **موردان برشویش** چی ها بوده؟ | مبارزه با پولشویی | -0.48 | 1.1 s | 8.7 s | 10.2 s | "I did not understand", asks to clarify |
| 5 | آخر آرای **عدی بستا سویه** چه بوده؟ | آرای وحدت رویه | -0.47 | 0.7 s | 2.7 s | 4.3 s | "no ruling titled آرای عدی بستا سویه" |
| 6 | مثلا برای من چی می‌تونی بنویسی؟ | (correct) | -0.20 | 0.8 s | 3.4 s | 6.0 s | generic but fine |
| 7 | ~~الان توی یک درگیری … آیا قانون فرق می~~ در محل اومده و یا در محل خصوصی؟ | fight in a public place vs at home | - | - | - | - | first half dropped as "echo"; asked to clarify |

Six of the seven questions are seeded as a text-only eval set in #987 (PR #1043). Turn 1 is left out because it is unintelligible.

## Three buckets (plus latency)

| Bucket | Evidence | Root cause | Who owns it | Open R18 rows that cover it | Fix now |
|---|---|---|---|---|---|
| **STT** (box) | 4 of 7 turns had misheard legal terms (turns 2–5). Every turn is tagged `[groq:whisper-large-v3]`. The garbled turns scored logprob -0.27 to -0.48, inside the "usable" band (-0.05 to -0.45), so the confidence gate cannot catch them. The old prompt already contained آرای وحدت رویه, and Whisper still heard "عدی بستا سویه". | (a) Whisper alone on 8 kHz phone audio: the Gemini hybrid path is off because the box has no `GEMINI_API_KEY`. (b) The Whisper prompt is a weak lever. (c) `stripEcho` removed the caller's own words in turn 7. Its letter-pair check compared each word with 45 s of agent speech, so common Persian words always "matched". VAD, max-utterance (20 s) and barge-in were checked: one barge-in fired, as it should, and they are not the cause. | L7 (box) | T250 #989 (fast STT, VAD/barge-in). Its Done-when is **latency only**: no transcription-accuracy criterion. | PR #1042: echo removal fixed (word-to-word, in-order alignment); one vocabulary list for the Whisper and Gemini prompts, with the most important terms last; an idempotent repair of exactly these misrecognitions. The repair is a patch, not the cure. |
| **Retrieval + corpus** (production) | The text-mode replays with correct wording said "not found in the retrieved sources", including the judges' and lawyers' disciplinary offences. In voice mode, turn 3 said the text was "not available to me". The free tier also answered "high demand, busy" once. | (a) The corpus is about 60 laws (T257). Whether قانون نظارت بر رفتار قضات and لایحه قانونی استقلال کانون وکلای دادگستری (with its آیین‌نامه) are indexed is not confirmed. (b) There are no **judiciary circulars**: the regulations collection holds CBI circulars, deregulation-board resolutions and ekhtebar rows (`regulations_retrieval.TYPE_LABELS`, `scripts/legal/ingest_regulations.py`). (c) The "latest regulation" catalog intent calls `latest_rulings(sub_collection="regulations")` on the **rulings** collection, and `rulings_retrieval._scroll_filter` has no `regulations` case. The scroll is then unfiltered, so "latest circular" gets the latest rulings as context. This is from reading the code only. (d) A unity-rulings feed and a "latest" catalog intent do exist (`rulings_auto_update.sh` every 6 h, `catalog_intent.py`). The catalog regex needs آخرین/جدیدترین plus وحدت رویه, so after the STT error it never fired; colloquial "آخر" is not in `_LATEST_KW`. (e) The server's `repair_legal_phonetics` does not cover the 2026-11-21 errors: its قوه pattern does not match "قول به غذایی". | L4 (main hub) | T257 #996 (500 laws plus regulations and unification rulings; **prio 2, last in the L4 order**); T241 #980 (hybrid retrieval); T238 #977 (authority tiers, with circulars as tier 2); T247 #986 (golden set); T248 #987 (nightly eval). | Box: PR #1043 seeds the eval with these questions and the key points they need. Production: ASK-HUB on #965. |
| **Voice path** (production code, L4 file) | Four of the six answered questions got a non-answer or a clarifying question (turns 2, 3, 4 and 7). Answers are short and generic even when a law is clear. | In `smartjudge_module.py`: `voice_model` is the cheap role for both tiers; voice gets `max_tokens = 200` and temperature 0.2. Escalation runs only `if not is_voice`. When the context is not grounded, `VOICE_LOW_RELEVANCE_INSTRUCTION` tells the model to "ask a short clarifying question". The phone gateway's paid fallback (PR #799) is not used for a second try. | L4 (main hub) | Partly T236 #975 (router hygiene), T246 #985 (verifier) and T258 #997 (multi-turn condensation). **No row** covers the voice answer policy. | ASK-HUB on #965 (proposal only; the box does not edit this file without the main hub's yes). |
| **Latency** (both) | STT takes 0.5–1.1 s. The first sentence from Smart Judge comes 2.7–8.7 s after the caller stops. edge-tts adds 1.4–2.8 s before first audio, so first audio lands 4.3–10.2 s after the caller stops. The R18 target is 1.5 s p50. | Most of it is Smart Judge time to the first sentence; TTS of the first sentence is second. | L4 for the brain, L7 for TTS | T234 #973, T235 #974, T236 #975, T242 #981, T245 #984 (stage timings), T250 #989 (filler audio, timings), T251 #990 (local TTS). | Box follow-up, not in a row: start TTS at the first comma of a long first sentence. |

## What R18 is missing

1. **STT accuracy criterion in T250 (#989).** Add a term-accuracy check on recorded phone turns, with the 2026-11-21 terms as the minimum. Audio stays on the box; it never goes into git. The owner must consent to `DEBUG_RECORD_CALLERS`.
2. **Judiciary circulars and a dated "latest" path.** T257 names regulations and unification rulings, but not judiciary circulars (بخشنامه‌های قوه قضاییه) or a "latest N by date" query for them. Also needed: the catalog scroll filter fix for the `regulations` intent (bucket 2, point c).
3. **Voice answer policy** (new row). It covers:
   - model and token budget for voice;
   - one escalation through the phone gateway's paid fallback when the first answer is ungrounded or a non-answer;
   - answering with a short caveat instead of a clarifying question when the legal topic is clear.
4. **Server phonetics parity.** Add the 2026-11-21 patterns to `legal_phonetics.py`, so web voice input gets the same repair. The exact patterns are in the ASK-HUB.
5. **T257 priority.** It is prio 2 and last in the L4 order. Coverage of basic statutes, such as the disciplinary laws, is what the owner hit first.

## Box PRs from this diagnosis

- PR #1042 (#989): echo removal fix, Whisper and Gemini vocabulary, repair of the misheard terms, and tests. Gemini hybrid STT stays optional: it switches on only once `GEMINI_API_KEY` is set on the phone stack, which the owner has not done yet.
- PR #1043 (#987): eval seed with the six questions, `stt_heard`, law-level key points (TO-VERIFY) and an `--voice` flag in `scripts/eval_chat_golden.py`.

## Not checked

- Whether the phone stack's `.env` overrides `STT_PROMPT` or `STT_MODE`. That file belongs to the `phone` user and cannot be read from here.
- The new Whisper prompt on real call audio. The recorded turns belong to the `phone` user, and builders hold no keys.
- Production corpus contents, and the catalog `regulations` scroll behaviour on production. Both are from code reading and replay answers only.
- The legal key points in the eval seed. All are TO-VERIFY until the lawyer checks them.
