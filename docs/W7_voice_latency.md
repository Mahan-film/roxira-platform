# W7 — تأخیر (Latency) مشاوره صوتی زنده

این سند به فارسی است؛ کد، کامیت‌ها و مستندات فنی به انگلیسی باقی می‌مانند (طبق CLAUDE.md).

## ۱. مسیر فعلی (STT → LLM → TTS)

مسیر واقعی، وب‌سوکت `/api/v1/apps/judge/live-voice` است که در
`output_apps/ecosystem_core/src/factory/smartjudge_live_voice.py` پیاده‌سازی
شده (نه فایل‌های قدیمی‌تر زیر `src/legal_intelligence/`). `run_unified_server.py`
و `smartjudge_module.py` همین روتر را include می‌کنند.

```
مرورگر (میکروفون، PCM)
   │  websocket: بایت‌های PCM پشت‌سرهم، سپس پیام {"type":"commit"}
   ▼
live_voice_websocket()  ──►  pcm_to_wav()
   │
   ▼
transcribe_audio_payload()          [STT]
   OpenRouter Whisper (openai/whisper-large-v3-turbo)
   fallback: انجین محلی stt_engine.transcribe_audio_blob
   │  متن فارسی
   ▼
analyze_legal_query()               [LLM]
   (اختیاری) aquery_knowledge_graph  — بازیابی قوانین/آراء، timeout=2s
   OpenRouter chat/completions، مدل deepseek/deepseek-chat، max_tokens=190
   │  پاسخ فارسی ۲ تا ۴ جمله‌ای
   ▼
synthesize_speech_persian()         [TTS]
   edge-tts، صدای fa-IR-DilaraNeural، rate=+15%
   │  base64 یک کلیپ صوتی کامل
   ▼
پیام‌های وب‌سوکت به مرورگر:
   user_transcription → agent_text_response → agent_audio_stream → (turn_complete در صورت خطا)
```

نکات کلیدی مسیر فعلی:
- تماس LLM **استریم نیست** (یک درخواست HTTP مسدودکننده با `urllib`، نه SSE).
  یعنی «اولین توکن» و «کل پاسخ» عملاً هم‌زمان آماده می‌شوند.
- edge-tts داخلاً استریم می‌کند، اما کد فعلی همهٔ chunkها را جمع می‌کند و فقط
  یک کلیپ کامل base64 برمی‌گرداند — یعنی کاربر تا پایان تولید کل صدا چیزی
  نمی‌شنود.
- وب‌سوکت خودش از همان ابتدا از چند پیام صوتی در یک نوبت پشتیبانی می‌کند
  (فرانت‌اند هر `agent_audio_stream` را به‌ترتیب `await playAudio()` می‌کند) —
  بنابراین استریم‌کردن صدا نیازی به تغییر فرانت‌اند نداشت.

## ۲. حدس اولیه: زمان کجا می‌رود (از روی خواندن کد)

| مرحله | تخمین اولیه | چرا |
|---|---|---|
| STT | ۱–۳ ثانیه | یک درخواست HTTP سنکرون به OpenRouter با `timeout=8s`؛ آپلود کل فایل WAV یک‌جا |
| LLM | ۱–۳ ثانیه | یک درخواست غیراستریم با `timeout=5.5s`؛ گاهی + تا ۲s بازیابی گراف دانش قبل از آن |
| TTS | ۰.۵–۱.۵ ثانیه | edge-tts با `timeout=2.8s`؛ کل پاسخ (۲ تا ۴ جمله) یک‌جا سنتز می‌شود |
| مجموع | معمولاً بالای ۲ ثانیه | سه مرحله کاملاً پشت‌سرهم (sequential)، بدون هیچ همپوشانی |

بزرگ‌ترین اتلاف واحد: **عدم استریم LLM و TTS** — کاربر تا پایان کامل پاسخ
متنی و سپس پایان کامل سنتز صدا چیزی نمی‌شنود. این دقیقاً همان چیزی است که
بخش «TTS استریمی» (بخش ۴) هدف قرار داده.

## ۳. اندازه‌گیری (VOICE_TIMING_LOG)

هر سه مرحله اکنون زمان‌بندی می‌شوند و به‌صورت یک خط JSON ساختاریافته لاگ
می‌شوند (`output_apps/ecosystem_core/src/factory/voice_timing.py`، لاگر
`voice.timing`). **هیچ متن رونوشت یا پاسخی لاگ نمی‌شود** — فقط نام مرحله و
عدد میلی‌ثانیه:

- `stt_ms` — کل زمان `transcribe_audio_payload`
- `llm_first_token_ms`, `llm_total_ms` — در مسیر غیراستریم این دو برابرند؛
  در مسیر استریمی (`VOICE_STREAM_TTS=1`) اولی زمان واقعی رسیدن اولین توکن است
- `tts_first_byte_ms`, `tts_total_ms` — اولین chunk صوتی edge-tts در برابر کل کلیپ
- `end_to_end_ms` — کل یک نوبت (turn)، از پایان دریافت صدای کاربر تا پایان ارسال پاسخ

