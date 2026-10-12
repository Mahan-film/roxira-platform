# مسیر E: هزینه و مدل‌ها (راهنمای اجرای شخصی مالک)

وضعیت: ۱۲ اکتبر ۲۰۲۶. منبع‌ها: `docs/factory/FACTORY_AUDIT_2026-10-12.md` بخش ۲ و ۵، `docs/STRATEGY_GAP_2026-10-12.md` (C4، C5، C6)، `output_apps/generated_modules/smartjudge/llm_router.py`، `scripts/dev/llm_spend.sh`، `scripts/cost_report.py`، `.env.example`.

## ۱. هدف
الان یک کلید OpenRouter هم برای agentها (کار توسعه روی مک) و هم برای محصول (چت وکلا و کاربران) استفاده می‌شود و موجودی حساب حدود ۶٫۱۹ دلار است. یک حلقه‌ی خراب در agent می‌تواند موجودی را خالی کند و چت مشتری‌ها را از کار بیندازد. بعد از این مسیر: چهار کلید جدا با سقف روزانه (PROD/DEV/EVAL/AGENTS)، موجودی کافی، ثبت هزینه‌ی هر درخواست محصول، و هر هفته یک گزارش هزینه به فارسی.

## ۲. چرا الان
- موجودی کم است و فقط یک کلید داریم؛ خالی‌شدن آن یعنی چت قطع.
- بدون ثبت هزینه نمی‌دانیم هر کاربر/پلن چقدر خرج دارد و قیمت‌گذاری (مسیر G) کور است.
- `LLM_ROUTER_ENABLED` پیش‌فرض خاموش است؛ تا روشن نشود هیچ لاگ هزینه‌ای ثبت نمی‌شود.

## ۳. پیش‌نیازها
- حساب OpenRouter و کارت بین‌المللی/روش پرداخت شما (من هیچ‌وقت وارد کارت نمی‌شوم و پرداخت را شما انجام می‌دهید).
- دسترسی ssh به سرور برای گام‌های E3.
- فایل `~/Secrets/roxira/roxira.env` و اسکریپت‌های `scripts/ops/set_server_env.sh`، `scripts/dev/llm_spend.sh`.
- قانون: مقدار کلید را هرگز در چت یا commit ننویسید.

## ۴. قدم‌به‌قدم

### E1. شارژ حساب OpenRouter (۵ دقیقه، پرداخت دستی توسط شما)
۱) (مرورگر) `https://openrouter.ai/settings/credits` را باز کنید، مبلغ را انتخاب و پرداخت کنید. پیشنهاد شروع: ۲۰ تا ۳۰ دلار. برآورد مصرف agentها طبق audit: حدود ۲۲ دلار در ماه با ۲۰ کار در روز؛ مصرف محصول جدا.
۲) (مک) موجودی را ببینید:
```bash
scripts/dev/llm_spend.sh
```
انتظار: مبلغ جدید در بخش account balance و هر کلید با سقف و مصرف امروز.

### E2. ساخت چهار کلید جدا با سقف روزانه
نکته‌ی فنی: سقف روزانه (`limit` + `limit_reset=daily`) در مستندات OpenRouter از طریق API و **Management Key** تنظیم می‌شود؛ ریست ساعت ۰۰:۰۰ UTC (حدود ۰۳:۳۰ بامداد تهران) است. ممکن است فرم دستی همه‌ی گزینه‌ها را نشان ندهد؛ اگر نشان نداد از روش B (API) استفاده کنید.

