# R30 RAW: phone and voice agent for Smart Judge (2026-11-21)

Researcher: Sonnet 5.5 agent, web tools used. Tags: VERIFIED (primary URL fetched 2026-11-21), CHANGED, UNVERIFIED.
Prices are list prices in USD unless stated; vendor pages are the primary source for their own prices. "Default language" = the first market's language; German/English later.
Local inputs read: `docs/research/SMART_JUDGE_PHONE_DIAGNOSIS_2026-11.md`, `services/voice_phone_agent/README.md`, `docs/hub/BOX_HUB_MASTER_BRIEF.md` 5.6, R18, R25, `STT_PERSIAN_OPTIONS_2026-10.md`.

## STAGE 1

### 1. Current stack (repo facts)
- Path: carrier trunk -> Asterisk bridge :5062 -> livekit-sip :5060 -> LiveKit -> Node agent -> Groq Whisper (+ optional Gemini STT) -> Smart Judge SSE -> edge-tts sidecar. Foreign APIs go through a proxy; media/SIP direct.
- Measured 2026-11-13/21: STT 0.5-1.1 s, edge-tts 1.4-2.8 s per sentence, first audio 4.3-10.2 s after caller stops (R18 target 1.5 s p50). 4 of 7 turns had misheard legal terms; Whisper logprob -0.27..-0.48 passed the confidence gate.

### 2. SIP: what the primary sources say
| Claim | Status | Source |
|---|---|---|
| LiveKit SIP does NOT do SIP REGISTER to a provider (feature table: "Not Supported"); the provider trunk must send calls to the LiveKit SIP endpoint (IP/number-restricted inbound trunk) | VERIFIED 2026-11-21 | https://docs.livekit.io/sip/ |
| Tested providers: Twilio, Telnyx, Exotel, Plivo, Wavix, Sinch, didlogic, DIDWW; transports UDP/TCP/TLS, RTP/SRTP | VERIFIED | same |
| Self-hosted SIP: signalling 5060, RTP 10000-20000 must be reachable from the Internet; sample config `use_external_ip: true`; SIP URI = `<public-ip>:5060` | VERIFIED | https://docs.livekit.io/home/self-hosting/sip-server/ |
| Asterisk "Unregistered" with no reply to REGISTER typically means transport/firewall/NAT, not bad credentials; NAT guide uses `external_signaling_address`, `external_media_address`, `local_net`, `rtp_symmetric`, `force_rport` | VERIFIED (docs + forum threads, forum = leads) | https://docs.asterisk.org/Configuration/Channel-Drivers/SIP/Configuring-res_pjsip/Configuring-res_pjsip-to-work-through-NAT |
| Telnyx auth methods (FQDN/IP/credentials), credential registration, EU rates | UNVERIFIED (docs URL 404, pricing page US-only) | - |
| Consequence for us | inference | The "Unregistered" status lives in the Asterisk bridge (the REGISTER client), not in LiveKit. Fix it there, or avoid REGISTER by using an IP-authenticated EU provider that sends calls to a public IP. |

Provider table:
| Provider | $/min in | $/min out (DE) | Number /mo | Free tier | EU residency | Registration / NAT notes |
|---|---|---|---|---|---|---|
| Twilio Elastic SIP | 0.0060 (DE local/mobile) | from 0.0243 | local 1.35 | none | Frankfurt (de1) and Ireland regions listed; media/data residency not stated | VERIFIED https://www.twilio.com/en-us/sip-trunking/pricing/de (Oct 2026). Needs public SIP endpoint. |
| Telnyx | US 0.0032 (DE not shown) | US 0.005 | US 1.00 | none | UNVERIFIED | US list only; DE "by country". |
| DIDWW | 0.010 | from 0.0026 | from 1.50 | none | EU company, DE numbers; residency UNVERIFIED | https://www.didww.com/pricing. Auth mode UNVERIFIED. LiveKit-tested. |
| LiveKit Cloud (3rd-party SIP) | n/a | n/a | one free US number | Build: 1,000 agent min + 1,000 3rd-party SIP min | region pinning only on Scale ($500/mo) | https://livekit.com/pricing; agent minutes $0.01 after included (Ship $50/mo = 5,000). No German numbers listed. |
| Local carrier trunk (current) | contract | contract | contract | n/a | n/a | Only trunk that reaches default-market callers; stays behind NAT. |
Inbound only first: callers dial us; no outbound AI calling (ePrivacy, section 5).

