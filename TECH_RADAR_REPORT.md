# 🛰️ گزارش رادار فناوری ROXIRA

- **موضوع پژوهش:** latest 2026 open-source AI agent frameworks and fast speech-to-text models
- **حالت اجرا:** `deep`
- **زمان تولید (UTC):** 2026-09-11T16:17:38+00:00
- **مدل سنتز:** `deepseek/deepseek-v4.1-flash`
- **تعداد منابع تحلیل‌شده:** 10
- **وضعیت:** `SUCCESS`

## خلاصه مدیریتی
در سال ۲۰۲۶ اکوسیستم متن‌باز عوامل هوش مصنوعی و تشخیص گفتار به بلوغ تولیدی رسیده است؛ به‌طوری‌که چارچوب‌هایی مانند Pipecat، LiveKit Agents و TEN Framework با هزاران ستاره گیت‌هاب، معماری خط لوله STT→LLM→TTS را به یک استاندارد عملی تبدیل کرده‌اند. در سمت تشخیص گفتار، مدل‌های متن‌باز (Whisper، NVIDIA Canary، Parakeet، Moonshine) و سرویس‌های تجاری (Deepgram Nova-3 با WER حدود ۵.۲۶٪ و تأخیر زیر ۳۰۰ms) انتخاب را به تعادل دقت/تأخیر/هزینه گره زده‌اند. برای سنتز گفتار، Kokoro، Chatterbox-Turbo، Orpheus و Higgs Audio V2 با مجوزهای Apache 2.0/MIT جایگزین عملی APIهای تجاری شده‌اند. پروژه OpenClaw با عبور از ۲۱۰٬۰۰۰ ستاره به پدیده غالب مخازن متن‌باز ۲۰۲۶ تبدیل شده، هرچند نگرانی‌های امنیتی جدی درباره مجوزهای گسترده آن مطرح است. جمع‌بندی راهبردی: ترکیب چندمدلی (multi-model) و خودمیزبانی، مسیر پیشنهادی برای تیم‌های تولیدی در حوزه‌های تنظیم‌شده است.

## یافته‌های کلیدی
- Pipecat با ۱۳٬۴۱۶ ستاره، مجوز BSD-2-Clause و رسیدن به نسخه پایدار v1.0 در آوریل ۲۰۲۶، قوی‌ترین گزینه متن‌باز عمومی برای ساخت عامل صوتی تولیدی معرفی می‌شود؛ LiveKit Agents با ۱۱٬۳۵۶ ستاره و پشتیبانی بومی SIP برای مقیاس و TEN Framework با ۱۰٬۸۹۸ ستاره برای ارکستراسیون گراف چندوجهی برجسته‌اند.
- در تشخیص گفتار، Deepgram Nova-3 با WER میانه ۵.۲۶٪ در حالت streaming و تأخیر زیر ۳۰۰ms، AssemblyAI Universal-3 Pro با WER میانگین ۵.۶٪ (میانه ۴.۹٪) و ElevenLabs Scribe v2 با حدود ۱۵۰ms نخستین partial، سه سرگروه دقت/تأخیر هستند.
- دقت STT شدیداً وابسته به شرایط صوتی است: یک تحلیل Deepgram نشان می‌دهد همان API روی هدست تمیز ۹۲٪ دقت دارد اما در اتاق کنفرانس به ۷۸٪ و در تماس موبایل پرنویز به ۶۵٪ سقوط می‌کند؛ WER برای لهجه‌های شدید می‌تواند به ۳۰–۵۰٪ برسد.
- بازار TTS متن‌باز با مدل‌هایی مانند Kokoro (۸۲ میلیون پارامتر، Apache 2.0)، Chatterbox-Turbo (MIT)، Orpheus (Apache 2.0) و Higgs Audio V2 (حدود ۵.۸ میلیارد پارامتر، Apache 2.0) شکاف با APIهای تجاری را به‌سرعت پر کرده و برای صنایع تنظیم‌شده (HIPAA/GDPR) خودمیزبانی را ممکن می‌سازد.
- OpenClaw به‌عنوان سریع‌ترین پروژه در حال رشد تاریخ گیت‌هاب شناخته می‌شود که از ۹٬۰۰۰ به بیش از ۲۱۰٬۰۰۰ ستاره جهش کرده؛ اما محققان امنیتی درباره مجوزهای گسترده و نبود بررسی دقیق مخزن مهارت‌ها (skills) هشدار داده‌اند.

