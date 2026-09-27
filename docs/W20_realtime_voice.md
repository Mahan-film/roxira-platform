# W20 — مشاوره صوتی زنده: تشخیص و مسیر بعدی

## ۱. تشخیص، با شاهد

**علت اصلی بی‌صدایی کامل:** `edge-tts` هرگز در `Dockerfile.prod` نصب نشده
(نه در `pip install`، نه در `pyproject.toml`). روی سرور (`roxira_app_prod`،
بررسی فقط‌خواندنی): `pip show edge-tts` → *Package(s) not found*. یعنی
`synthesize_speech_persian()` در ۱۰۰٪ نوبت‌ها با `ModuleNotFoundError` مواجه
می‌شود، `except Exception: return ""` بی‌صدا آن را می‌بلعد (بدون لاگ)، و
سرور به‌جای صدا فقط `turn_complete` می‌فرستد. تعمیر: `edge-tts` به
`Dockerfile.prod` اضافه شد + یک `print("[TTS-WARN] ...")` تا خرابی بعدی در
`docker logs` دیده شود.

**باگ دوم (کشف‌شده، نه هنوز روی ترافیک واقعی): مسیر Gemini مرده بود.**
`gemini_live_bridge.py` از قبل در ریپو بود و یک `APIRouter` مستقل با همان
مسیر `/api/v1/apps/judge/live-voice` تعریف می‌کرد. `run_unified_server.py`
هر دو روتر را بدون قید mount می‌کرد؛ چون Starlette مسیرها را به ترتیب ثبت
match می‌کند و `live_voice_router` (کد آبشاری STT/LLM/edge-tts) زودتر ثبت
می‌شد، هندلر Gemini هرگز اجرا نمی‌شد. حتی اگر می‌شد، PCM خام (بدون
container) می‌فرستاد که `ctx.decodeAudioData` در مرورگر نمی‌تواند آن را
دیکد کند — یعنی همان دسته باگ «format/mime» که در این تسک اشاره شده بود.

**نوبت‌گیری:** با بررسی کد فعلی، مسیر `turn_complete` از سرور صحیح بود، ولی
فرانت هر پیام صوتی جدید را با `.stop()` روی پیام قبلی جایگزین می‌کرد — یعنی
در مسیر استریمی (چند جمله در یک نوبت) فقط آخرین تکه شنیده می‌شد، و هیچ
watchdog‌ای برای حالت `SPEAKING` نبود (فقط `THINKING`)، پس یک خطای دیکد یا
پیام گم‌شده می‌توانست میکروفون را برای همیشه خاموش نگه دارد.

nginx (`/api/v1/apps/judge/live-voice`): هدرهای `Upgrade`/`Connection`
درست‌اند، `proxy_read_timeout 86400s` — این بخش سالم است (شاهد لاگ: اتصال
websocket با `[accepted]` ثبت می‌شود).

## ۲. گزینه‌های ۲۰۲۶-۰۹، کیفیت فارسی در اولویت

| گزینه | کیفیت fa-IR | تأخیر | هزینه/دقیقه | دسترسی از ایران |
|---|---|---|---|---|
| **Gemini Live (`gemini-3.8-live`)** | خوب، صوت بومی، ۷۰+ زبان | کم (WebSocket دوطرفه، VAD سمت سرور) | ~$0.023 (in $0.005 + out $0.018) | فقط سرور آلمان تماس می‌گیرد؛ کلید هرگز به مرورگر ایران نمی‌رود |
| OpenAI Realtime (`gpt-realtime`) | خوب | کم | مستند نشد در این پژوهش (قیمت رسمی صریح یافت نشد) | مالک کلید OpenAI مستقیم ندارد؛ فقط از طریق OpenRouter که این مدل realtime را ندارد |
| LiveKit Agents / Pipecat + STT/LLM/TTS خودمان | به کیفیت TTS انتخابی وابسته | افزوده هر مرحله (کاسکید) | متغیر، جمع‌شونده | امکان‌پذیر، ولی همان معماری فعلی با پیچیدگی زیرساخت بیشتر (SFU/اتاق) |
| TTS فارسی بهتر از Edge-TTS (مستقل) | بدون صدای بومی طبیعی مکالمه‌ای؛ فقط یک مرحله | کاسکید همچنان کند | صفر تا کم | همین edge-tts رایگان و از قبل جواب می‌دهد؛ سوییچ TTS به‌تنهایی معماری کاسکید را رفع نمی‌کند |

منابع: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)،
[ai.google.dev/gemini-api/docs/live-api](https://ai.google.dev/gemini-api/docs/live-api)،
مستندات LiveKit/Pipecat (جست‌وجوی وب، بدون تأیید رسمی fa-IR).

## ۳. تصمیم

**Gemini Live، پشت پرچم `VOICE_REALTIME_PROVIDER=gemini` (پیش‌فرض خاموش).**
دلیل: تنها گزینه‌ای که owner از قبل کلید معتبر آن را دارد (`GEMINI_API_KEY`
در `.env` سرور، ۲۰۲۶-۰۹-۲۶ تأیید شد)، فارسی را بومی پشتیبانی می‌کند، تک‌مرحله
است (نه کاسکید STT→LLM→TTS با سه‌برابر تأخیر)، و چون فقط بک‌اند آلمان با
Google تماس می‌گیرد (نه مرورگر کاربر ایرانی)، ریسک تحریم/فیلترینگ کمتر از
اتصال مستقیم مرورگر است. مدل: `gemini-3.8-live` (نه نسخه
`-extended-thinking`، که تأخیر استدلال اضافه می‌کند و برای این مسیر لازم
نیست — استناد حقوقی از همان `aquery_knowledge_graph` موجود در هر نوبت به‌عنوان
یک پیام متنی `turn_complete=False` تزریق می‌شود، نه system prompt ثابت).
مسیر آبشاری فعلی (تعمیرشده) پیش‌فرض باقی می‌ماند تا این مسیر روی سرور تأیید
شود.

**بارج-این:** VAD سمت سرور Gemini (پیش‌فرض روشن) قطع خودکار پاسخ مدل با
شنیدن صدای کاربر را انجام می‌دهد؛ پیام `commit`/`speech_end` فرانت هم به
`audio_stream_end` ترجمه می‌شود تا نوبت زودتر از timeout سکوت Gemini بسته
شود.

## ۴. استقرار

۱. owner: `pip install edge-tts google-genai` را روی build بعدی تأیید کند
   (در `Dockerfile.prod` این PR اضافه شد؛ نیاز به rebuild ایمیج دارد).
۲. owner: مطمئن شود کانتینر `GEMINI_API_KEY` را از `.env` واقعاً inherit
   می‌کند (بررسی این تسک نشان داد امروز فقط `OPENROUTER_API_KEY` در
   `os.environ` کانتینر بود؛ یا ریستارت کانتینر با `.env` به‌روز، یا اجرای
   دستی با `--env-file .env`، طبق docs/W7_voice_latency.md).
۳. تست دستی روی staging/owner-run: `VOICE_REALTIME_PROVIDER=gemini` را برای
   چند تماس آزمایشی روشن کنید و `voice.timing` (`stage=turn، provider=gemini`)
   را ببینید. تماس زنده کامل در این PR اجرا نشد (بلاک شد توسط سیاست sandbox
   همین نشست)، فقط `client.models.list()` فقط‌خواندنی.
۴. در صورت رضایت، پیش‌فرض را روی `gemini` بگذارید و مسیر آبشاری را به‌عنوان
   fallback نگه دارید.
