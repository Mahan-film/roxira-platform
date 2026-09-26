# W15: نقشه راه استحکام تبدیل صوت به متن (STT)

## زنجیره فعلی
1. `smartjudge_live_voice.py`: تماس اصلی با `POST /audio/transcriptions` روی `OPENROUTER_API_KEY`،
   با مدل `VOICE_STT_MODEL` (یا `stt` نقش در `config/models.yaml`: در حال حاضر
   `openai/whisper-large-v3-turbo`).
2. شکست تماس اصلی → فال‌بک محلی به `stt_engine.transcribe_audio_blob` (کلید API جدا از
   `llm_client.get_config()`)، که اکنون (این PR) زنجیره‌اش را از همان نقش `stt` می‌خواند
   (`whisper-large-v3-turbo` سپس `openai/gpt-audio`) به‌جای مدل بازنشسته‌شده
   `google/gemini-2.0-flash-001` که پیش‌تر هاردکد بود.

## خرابی‌های دیده‌شده در لاگ سرور
- ۴ مورد HTTP 429 (Too Many Requests) در ۷ روز گذشته روی `openai/whisper-large-v3-turbo`، نه
  404/model-not-found؛ یعنی مدل زنده است ولی نرخ‌محدود می‌شود.
- `google/gemini-2.0-flash-001` (فال‌بک قدیمی در `stt_engine.py`) از کاتالوگ زنده OpenRouter
  حذف شده — این PR آن را با زنجیره نقش `stt` جایگزین کرد.

## وضعیت سرور (`5.75.200.67`, کانتینر `roxira_app_prod`, فقط خواندنی بررسی شد)
- `faster-whisper==1.2.1` و `torch==2.14.0` از قبل نصب است (وابستگی گذرای `docling` برای
  OCR)، ولی در هیچ مسیر کد فعلی برای STT سیم‌کشی نشده.
- بدون GPU: `torch.cuda.is_available()` → `False`، `nvidia-smi` موجود نیست.
- CPU: ۸ هسته. RAM: ~۱۶ گیگ (۱۳ گیگ available). دیسک: ۸۱ گیگ آزاد از ۱۵۰ گیگ.

## پیشنهاد: میزبانی خود `faster-whisper large-v3-turbo` روی سرور
- **تخمین تأخیر (منبع: SYSTRAN/faster-whisper README و بنچمارک‌های رسمی
  openai/whisper + CTranslate2):**
  - CPU (۸ هسته، int8): برای کلیپ ۵-۱۰ ثانیه‌ای فارسی، حدود ۲-۵ برابر real-time roughly
    یعنی ~۱-۳ ثانیه تأخیر برای صوت ۵ ثانیه‌ای — قابل قبول برای کنسولتیشن زنده ولی کندتر از
    تماس شبکه فعلی وقتی OpenRouter نرخ‌محدود نمی‌کند.
  - GPU (مثلاً T4/A10، در دسترس نیست فعلاً): معمولاً ۱۰-۲۰ برابر سریع‌تر از CPU، تأخیر
    زیر ۵۰۰ میلی‌ثانیه برای کلیپ‌های کوتاه.
- **نیاز منابع:** مدل `large-v3-turbo` (int8) حدود ۱.۵-۲ گیگ RAM/VRAM و ~۱.۶ گیگ دیسک برای
  وزن‌ها. با ۱۳ گیگ RAM آزاد و ۸۱ گیگ دیسک، سرور فعلی (CPU-only) ظرفیت اجرا را دارد.
- **هزینه:** صفر هزینه per-call (حذف تماس OpenRouter)؛ فقط هزینه غیرمستقیم مصرف CPU سرور
  موجود (بدون سرور جدید).

## قدم‌های دقیق استقرار (فقط برای تأیید مالک — اینجا تغییری داده نشده)
1. `docker exec roxira_app_prod python3 -c "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', device='cpu', compute_type='int8')"` برای دانلود و تست اولیه وزن‌ها.
2. افزودن ماژول جدید (مثلاً `stt_local_whisper.py`) که `WhisperModel` را یک‌بار در startup لود کند (نه per-request) و `language="fa"` را صریح بدهد.
3. افزودن یک گزینه در زنجیره `_stt_model_chain`/`transcribe_audio_blob` برای امتحان موتور محلی قبل از OpenRouter (کاهش تأخیر و هزینه)، یا به‌عنوان فال‌بک نهایی به‌جای فال‌بک اضطراری فعلی.
4. اندازه‌گیری تأخیر واقعی با `scripts/voice_latency_bench.py` (W7) قبل/بعد.
5. `docker compose -f docker-compose.prod.yml up -d --build roxira_app` برای اعمال (نیازمند ریستارت کانتینر — تأیید مالک لازم).