## فناوری‌های نوظهور و روندها
### Pipecat — `growing`
- **دسته:** framework — voice agent
- **توضیح:** چارچوب پایتونی که مکالمه را به‌صورت خط لوله (audio in → STT → LLM → TTS → audio out) مدل می‌کند و نسخه پایدار v1.0 را در آوریل ۲۰۲۶ منتشر کرده است.
- **اهمیت:** کتابخانه یکپارچه‌سازی گسترده (Deepgram، AssemblyAI، OpenAI، Gemini، Cartesia، ElevenLabs) تعویض فروشنده را به تغییر یک خط کد تبدیل می‌کند.
- **شاهد پذیرش:** ۱۳٬۴۱۶ ستاره گیت‌هاب در ۱۴ جولای ۲۰۲۶ و توسعه تقریباً روزانه

### LiveKit Agents — `growing`
- **دسته:** framework — realtime voice
- **توضیح:** چارچوب چندزبانه (Python/Node) با مجوز Apache-2.0 و پشتیبانی بومی از SIP و شماره تلفن واقعی.
- **اهمیت:** برای بارهای همزمان بالا (نمونه واقعی جهش از ۲۰ به ۴۰۰ تماس همزمان) انتخاب ترجیحی است.
- **شاهد پذیرش:** ۱۱٬۳۵۶ ستاره گیت‌هاب در جولای ۲۰۲۶ و کاربری در پروژه‌های مقیاس‌پذیر

### TEN Framework — `growing`
- **دسته:** framework — multimodal graph
- **توضیح:** چارچوب چندزبانه (C/Go/Python/JS) با مجوز Apache-2.0 ترکیبی و اتصال از طریق Agora RTC، مبتنی بر ارکستراسیون گراف چندوجهی.
- **اهمیت:** برای سناریوهای multimodal و edge که به ارکستراسیون پیچیده نیاز دارند مناسب است.
- **شاهد پذیرش:** ۱۰٬۸۹۸ ستاره گیت‌هاب در جولای ۲۰۲۶

### OpenClaw — `emerging`
- **دسته:** agent — self-hosted personal assistant
- **توضیح:** دستیار هوش مصنوعی شخصی که کاملاً روی دستگاه کاربر اجرا می‌شود، به بیش از ۵۰ یکپارچه‌سازی (WhatsApp، Telegram، Slack، Discord، Signal، iMessage) متصل است و می‌تواند مهارت جدید خودش را بنویسد.
- **اهمیت:** داده کاربر از دستگاه خارج نمی‌شود و مدل «خودمیزبان + خودافزا» را به سطح محصول شخصی برده است.
- **شاهد پذیرش:** جهش از ۹٬۰۰۰ به بیش از ۲۱۰٬۰۰۰ ستاره؛ اعلام انتقال به یک بنیاد متن‌باز در ۱۴ فوریه ۲۰۲۶

### Deepgram Nova-3 — `mainstream`
- **دسته:** speech-to-text
- **توضیح:** مدل STT با WER ۵.۲۶٪ در حالت streaming و تأخیر زیر ۳۰۰ میلی‌ثانیه، با پشتیبانی از Flux برای تشخیص نوبت گفتگو.
- **اهمیت:** برای تماس‌های با حجم بالا که تأخیر پایین حیاتی است، مرجع صنعتی محسوب می‌شود.
- **شاهد پذیرش:** استناد مکرر به‌عنوان گزینه کم‌تأخیر در مقایسه‌های مستقل ۲۰۲۶ (Retell، NextLevel.AI)