۱) (OpenRouter، داشبورد) Settings > Management Keys > Create New Key، اسمش `mgmt`. مقدار را فقط یک‌بار می‌بینید؛ در مدیر رمز عبور ذخیره کنید. این کلید فقط مدیریت کلیدها را انجام می‌دهد و برای چت کار نمی‌کند.
۲) روش A (داشبورد): Settings > Keys > Create API Key؛ اسم و Credit limit را وارد کنید. اگر گزینه‌ی reset daily هم بود فعالش کنید.
۳) روش B (API، دقیق‌تر). مقدار را در متغیر پنهان بخوانید:
```bash
read -s MGMT; export MGMT
```
(مقدار را تایپ/پیست کنید و Enter بزنید؛ چیزی نمایش داده نمی‌شود.)
۴) هر کلید یک دستور؛ پاسخ شامل مقدار کلید است، پس مستقیم در فایل می‌رود نه روی صفحه. اول فایل‌های موقت امن:
```bash
umask 077; mkdir -p ~/Secrets/roxira/newkeys
```
```bash
curl -sS https://openrouter.ai/api/v1/keys -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" -d '{"name":"roxira-dev","limit":2,"limit_reset":"daily"}' > ~/Secrets/roxira/newkeys/dev.json
```
```bash
curl -sS https://openrouter.ai/api/v1/keys -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" -d '{"name":"roxira-eval","limit":1,"limit_reset":"daily"}' > ~/Secrets/roxira/newkeys/eval.json
```
```bash
curl -sS https://openrouter.ai/api/v1/keys -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" -d '{"name":"roxira-agents","limit":0.5,"limit_reset":"daily"}' > ~/Secrets/roxira/newkeys/agents.json
```
```bash
curl -sS https://openrouter.ai/api/v1/keys -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" -d '{"name":"roxira-prod","limit":5,"limit_reset":"daily"}' > ~/Secrets/roxira/newkeys/prod.json
```
سقف‌ها از جدول audit آمده‌اند: DEV ۲ دلار، EVAL ۱ دلار، AGENTS (Goose/کارهای تکراری) ۰٫۵ دلار؛ برای PROD عدد را خودتان بر اساس تعداد کاربر بگذارید (۵ دلار در روز برای شروع).
۵) انتقال کلیدها به `roxira.env` بدون چاپ:
```bash
python3 -I - <<'PY'
import json, os
d = os.path.expanduser("~/Secrets/roxira/newkeys/")
env = os.path.expanduser("~/Secrets/roxira/roxira.env")
add = []
for n, name in (("dev","OPENROUTER_API_KEY_DEV"),("eval","OPENROUTER_API_KEY_EVAL"),("agents","OPENROUTER_API_KEY_AGENTS"),("prod","OPENROUTER_API_KEY_PROD")):
    k = json.load(open(d + n + ".json")).get("key")
    if not k: print("MISSING", n); continue
    add.append(f"{name}={k}")
    print("ok", name, "len", len(k))
if add:
    with open(env, "a") as f: f.write("\n" + "\n".join(add) + "\n")
PY
```
انتظار: چهار خط `ok ... len ...`. (اگر `MISSING`، پاسخ API را با `cat` نگاه نکنید چون ممکن است کلید داشته باشد؛ فقط پیام error را به hub بگویید.)
۶) پاکسازی:
```bash
rm -P ~/Secrets/roxira/newkeys/*.json && rmdir ~/Secrets/roxira/newkeys && unset MGMT
```
۷) بررسی:
```bash
scripts/dev/llm_spend.sh
```
انتظار: چهار کلید جدید با سقف روزانه و remaining.
۸) کلید قدیمی `OPENROUTER_API_KEY` را فعلاً نگه دارید تا کارهای باقی‌مانده (rx، LiteLLM) روی کلیدهای جدید منتقل شوند؛ بعد در داشبورد غیرفعال کنید (Settings > Keys > Disable).
۹) کلید PROD را روی سرور بگذارید. محصول متغیر `OPENROUTER_API_KEY` را می‌خواند (نه `_PROD`)، پس با ورودی پنهان:
```bash
scripts/ops/set_server_env.sh OPENROUTER_API_KEY --replace
```
وقتی پرسید، مقدار `OPENROUTER_API_KEY_PROD` را از `roxira.env` پیست کنید (چاپ نمی‌شود). بکاپ `.env` سرور خودکار گرفته می‌شود.

### E3. روشن‌کردن ثبت هزینه‌ی هر درخواست (LLM_ROUTER_ENABLED)
چه می‌شود: چت از «روتر مرکزی» رد می‌شود؛ هر تماس یک خط JSON (tenant، مدل واقعی، توکن، هزینه) در `data/llm_usage.jsonl` می‌نویسد، کش Redis برای سؤال‌های تکراری فعال می‌شود و مدل :free هرگز به داده‌ی حساس نمی‌رسد. قبل از روشن‌کردن با hub هماهنگ کنید (تغییر رفتار تولید).
۱) متغیرها را روی سرور بگذارید (هر کدام یک بار):
```bash
scripts/ops/set_server_env.sh LLM_ROUTER_ENABLED --replace
```
مقدار: `1`
```bash
scripts/ops/set_server_env.sh LLM_USAGE_LOG_PATH --replace
```
مقدار: `/opt/roxira_platform/data/llm_usage.jsonl` (همان مسیر `.env.example`؛ پوشه‌ی `./data` در compose به کانتینر وصل است).
۲) اعمال (ری‌استارت کانتینر برنامه؛ طبق قانون پروژه فقط با تأیید شما و بهتر است hub همراه باشد):
```bash
ssh root@5.75.200.67 'cd /opt/roxira_platform && docker compose -f docker-compose.prod.yml up -d --no-deps enterprise_app'
```
انتظار: کانتینر دوباره ساخته و `Up` می‌شود. بعد در سایت یک پرسش بفرستید.
۳) تأیید ثبت لاگ (خط‌های بدون متن پرسش، فقط شمارش و هزینه):
```bash
ssh root@5.75.200.67 'wc -l /opt/roxira_platform/data/llm_usage.jsonl && tail -n 1 /opt/roxira_platform/data/llm_usage.jsonl | cut -c1-300'
```
انتظار: شمارنده بالا می‌رود و آخرین خط فیلدهای مدل/توکن/هزینه دارد. اگر فایل نبود: hub لاگ کانتینر را می‌خواند.
۴) خلاصه‌ی روزانه از خود روتر:
```bash
ssh root@5.75.200.67 'cd /opt/roxira_platform && LLM_USAGE_LOG_PATH=data/llm_usage.jsonl python3 -m output_apps.generated_modules.smartjudge.llm_router summary --days 1'
```
(اگر روی میزبان وابستگی کم بود، از داخل کانتینر `docker exec` اجرا کنید؛ این را hub انجام می‌دهد.)