### 3. STT
Prices streaming, per hour unless noted.
| Option | $/h | Persian | German | Keyword boost | Free tier | EU region | Source |
|---|---|---|---|---|---|---|---|
| Groq Whisper large-v3-turbo | 0.04 (10 s min billed) | yes (Whisper) | yes | `prompt` max 224 tokens | free tier exists | UNVERIFIED | https://console.groq.com/docs/speech-to-text . File API, not streaming; 16 kHz mono. |
| Groq Whisper large-v3 | 0.111 | yes | yes | same | - | UNVERIFIED | same |
| Deepgram Nova-3 | 0.288 mono / 0.348 multi (0.0048 / 0.0058 per min) | yes, `fa` under Nova-3 multilingual | yes | keyterm +0.0013/min; non-English support UNVERIFIED | $200 credit | STT EU UNVERIFIED (EU endpoint listed for Aura/Flux via LiveKit) | https://deepgram.com/pricing ; https://developers.deepgram.com/docs/models-languages-overview |
| Speechmatics RT | 0.30-0.80 | `fa` listed for transcription; realtime UNVERIFIED | yes | custom dictionary UNVERIFIED | $100 credit | EU/US/AUS selectable | https://www.speechmatics.com/pricing |
| Soniox | 0.12 + context tokens ($4/M) | yes, realtime | yes | context text | none stated | UNVERIFIED | https://soniox.com/pricing ; https://docs.soniox.com/stt/concepts/supported-languages |
| Gladia live | EUR 0.68 | not named | not named | custom vocabulary | EUR 50 credit | not stated | https://gladia.io/pricing |
| ElevenLabs Scribe realtime | 0.22 | not checked | not checked | not checked | n/a | not stated | https://elevenlabs.io/pricing/api |
| Azure Speech RT | price page shows placeholder; 5 h/mo free | fa-IR supported | de-DE supported | phrase list per locale, UNVERIFIED for fa-IR | 5 h/mo | German regions exist | https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support |
| MAI-Transcribe-2 (OpenRouter) | 0.10 promo to end 2026 | listed | listed | none | - | no | prior doc STT_PERSIAN_OPTIONS (not re-checked) |
| Local whisper.cpp / faster-whisper | 0 | yes | yes | initial prompt | - | on box | no accuracy measured |
No Persian or German WER for any vendor on 8 kHz telephone legal speech was found in a primary source: UNVERIFIED. Must be measured (section 7).

Spoken statute numbers: approaches (design proposals, not vendor claims)
1. Do not trust the transcript for entities. Second pass: a lexicon of statute/circular titles with phonetic and edit-distance matching (begun in `legal-terms.ts`; server `legal_phonetics.py` lacks parity).
2. Constrain with retrieval: give the LLM the top-N fuzzy title/number candidates and let it pick or confirm. Read back only numeric entities: "Article 12 of the X Act, correct?"
3. Normalise spoken numbers to digits in the default language, German and English with a tested normaliser (R18 T251 covers the TTS side only).
4. Boosting where supported (Whisper prompt tail <=224 tokens, most important last; Deepgram keyterm; Soniox context; Azure phrase list). Weak lever, as the diagnosis showed.
5. Confidence: use per-word confidence where available; below a threshold ask to confirm instead of guessing. Whisper segment logprob did not separate good from bad (-0.27..-0.48).
6. Two-vendor vote only on turns whose entity-match score is low.

### 4. TTS
| Option | Price | Free tier | Persian | EU | Notes |
|---|---|---|---|---|---|
| edge-tts (current, unofficial Microsoft endpoint) | 0 | - | yes | via proxy | 1.4-2.8 s/sentence measured; unofficial, no SLA; terms status UNVERIFIED |
| Azure neural (fa-IR-DilaraNeural / FaridNeural) | page placeholder | 0.5M chars/mo | yes | German regions | official; price UNVERIFIED |
| Deepgram Aura-2 | $0.030/1k chars (Aura-1 0.015) | $200 credit shared | not on LiveKit Persian list | EU via LiveKit Inference | |
| ElevenLabs Flash/Turbo | $0.04/1k chars | amount not stated | not checked | none stated | |
| Inworld TTS-2 / Flash | $25 / $15 per 1M chars | 70 min | not named | EU only Enterprise | |
| Cartesia Sonic | overage $38-65 per 1M credits | 20k credits/mo | not confirmed | EU endpoint via LiveKit Inference | no latency claim on pricing page |
| Gemini 3.8 flash TTS | ~$0.50 in / $9 out per M tokens (OpenRouter figure, prior doc) | - | yes (LiveKit list) | no EU endpoint | https://docs.livekit.io/agents/models/tts/ |
| Local (Piper etc.) | 0 | - | UNVERIFIED | on box | R18 T251 |
Persian TTS with an EU endpoint: none among LiveKit Inference models (VERIFIED list, 2026-11-21).