### Kokoro — `growing`
- **دسته:** text-to-speech
- **توضیح:** مدل TTS متن‌باز با ۸۲ میلیون پارامتر و مجوز Apache 2.0 که برای استقرار سبک و کم‌هزینه طراحی شده است.
- **اهمیت:** گزینه‌ای عملی برای edge و سناریوهای مقید به هزینه با مجوز آزاد تجاری.
- **شاهد پذیرش:** معرفی به‌عنوان بهترین گزینه edge/low-cost در رتبه‌بندی ۲۰۲۶ Dograh

### Higgs Audio V2 — `emerging`
- **دسته:** text-to-speech
- **توضیح:** مدل TTS حدود ۵.۸ میلیارد پارامتری با مجوز Apache 2.0 که در رتبه‌بندی ۲۰۲۶ بالاترین طبیعی‌بودن را کسب کرده است.
- **اهمیت:** کیفیت گفتار نزدیک به APIهای تجاری را با خودمیزبانی و بدون هزینه هر کاراکتر ارائه می‌دهد.
- **شاهد پذیرش:** انتخاب‌شده به‌عنوان «بهترین طبیعی‌بودن کلی» در تحلیل Dograh 2026

### Whisper / NVIDIA Canary / Parakeet / Moonshine — `growing`
- **دسته:** speech-to-text — open source
- **توضیح:** خانواده مدل‌های متن‌باز STT برای کاربردهای صوتی؛ NVIDIA هر فصل مدل جدید عرضه می‌کند و موجی از مدل‌های کوچک برای گوشی و میکروکنترلر شکل گرفته است.
- **اهمیت:** گزینه‌های خودمیزبان با کنترل کامل داده را فراهم می‌کنند و انتخاب را از «Whisper یا Vosk» به مجموعه‌ای متنوع گسترش داده‌اند.
- **شاهد پذیرش:** پوشش گسترده در راهنمای AssemblyAI (اوت ۲۰۲۶) درباره بهترین گزینه‌های STT متن‌باز

## ریپازیتوری‌های برتر گیت‌هاب

