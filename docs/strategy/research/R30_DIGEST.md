# R30 DIGEST: phone and voice agent (2026-11-21)

Raw: `docs/strategy/research/R30_RAW.md`. Web tools worked; claims below are VERIFIED unless marked.

## Verified facts
1. LiveKit SIP does not register to a provider (REGISTER "Not Supported"); the provider trunk must send calls to its endpoint. Self-hosted: 5060 plus RTP 10000-20000 must be reachable from the Internet, `use_external_ip`. docs.livekit.io/sip, 2026-11-21.
2. So the "Unregistered" status is in our Asterisk bridge, not LiveKit. Typical cause is NAT/firewall (no reply to REGISTER); Asterisk NAT guide: external signalling/media address, local_net, rtp_symmetric, force_rport.
3. Twilio Germany: inbound $0.0060/min, number $1.35/mo, outbound from $0.0243 (Oct 2026). DIDWW: German DID from $1.50/mo, inbound $0.010/min, outbound from $0.0026. LiveKit tested providers include Twilio, Telnyx, DIDWW.
4. LiveKit Cloud free Build tier: 1,000 agent min and 1,000 third-party SIP min; US numbers only; region pinning only on the $500 Scale plan.
5. STT per hour: Groq Whisper turbo $0.04 (10 s minimum per request, prompt max 224 tokens), v3 $0.111; Deepgram Nova-3 $0.29-0.35 (`fa` listed, $200 free credit); Soniox $0.12 (fa, de, realtime); Speechmatics $0.30-0.80 (EU region selectable); Azure fa-IR and de-DE supported, 5 h/mo free.
6. TTS: no Persian TTS with an EU endpoint among LiveKit Inference models. Azure fa-IR neural voices exist (0.5M chars/mo free). Deepgram Aura-2 $0.03/1k chars.
7. AI Act Art. 50(1)/(5): tell callers they talk to an AI at the latest at first interaction; applies from 2 Aug 2026 (artificialintelligenceact.eu).

## Proposed decisions
- D1: Fix registration in the bridge first (month 1); if it stays flaky, move the German market to an IP-authenticated EU trunk (DIDWW or Twilio Frankfurt) and keep the local trunk for the default market only.
- D2: Replace file-style Whisper with streaming STT after a bake-off (Whisper turbo vs Deepgram vs Soniox vs Azure) on synthetic 8 kHz legal-term audio. Winner needs entity error rate under 10%.
- D3: Replace unofficial edge-tts by official streaming TTS (Azure fa-IR first); keep edge-tts as fallback.
- D4: Entity layer for statute numbers: lexicon + fuzzy match + read-back of numbers + spoken-number normaliser; same repair rules on server.
- D5: Greeting says "AI assistant", "no recording unless you agree". No recording by default.
- D6: Latency target 1.5 s p50 / 2.5 s p95; budget in RAW section 6. Today 4.3-10.2 s.
- Cost per caller-minute: today about 0.001-0.005; proposed stack about 0.02-0.025; managed platform about 0.03-0.06. Per month at 3,000 min: about $5 / $70 / $100-180.

## Owner decisions needed
1. Paid STT/TTS cap (default $50/month hard cap).
2. `DEBUG_RECORD_CALLERS` stays off; consent wording before any recording.
3. Transcript retention (default 30 days, redacted).
4. Approve a German-market EU number later (about $1.5/month).

## Conflicts with existing docs
- `services/voice_phone_agent/README.md` and R18 say "free and local first; revisit paid after T250/T251". The diagnosis shows the free path cannot reach 1.5 s; D2/D3 need a small paid exception.
- R18 T250 Done-when is latency only; it lacks a term-accuracy criterion (diagnosis already flagged it).
- AGENTS.md free-first routing vs a private-data tenant: voice vendors need a no-training setting and a DPA before real callers.
- BOX brief 5.6 says STT is "Groq plus Gemini": Gemini hybrid is off (no key), so STT is Whisper only.

## NOT verified
- Any Persian or German WER on 8 kHz legal speech for any vendor; Deepgram keyterm for non-English; Speechmatics realtime Persian; Azure prices and fa-IR phrase list.
- Telnyx EU rates and credential-registration support (docs 404); DIDWW auth mode and EU media residency; Groq EU region.
- s.201 StGB all-party consent and AI Act Omnibus date for Art. 50(2) (only secondary sources; Official Journal not read).
- Retention periods; edge-tts terms of use.

## Top missed risks (full list of 15 in RAW)
Streaming vs file STT; unofficial TTS endpoint outage; proxy outage means silent calls; free-tier 429 during demos; single trunk/box; debug recording of callers; toll/cost abuse on an open number; vendor training on data; narrowband codec accuracy; accessibility duty.

## Proposed GitHub rows
1. L7: "Phone: fix trunk registration behind NAT". Done when: `pjsip show registrations` shows Registered for 7 days, nightly check alerts on change, runbook in `deploy/README.md`.
2. L7: "Phone STT bake-off on synthetic 8 kHz audio". Done when: a script scores Whisper/Deepgram/Soniox/Azure on the legal-term list in the default language and German, report in `docs/research`, winner chosen by entity error rate and cost.
3. L7: "Phone streaming STT adapter + endpointing". Done when: adapter behind env switch, p50 STT-final under 600 ms, tests green.
4. L7: "Official streaming TTS adapter, edge-tts as fallback". Done when: first audio under 400 ms p50 for the first sentence, automatic fallback tested.
5. L4: "Entity layer: statute title/number fuzzy match, read-back, spoken-number normaliser, parity in `legal_phonetics.py`". Done when: term list reaches under 10% entity error on the nightly test.
6. L7: "Nightly voice test (synthetic audio, 8 kHz)". Done when: it reports stage timings p50/p95, entity error rate, barge-in rate, register state, cost per call, and pages on regression.
7. L4: "Voice compliance: AI greeting, recording consent flow, retention job, DPA/sub-processor entry". Done when: greeting text approved by the lawyer, no recording without opt-in, retention job deletes at the set age, vendors listed.
8. L7: "Phone cost and abuse caps". Done when: per-number and global daily caps, monthly spend cap, alert at 80%.