### 5. Regulation (EU)
- AI Act Art. 50(1): people interacting with an AI system must be told it is AI unless obvious; 50(5): at the latest at first interaction, clear and accessible; applies from 2 Aug 2026. VERIFIED https://artificialintelligenceact.eu/article/50/ . Law-firm sources say the Digital Omnibus moved only the Art. 50(2) marking duty to 2 Dec 2026 (secondary; Official Journal not read: UNVERIFIED). A phone voice is not "obviously" AI, so say it in the greeting.
- Germany s.201 StGB: recording a non-public conversation without authorisation is an offence; all-party consent is the common reading; applies to AI agents too. SECONDARY ONLY (commentary and vendor blogs); UNVERIFIED against the statute text.
- GDPR: call audio and transcripts are personal data; Art. 13 notice at call start, a legal basis (consent, or documented legitimate interest for transcripts), Art. 28 contracts with STT/TTS/LLM vendors, retention limit, deletion on request. No statutory retention number found: set a short policy value.
- ePrivacy Art. 13: automated calling for direct marketing needs prior consent (secondary source). We do inbound only.
- Do not record by default. `DEBUG_RECORD_CALLERS` needs an owner decision and consent wording.

### 6. Latency budget (speech end -> first spoken word), target <= 1.5 s p50, <= 2.5 s p95
| Stage | Target ms | Measured now | Lever |
|---|---|---|---|
| Endpointing (VAD hangover + semantic) | 250-400 | not separated | tune hangover |
| STT final | 300-600 | 500-1100 | streaming STT, not file Whisper |
| Brain to first sentence (retrieval + LLM) | 500-700 | 2,700-8,700 incl. STT | cache, small model for first sentence, no escalation on the voice path |
| TTS first audio | 150-300 | 1,400-2,800 | streaming TTS, first-clause flush |
| Carrier/jitter/RTP | 100-200 | unknown | EU media near caller |
| Filler/ack audio | 0 added | cached | play at 600 ms if brain is slow |
Sum of targets about 1.3-2.2 s. Today 4.3-10.2 s. Filler masks the wait but does not fix it.

### 7. Nightly voice tests: what to measure
- Per turn timestamps: speech_end, stt_final, brain_first_token, brain_first_sentence, tts_first_byte, first_audio_out (p50/p95).
- Term accuracy on a fixed list of statute/circular names and numbers, read by TTS voices, degraded to 8 kHz G.711 with noise, in the default language, German and English: entity error rate and number error rate.
- Answer correctness against the golden set in voice mode (R25 clean-text vs transcript recall gap).
- Barge-in false/missed rate; echo-removal drop rate.
- Call lifecycle: SIP register state, setup success, one-way audio, hang-up cleanup, concurrency cap, cost per call.
- Provider canaries: STT/TTS errors, rate limits, free-tier exhaustion.
- Synthetic audio only; no real caller audio in git.

## STAGE 2: skeptical review

### Claims table
| Claim | Source | Date | Status |
|---|---|---|---|
| LiveKit SIP has no REGISTER | docs.livekit.io/sip | 2026-11-21 | VERIFIED |
| SIP 5060 + RTP 10000-20000 public | LiveKit self-hosting docs | 2026-11-21 | VERIFIED |
| Twilio DE in 0.0060, number 1.35, out from 0.0243 | Twilio DE pricing | Oct 2026 | VERIFIED |
| Deepgram Nova-3 0.0048/0.0058 per min, fa listed, $200 credit | deepgram pages | 2026-11-21 | VERIFIED |
| Groq turbo $0.04/h, v3 $0.111/h, 10 s min, prompt 224 tokens | Groq docs | 2026-11-21 | VERIFIED |
| Speechmatics $0.30-0.80/h, EU region choice | pricing page | 2026-11-21 | VERIFIED |
| Soniox $0.12/h realtime fa+de | pricing + docs | 2026-11-21 | VERIFIED |
| AI Act Art 50 from 2 Aug 2026 | artificialintelligenceact.eu | 2026-11-21 | VERIFIED; 50(2) date CHANGED to 2 Dec 2026 per secondary sources |
| s.201 StGB all-party consent | blogs | - | UNVERIFIED |
| Azure price | page placeholder | - | UNVERIFIED |
| Telnyx EU rates/registration | 404 | - | UNVERIFIED |
| Telephone-audio WER for Persian, any vendor | none found | - | UNVERIFIED |

