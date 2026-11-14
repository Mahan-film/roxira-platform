# Smart Judge phone agent (edge)

Persian voice agent for the Smart Judge phone line. Runs on the edge box in Iran (WSL2 Ubuntu),
next to a local LiveKit stack, not on srv1.

```
caller ─ Sabanet SIP ─ Asterisk bridge :5062 ─ livekit-sip :5060 ─ LiveKit :7880 (room call-*)
                                                                        │
             agent: AudioStream 16 kHz ─ energy VAD ─ STT (Groq Whisper, via proxy)
                                                     └─ Smart Judge /chat/stream (direct, SSE, voice mode)
                                                          └─ sentence splitter ─ TTS (edge-tts sidecar, via proxy)
                                                               └─ 48 kHz PCM ─ AudioSource (10 ms frames)
```

- **Turn taking:** energy VAD with adaptive noise floor; barge-in after `BARGE_IN_MS` of caller speech
  flushes playback and aborts the in-flight STT/LLM/TTS turn.
- **Latency masking:** greeting, filler and error prompts are synthesized once and cached as PCM (`cache/`).
- **Brain:** `POST /api/v1/apps/judge/chat/stream` with `{message, is_voice_mode: true, history}`;
  the phone line authenticates with `X-Phone-Gateway-Key` (own daily cap, see PR #799).
- **Network rule:** LiveKit/SIP media and Smart Judge are always direct. Only foreign APIs (Groq, OpenAI,
  Microsoft TTS) go through `PROXY_URL`; the proxy is chosen per request in `src/http.ts`, never by env.
- **Lifecycle:** joins only rooms with a `sip_` participant; ends on caller hang-up, idle timeout or max
  duration (deletes the room so livekit-sip sends BYE); `MAX_CONCURRENT_CALLS` then a busy prompt.

## Run

```bash
python3 -m venv ../.venv && ../.venv/bin/pip install edge-tts
npm ci && npm run build
cp .env.example .env && chmod 600 .env       # keys come from SECRETS_ENV_FILE, never from git
sudo cp deploy/*.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now voice-ai-tts voice-ai-agent
journalctl -u voice-ai-agent -f -o cat
```

`npm run build && node dist/smoke.js "سؤال"` checks TTS → VAD → STT → Smart Judge → TTS without a call.
Unit files assume user `mahan` and `/home/mahan/voice-ai/agent`; adjust on another box.
Measured on 2026-11-13: Groq STT ~0.9 s, edge-tts 1.6–2.8 s per sentence, ~200 MB RSS.