### E4. گزارش هفتگی هزینه به فارسی
اسکریپت `scripts/cost_report.py` فایل‌های لاگ را جمع می‌کند و گزارش فارسی می‌دهد.
۱) (هفته‌ای یک بار) لاگ محصول را بکشید:
```bash
mkdir -p ~/RoxiraCost && scp root@5.75.200.67:/opt/roxira_platform/data/llm_usage.jsonl ~/RoxiraCost/product.jsonl
```
۲) گزارش:
```bash
python3 scripts/cost_report.py --product-log ~/RoxiraCost/product.jsonl --days 7 --lang fa
```
انتظار: جدول هزینه‌ی هفت روز اخیر به فارسی. (لاگ agentها: اگر `AGENT_LEDGER_PATH` دارید با `--agent-ledger` اضافه کنید.)
۳) هزینه‌ی کلیدها هم‌زمان:
```bash
scripts/dev/llm_spend.sh
```
۴) زمان‌بندی: یادآور هفتگی بگذارید (یا از hub بخواهید با زمان‌بند، ایمیل خودکار بسازد؛ هنوز ساخته نشده).

## ۵. چطور بفهمم درست انجام شد
- [ ] `llm_spend.sh` موجودی حساب جدید و چهار کلید با سقف روزانه را نشان می‌دهد.
- [ ] کلید قدیمی غیرفعال یا فقط برای بخش‌های منتقل‌نشده است.
- [ ] روی سرور فقط کلید PROD در `OPENROUTER_API_KEY` است.
- [ ] `llm_usage.jsonl` بعد از هر پرسش خط جدید می‌گیرد.
- [ ] گزارش فارسی هفتگی جدول دارد و جمع هزینه با داشبورد OpenRouter (Activity) تقریباً هم‌خوان است.
- [ ] تست سقف: یک کلید EVAL را عمداً با سقف کوچک آزمایش کنید (hub کمک می‌کند)؛ بعد از سقف باید خطای 402/limit بدهد نه اینکه حساب خالی شود.

## ۶. خطرها و راه برگشت
- اگر سقف PROD زود پر شود چت قطع می‌شود: سقف را در داشبورد بالا ببرید (کلید را دوباره نسازید). سقف را بالاتر از مصرف عادی ۲ برابر بگیرید و از روز اول هشدار `llm_spend.sh` را ببینید.
- اگر بعد از `LLM_ROUTER_ENABLED=1` چت خطا داد: مقدار را `0` کنید و کانتینر را دوباره بالا بیاورید (همان دستور)؛ مسیر قدیمی بدون روتر بدون تغییر باقی مانده است.
- فایل لاگ فقط عدد و اسم مدل دارد، نه متن پرسش (طبق طراحی روتر)، ولی `data/` را در git یا چت نگذارید.
- کلید لورفته: همان لحظه در داشبورد Disable.

## ۷. زمان و هزینه
زمان: E1 ۵ دقیقه، E2 ۲۰ دقیقه، E3 ۲۰ دقیقه، E4 ۱۰ دقیقه در هفته. هزینه: شارژ ۲۰ تا ۳۰ دلار برای شروع (ابزار رایگان). مصرف agentها طبق برآورد audit حدود ۱ دلار در روز در ۲۰ کار روزانه.

## ۸. کجا Claude کمک می‌کند
- خروجی `scripts/dev/llm_spend.sh` (فقط اسم متغیر و عدد چاپ می‌کند، قابل ارسال است).
- خروجی `wc -l` و `cut -c1-300` لاگ در E3؛ و اگر خطا شد آخرین ۳۰ خط `docker logs` کانتینر.
- Claude می‌تواند: تغییر rx/dispatch برای استفاده از کلیدهای جدید، ایمیل خودکار هفتگی گزارش، و هشدار زیر ۲۵٪ موجودی را به agent بدهد.

## منابع
- OpenRouter، ساخت کلید با `limit` و `limit_reset` (روزانه، ریست نیمه‌شب UTC)، نیاز به Management Key: https://openrouter.ai/docs/api-reference/api-keys/create-api-key
- Management API Keys: https://openrouter.ai/docs/guides/overview/auth/management-api-keys
- کنترل خرج تیمی (داشبورد Activity بر اساس کلید/مدل): https://openrouter.ai/blog/tutorials/team-spend-controls-setup/
- داخلی: `docs/factory/FACTORY_AUDIT_2026-10-12.md` بخش ۵، `docs/ops/API_KEYS.md`.