پرچم محیطی `VOICE_TIMING_LOG` این لاگ‌ها را کنترل می‌کند (پیش‌فرض: روشن).
مقادیر `0`/`false`/`off`/`no` آن را خاموش می‌کنند. این پرچم فقط لاگ اضافه
می‌کند و رفتار مسیر صوتی را تغییر نمی‌دهد.

## ۴. اجرای بنچمارک روی سرور

`scripts/voice_latency_bench.py` تعدادی درخواست فارسی مصنوعی (متنی، بدون
میکروفون) را از همان توابع pipeline عبور می‌دهد و p50/p95 هر مرحله را چاپ
می‌کند.

اجرای واقعی روی سرور (نیازمند `OPENROUTER_API_KEY` و بسته `edge-tts` که در
کانتینر `roxira_app_prod` نصب است؛ owner-run طبق docs/STRATEGY.md §7):

```bash
ssh 5.75.200.67
cd /opt/roxira_platform
docker exec --env-file .env -w /app roxira_app_prod \
    python3 scripts/voice_latency_bench.py --n 20

# مسیر استریمی (VOICE_STREAM_TTS) را هم بسنجید:
docker exec --env-file .env -w /app roxira_app_prod \
    python3 scripts/voice_latency_bench.py --n 20 --stream
```

حالت آفلاین (بدون کلید، بدون شبکه — برای CI و تست محلی):

```bash
python3 scripts/voice_latency_bench.py --n 20 --offline
```

این بنچمارک مرحله STT را نمی‌سنجد (ورودی متنی است، نه صوتی)؛ `stt_ms` واقعی
را باید از لاگ‌های `voice.timing` روی ترافیک زنده خواند.

## ۵. TTS استریمی (VOICE_STREAM_TTS)

پرچم `VOICE_STREAM_TTS` (پیش‌فرض: خاموش) دو تغییر را فعال می‌کند:

1. **پاسخ LLM با SSE واقعی خوانده می‌شود** (`analyze_legal_query_streaming`،
   با `httpx.AsyncClient.stream`، چون `httpx` از قبل وابستگی پروژه است) —
   به‌جای یک درخواست مسدودکننده.
2. متن دریافتی در مرزهای جمله فارسی (`. ؟ ! ۔` و خط جدید) تکه‌تکه می‌شود
   (`output_apps/ecosystem_core/src/factory/persian_text.py`) و به‌محض کامل
   شدن هر جمله، `synthesize_speech_persian` روی همان جمله صدا می‌شود و بلافاصله
   یک پیام `agent_audio_stream` برای همان جمله ارسال می‌شود — یعنی جملهٔ اول
   شنیده می‌شود درحالی‌که جملات بعدی هنوز تولید/سنتز می‌شوند.

تابع `split_persian_sentences` روی اعداد اعشاری (`۱۲.۵`) و چند مخفف رایج
حقوقی (`ق.م`، `ه.ش`، ...) خطا نمی‌کند — تست‌های واحد در
`src/factory/test_persian_sentence_split.py`.

در صورت خطای شبکه/SSE، مسیر استریمی به‌طور خودکار به تماس غیراستریمی
(`_analyze_legal_query_impl`) سقوط می‌کند تا نوبت هرگز بی‌پاسخ نماند.

انتقال (وب‌سوکت) از قبل از چند پیام صوتی در هر نوبت پشتیبانی می‌کرد، پس این
قابلیت نیازی به تغییر فرانت‌اند نداشت — فقط پشت پرچم است چون هنوز روی ترافیک
واقعی سنجیده نشده.

## ۶. هدف و گام‌های بعدی

**هدف:** p50 زیر ۲ ثانیه برای کل نوبت (`end_to_end_ms`).

گام‌های بعدی (به ترتیب اولویت پیشنهادی):
1. اجرای `voice_latency_bench.py` و بررسی چند روز لاگ `voice.timing` روی
   سرور برای گرفتن اعداد واقعی p50/p95 هر مرحله (owner-run).
2. اگر STT گلوگاه اصلی بود: بررسی جایگزینی با یک ارائه‌دهنده استریمی
   (Deepgram Nova-3 یا `gpt-4o-transcribe`، هر دو فارسی را پشتیبانی می‌کنند —
   docs/research/TECH_CURRENCY_2026-09.md) به‌جای آپلود کل فایل صوتی.
3. روشن‌کردن `VOICE_STREAM_TTS` روی سرور و مقایسهٔ p50 قبل/بعد.
4. اگر بازیابی گراف دانش (`aquery_knowledge_graph`, timeout=2s) سهم زیادی
   از زمان LLM را می‌گیرد: کش کردن پاسخ‌های پرتکرار در Redis (هم‌راستا با
   W5) یا کاهش timeout.
5. بعد از پایدارشدن، این معیارها را به W13 (کنترل هزینه/گزارش هفتگی) متصل کنید.