### Missed risks (15)
1. Streaming vs file STT: Groq Whisper is request/response; real streaming STT (Deepgram/Soniox) cuts 0.3-0.8 s and lets the LLM start early.
2. The unofficial edge-tts endpoint can break or be blocked any day; no SLA. An outage kills the product.
3. Foreign APIs go through a proxy from the edge box: a proxy outage means a silent line. Needs a health probe and a fallback prompt.
4. Free tiers (Groq, Azure 5 h, Cartesia 20k) throttle during demos; a 429 looks like a dead call. Needs rate-limit handling and a paid fallback.
5. One carrier trunk, one box, no failover number.
6. Spoken legal answers read as advice: need a spoken disclaimer and no false certainty on numbers.
7. Prompt injection by voice and by retrieved text; caller-ID spoofing if identity is assumed.
8. `DEBUG_RECORD_CALLERS` left on is a GDPR/s.201 risk; audio and logs need retention and access control.
9. Public number with no auth: toll fraud and cost abuse; need a per-number and a global daily cap (gateway cap exists, PR #799).
10. G.711 8 kHz audio versus models trained on wider band; test codecs, prefer wideband where the carrier allows.
11. Spoken numbers and dates (different calendars, law numbering styles) in the default language; digits vs words in TTS output (T251).
12. Vendor terms: some free tiers train on data; a DPA, sub-processor list and no-training setting are needed before real callers; the free-first policy conflicts with a private-data tenant.
13. LiveKit Cloud is US-centred, has no German number and EU pinning only at $500/mo if the box is ever retired.
14. Accessibility (Art. 50(5)) and hearing-impaired callers: no text alternative on the phone line; point to chat.
15. Surcharges: Deepgram keyterm, Soniox context tokens, Groq 10 s minimum billing per short turn.

### Decision pack
Options: A) keep Groq Whisper + edge-tts, fix registration, add entity repair (cheap, slow, brittle). B) streaming STT (Deepgram Nova-3 or Soniox) + official TTS (Azure fa-IR) (small cost, faster, official). C) fully local STT/TTS on the box (zero per-minute, hardware-limited, accuracy unknown). D) managed platform (LiveKit Cloud agents or similar) (fast to ship, costly, no default-market trunk).
Recommendation: B in stages, A as baseline, C measured as the free fallback; D rejected for now. No option is promoted without the nightly term-accuracy test.

Cost per caller-minute (approximate, list prices; Azure TTS price UNVERIFIED, assumed ~$16/M chars):
- A today: STT 0.0007 + LLM small = about 0.001-0.005.
- B: Deepgram 0.0058 (+0.0013 keyterm) + TTS about 0.014 (900 chars/min of reply speech at the assumed rate) + LLM about 0.002 = about 0.02-0.025.
- C: about 0 variable (box power).
- D: LiveKit 0.01 + STT + TTS + trunk = about 0.03-0.06.
Per month at 300 / 3,000 / 20,000 caller-minutes: A $1 / $5 / $30; B $7 / $70 / $450 (Deepgram $200 credit covers about 43,000 STT minutes); D $10-20 / $100-180 / $600-1,200 plus $50-500 plan.
Effort: B 3-5 agent-days (STT adapter, endpointing, streaming TTS adapter, tests). Reversibility: high (adapter interface, env switch). One-off cost: none beyond sign-ups; EU DID about $1.35-1.50/mo.

Plan: Month 1 = fix registration/NAT in the Asterisk bridge (or IP-auth EU trunk), AI + recording notice in the greeting, bake-off Whisper vs Deepgram vs Soniox on synthetic 8 kHz audio. Month 3 = adopt winning streaming STT, official TTS, number normaliser, nightly voice tests live. Month 6 = German/English packs and an EU number, DPA and sub-processor list, cost caps. Month 12 = decide local vs paid STT/TTS, add second carrier and failover.
Revisit triggers: p50 first audio > 2.5 s for 7 nights; entity error rate > 10% on the term list; cost > $0.05/min; any vendor ToS or privacy change; first tenant with the private data option.

### Open questions for human experts (default)
1. German lawyer: are an AI notice plus opt-in recording enough under s.201 StGB and GDPR for a legal-information line? Default: no recording by default; notice only; consent before any recording.
2. DPO: retention for transcripts. Default: 30 days, redacted, then delete.
3. Telecom lawyer: number-use and bridging rules for the German market. Default: local trunk for the default market only; an EU number for Germany.
4. Owner: allow `DEBUG_RECORD_CALLERS`? Default: off.
5. Owner: paid STT/TTS cap. Default: $50/month hard cap.
6. Native-speaker panel to rate TTS naturalness. Default: 5 listeners, blind test.
