# Voice reliability diagnosis, 2026-10-11

Scope: https://ghazihoushmand.ir chat. Mic button (record, `POST /api/v1/apps/judge/transcribe-audio`),
phone button (WebSocket `/api/v1/apps/judge/live-voice`), `/speak` (TTS).
Evidence: read-only `docker logs --since 48h roxira_app_prod`, nginx logs, 8 real calls to the live endpoints
(1 /speak x4, 2 transcribe-audio, 2 WebSocket handshakes via curl). No server change was made.

## What works (verified, not the cause)

| Check | Result |
|---|---|
| STT, clean 3 s Persian clip, m4a (iOS) and webm/opus (Android) | HTTP 200, correct text, ~2 s |
| `/speak` | HTTP 200 `audio/mpeg`, 1.3 to 4.9 s. One transient Cloudflare `502` (plain text `error code: 502`) in 4 calls |
| edge-tts from the server (Microsoft endpoint) | reachable, 0.4 s for a short phrase |
| WebSocket upgrade through Cloudflare + nginx (HTTP/1.1) | `101 Switching Protocols`; nginx has `Upgrade`/`Connection` on `/live-voice` and on `/api/v1/apps/judge/` |
| ffmpeg / libsndfile in the runtime image | **not present, and never was** (git history of `Dockerfile.prod` has no ffmpeg; PR #524 is not a regression). Not needed: `faster-whisper` decodes m4a/webm with PyAV (`av 18.1.0` is in the venv, bundles its own FFmpeg libs). The only ffmpeg-binary users are `_tts_mp3_to_pcm16` (dead code, no caller) and `stt_engine.py` (legacy fallback) |
| Keys (names only) | `OPENROUTER_API_KEY` set. `ASSEMBLYAI_API_KEYS` and `VOICE_*` not set. No Groq code path exists |

## Root causes found

1. **Long recordings freeze the whole server, then time out (mic button).**
   `_openrouter_transcribe` tried up to 4 sequential OpenRouter calls (2 models x JSON + multipart, 20 s each), then ran
   faster-whisper `base` **synchronously inside the async handler**. Log evidence:
   `STT-FAIL-JSON` (empty message = httpx timeout), `STT-FAIL-MULTIPART`, then
   `faster_whisper: Processing audio with duration 02:00.008`, then nginx `499` and client beacon
   `kind="timeout" elapsed_ms=90005 ua_hint="ios-safari"`. While the model ran, the event loop was blocked, so other
   users got `TypeError: Load failed` (beacons with `elapsed_ms` 12830 / 40805 on `kind=network`). The local `base` model
   also returns garbage for Persian (`سالام مال بای آبایی قفر استرانیم`).
   Fix: `voice_stt.py`, one 80 s wall-clock budget (remote share 55 %), failed models skipped quickly (429/5xx do not retry the
   multipart shape), local model in `asyncio.to_thread` with a deadline-aware segment loop, statuses logged.

2. **Silent failures were one opaque 502.** A provider outage and "no speech heard" were both `502 تبدیل گفتار ناموفق بود`.
   Now: silence returns `200 {text:"", code:"NO_SPEECH"}`; outage returns `502 {code:"STT_UNAVAILABLE"}`.

3. **Live voice used a model that 429s and had absurd timeouts.** Registry `stt` primary was
   `openai/whisper-large-v3-turbo` (rate limited, see the existing note in `config/models.yaml`), while the mic button hardcoded
   the working `openai/whisper-large-v3`. In live voice: STT `urllib` timeout 8 s; TTS wrapped in `wait_for(2.8 s)` for the
   whole clip (edge-tts takes 1.3 to 4.9 s, so most replies produced **no audio**); LLM 5.5 s, then a canned generic answer.
   Every failure ended in a bare `turn_complete`, so the user saw nothing. Fixes: `config/models.yaml` stt primary is now
   `openai/whisper-large-v3` (turbo second); live voice reuses `voice_stt`; TTS 12 s; LLM 15 s / 20 s; `notice` events
   (`NO_SPEECH`, `TTS_UNAVAILABLE`, `TURN_FAILED`) that the UI shows while keeping the call.

4. **Live voice dropped on idle and never recovered.** No server traffic while the assistant thinks or speaks and the client sends
   nothing (mic muted), so Cloudflare/carrier NAT can drop the socket; frontend `onerror`/`onclose` simply tore down the call and
   ignored close codes 4401/4429. Fixes: server `ping` every 25 s, PCM buffer capped at 60 s, frontend reconnects up to 3 times
   with backoff, `4401` silently falls back to a guest socket (no login modal), `4429` shows the server message.

5. **Frontend watchdogs cut the conversation.** THINKING reset to LISTENING after 9 s (server needs up to 27 s), SPEAKING after 15 s
   (a 4-sentence reply is longer), killing playback mid-sentence and re-opening the mic. Now 45 s / 120 s.

6. **Mic button frontend.** (a) A 401 (stale token) forced the login modal; now a silent guest retry like chat. (b) Recorder mime
   preferred webm everywhere; WebKit now prefers `audio/mp4` (AAC). (c) Every mic error was reported as "permission denied";
   now NotAllowed / NotFound / NotReadable are distinguished with Persian text. (d) The upload used the chat's 90 s timeout, which
   is shorter than the server's worst case; `STT_TIMEOUT_MS = 100 s`. (e) Recordings under 1.5 KB are rejected locally with a clear
   message. (f) Failures are reported to `/client-errors` with `kind=voice_*` (`voice_mic_denied`, `voice_stt_http`,
   `voice_ws_closed`, `voice_ws_4401`, `voice_ws_4429`, `voice_empty_audio`, ...), no audio or text included.

7. **iOS Safari audio.** `unlockSafariAudio()` was an empty function. The AudioContext is created in the click handler (good) but now also
   plays a silent buffer to unlock output, resumes if not `running`, and checks `audioWorklet` support before use.

8. **`/speak`**: `StreamingResponse` (chunked, no Content-Length) replaced by a plain `Response` with `Content-Length` and
   `no-store` (iOS media stack is stricter with chunked audio); 20 s timeout per attempt, one retry, then `fa-IR-DilaraNeural`;
   errors carry `code: TTS_UNAVAILABLE`. The chat UI does not call `/speak` (only live voice uses TTS).

## Not fixed / needs the owner

- Cloudflare `502` seen once on `/speak` while the origin was healthy: check the tunnel/origin health in Cloudflare analytics.
  The retry helpers now cover uploads on network errors; `/speak` has no frontend caller.
- Iranian carriers sometimes block WebSocket upgrades to Cloudflare; the new `voice_ws_closed` beacon (`opened=false`) will show how
  often. A text-based push-to-talk fallback (mic button) already exists.
- Local fallback model is still `base` (poor Persian). Self-hosting `large-v3-turbo` was already proposed in `config/models.yaml`
  and needs a deploy decision (CPU sizing).
- `ASSEMBLYAI_API_KEYS` is unset in prod (the AssemblyAI layer is dead); left in place.
- Dockerfile unchanged on purpose: nothing missing in the runtime stage.

## Tests

`src/test_voice_reliability.py` (offline, httpx `MockTransport`, no model download): registry primary, chain filtering, 429 skip,
422 to multipart, silence vs outage, local fallback off the event loop (ticker keeps running), budget respected, `notice`/keepalive.
`src/test_stt_engine.py`: one test only passed because the old registry chain equalled the default; made it test what it claims.
`scripts/dev/local_ci.sh`: all green after regenerating `docs/SYSTEM_INVENTORY.generated.md`. Frontend `tsc --noEmit` clean.