| مخزن | ستاره | زبان | چرا مهم است |
| --- | --- | --- | --- |
| [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | ~13,416 | Python | هم‌راستا با موضوع «فریمورک‌های عامل متن‌باز» و پوشش کامل خط لوله STT→LLM→TTS. |
| [livekit/agents](https://github.com/livekit/agents) | ~11,356 | Python, Node | نماینده مسیر مقیاس‌پذیر برای تماس همزمان بالا در دسته عوامل صوتی متن‌باز. |
| [TEN-Framework/TEN-Agent](https://github.com/TEN-Framework/TEN-Agent) | ~10,898 | C, Go, Python, JS | گزینه‌ای برای سناریوهای multimodal و edge که با خط لوله ساده پوشش داده نمی‌شوند. |
| [bolna-ai/bolna](https://github.com/bolna-ai/bolna) | ~695 | Python | مناسب تیم‌هایی که به دنبال راه‌اندازی سریع یک عامل تلفنی در یک بعدازظهر هستند. |
| [gradio-app/fastrtc](https://github.com/gradio-app/fastrtc) | ~4,618 | Python | ورودی سریع برای ساخت prototype و demo در مسیر عامل صوتی. |
| [vocodedev/vocode-core](https://github.com/vocodedev/vocode-core) | ~3,773 | Python | نمونه‌ای بالغ و مستند برای معماری عامل صوتی با تلفنی. |

## مزایا، معایب و موارد کاربرد
### Pipecat
**مزایا:**
- کتابخانه یکپارچه‌سازی گسترده و تعویض فروشنده تک‌خطی
- نسخه پایدار v1.0 با توسعه تقریباً روزانه
- پشتیبانی از Twilio، Daily و Telnyx

**معایب:**
- برای بارهای همزمان بسیار بالا ممکن است به بازمهندسی نیاز داشته باشد
- مجوز BSD-2-Clause در برخی سازمان‌ها نیازمند بررسی حقوقی است

**مناسب برای:** اکثر پروژه‌های تولیدی چندمنظوره صوتی

### LiveKit Agents
**مزایا:**
- پشتیبانی بومی SIP و شماره تلفن واقعی
- تأییدشده در جهش از ۲۰ به ۴۰۰ تماس همزمان
- مجوز Apache-2.0 و پشتیبانی Python و Node

**معایب:**
- وابستگی به زیرساخت WebRTC و تنظیمات شبکه پیچیده‌تر
- نیازمند تیم مهندسی قوی‌تر برای بهره‌برداری کامل

**مناسب برای:** مقیاس بالا و سناریوهای realtime و telephony

### TTS متن‌باز (Kokoro، Chatterbox-Turbo، Orpheus، Higgs Audio V2)
**مزایا:**
- بدون هزینه هر کاراکتر و بدون افشای داده به API ثالث
- مجوزهای Apache 2.0/MIT برای استفاده تجاری
- امکان انطباق با HIPAA و GDPR

**معایب:**
- برخی مدل‌ها (مثل Fish Audio S2 Pro) نیازمند مجوز تجاری پولی هستند
- تک‌لایه TTS بدون STT و LLM عامل صوتی نمی‌سازد

**مناسب برای:** صنایع تنظیم‌شده و تیم‌های حساس به هزینه در مقیاس

### تشخیص گفتار تجاری (Deepgram Nova-3، AssemblyAI Universal-3 Pro، OpenAI gpt-4o-transcribe، ElevenLabs Scribe v2)
**مزایا:**
- Nova-3 با WER ۵.۲۶٪ و تأخیر زیر ۳۰۰ms
- Universal-3 Pro با WER میانگین ۵.۶٪ روی صدای واقعی دشوار
- Scribe v2 با حدود ۱۵۰ms نخستین partial و پوشش ۹۰+ زبان

**معایب:**
- افت دقت شدید در نویز: از ۹۲٪ هدست تمیز به ۶۵٪ موبایل پرنویز
- WER ۳۰–۵۰٪ برای لهجه‌های شدید
- وابستگی فروشنده و هزینه به‌ازای دقیقه

**مناسب برای:** تماس‌های تجاری با نیاز به دقت و تأخیر پایین

### OpenClaw
**مزایا:**
- اجرای کاملاً محلی و عدم خروج داده از دستگاه
- بیش از ۵۰ یکپارچه‌سازی بومی
- قابلیت نوشتن مهارت‌های جدید به‌صورت خودکار

**معایب:**
- نگرانی‌های امنیتی درباره مجوزهای گسترده عامل
- مخزن مهارت‌ها فاقد بررسی دقیق در برابر ارسال‌های مخرب است

**مناسب برای:** دستیار شخصی و خودکارسازی گردش‌کار توسعه‌دهنده با پذیرش ریسک امنیتی

## دستورات اجرایی پیشنهادی
**نصب و راه‌اندازی Pipecat برای ساخت خط لوله عامل صوتی**
```bash
pip install pipecat-ai
```

**کلون و نصب محیط توسعه Pipecat از مخزن رسمی**
```bash
git clone https://github.com/pipecat-ai/pipecat && cd pipecat && pip install -e .
```

**نصب LiveKit Agents همراه با یکپارچه‌سازی‌های STT/LLM/TTS**
```bash
pip install "livekit-agents[openai,silero,deepgram,cartesia]"
```

**نصب FastRTC برای ساخت نمونه اولیه بلادرنگ WebRTC**
```bash
pip install fastrtc
```

**نصب Vocode برای سناریوهای تلفنی Twilio/Vonage**
```bash
pip install vocode
```

**نصب موتور استنتاج سریع Whisper برای STT خودمیزبان**
```bash
pip install faster-whisper
```

## ریسک‌ها و هشدارها
- دقت STT به‌شدت وابسته به شرایط صوتی است؛ افت از ۹۲٪ روی هدست تمیز به ۶۵٪ روی تماس موبایل پرنویز می‌تواند صحت تراکنش‌های تجاری را تهدید کند.
- WER برای لهجه‌های شدید می‌تواند به ۳۰–۵۰٪ برسد، در حالی که برای گویشوران بومی در بازه ۲–۸٪ است.
- همه مدل‌های «متن‌باز» TTS مجوز تجاری آزاد ندارند؛ نمونه‌ای همچون Fish Audio S2 Pro نیازمند قرارداد تجاری پولی است و Coqui Public Model License محدودیت‌های کاربردی دارد.
- OpenClaw با وجود رشد سریع ستاره‌ها، مجوزهای گسترده و نبود بررسی دقیق مهارت‌های ارسالی، سطح حمله امنیتی قابل‌توجهی ایجاد می‌کند.
- بخشی از داده‌های مقایسه‌ای از منابع فروشنده (NextLevel.AI، Retell، AssemblyAI، Dograh) می‌آید و ممکن است سوگیری تبلیغاتی داشته باشد؛ در برخی موارد منابع با یکدیگر اختلاف معنادار دارند.

## توصیه‌های راهبردی
- برای پروژه‌های عمومی عامل صوتی، Pipecat را به‌عنوان پیش‌فرض در نظر بگیرید و در صورت نیاز به مقیاس یا SIP بومی، LiveKit Agents را ارزیابی موازی کنید.
- استراتژی چندمدلی اتخاذ کنید: ترکیب یک مدل STT کم‌تأخیر (Nova-3) با یک مدل دقت‌بالا (Universal-3 Pro) و مسیریابی بر اساس شرایط صوتی، به‌جای اتکا به یک مدل واحد.
- برای صنایع تنظیم‌شده، مسیر خودمیزبانی با Kokoro یا Higgs Audio V2 برای TTS و Whisper/Parakeet برای STT را با بررسی حقوقی مجوز پیش از استقرار نهایی انتخاب کنید.
- پیش از هر انتخاب، ارزیابی را روی مجموعه داده صوتی واقعی خودتان (نه demo تمیز) با WER و latency سنجیده انجام دهید، چون اختلاف منابع در همین شرایط بروز می‌کند.
- اگر OpenClaw را در محیط سازمانی به‌کار می‌گیرید، محدودسازی مجوزهای عامل و بازبینی امنیتی مهارت‌ها را پیش از استقرار اجباری کنید.

## منابع
- [Best Open-Source AI Voice Generators in 2026](https://www.dograh.com/feeds/blog/open-source-ai-voice-generator) (relevance=0.90598983, engine=firecrawl)
- [5 Best Speech-to-Text Models in 2026, Tested and Ranked](https://www.retellai.com/blog/best-speech-to-text-models) (relevance=0.88563144, engine=jina)
- [6 Best Open-Source Voice Agent Frameworks (2026) | TECHSY](https://techsy.io/en/blog/best-open-source-voice-agent-frameworks) (relevance=0.86522406, engine=firecrawl)
- [8 Best Open-Source AI Agent Frameworks: OpenClaw & More](https://www.ayautomate.com/blog/best-open-source-ai-agent-frameworks) (relevance=0.83973396, engine=firecrawl)
- [Best Speech to Text Models 2026: STT Comparison Guide — NextLevel.AI](https://nextlevel.ai/best-speech-to-text-models) (relevance=0.8198933, engine=firecrawl)
- [The Best AI Agents in 2026: Tools and Frameworks ...](https://www.datacamp.com/blog/best-ai-agents) (relevance=0.8198933, engine=jina)
- [Best Open Source Speech-to-Text Models in 2026](https://www.assemblyai.com/blog/top-open-source-stt-options-for-voice-applications) (relevance=0.81047887, engine=firecrawl)
- [Agentic AI Frameworks 2026: Production Comparison | Uvik Software](https://uvik.net/blog/agentic-ai-frameworks) (relevance=0.76489162, engine=firecrawl)
- [Top AI GitHub Repositories in 2026 - ByteByteGo Newsletter](https://blog.bytebytego.com/p/top-ai-github-repositories-in-2026) (relevance=0.71859437, engine=jina)
- [Top 10 AI Agent Frameworks in 2026 (RANKED!)](https://www.youtube.com/watch?v=fzBESYvyHvk) (relevance=0.69925439, engine=jina)

---
*این گزارش به‌صورت خودکار توسط TechRadarAgent (ROXIRA Autonomous Engineering Platform) تولید شده است.*