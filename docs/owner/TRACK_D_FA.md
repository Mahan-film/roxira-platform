# مسیر D: زیرساخت و عملیات (راهنمای اجرای شخصی مالک)

وضعیت: ۱۲ اکتبر ۲۰۲۶. منبع‌ها: `scripts/infra/migrate_checklist.md`، `docs/infra/NEW_SERVER_PLAN_2026-10-12.md`، `docs/ops/RESTORE_DRILL.md`، `docs/ops/SITE_HEALTH_2026-10-09.md`، `docs/research/HOME_SERVER_VOIP_S2S_2026-10-09.md`، `docs/STRATEGY_GAP_2026-10-12.md` (O2، O5، O6، O9، O10).

## ۱. هدف
پنج کار که تعیین می‌کنند سایت «واقعاً بالا می‌ماند و برمی‌گردد»: (۱) تصمیم اینکه کاربر اصلی داخل ایران است یا خارج؛ (۲) تنظیم Cloudflare طوری که کاربر ایرانی صفحه را ببیند؛ (۳) یک تمرین بازیابی ثبت‌شده تا بدانیم بکاپ‌ها واقعاً برمی‌گردند؛ (۴) نسخه‌ی دوم داده‌ی حقوقی؛ (۵) انتقال به سرور جدید (سرور فعلی ۹۶٪ دیسک پر است).

## ۲. چرا الان
- شما گفته‌اید از ایران سایت باز نمی‌شود؛ تحلیل ما محتمل‌ترین علت‌ها را تنظیمات Cloudflare (HTTP/3، چالش) می‌داند، و این دو کلیک است.
- بکاپی که هرگز بازیابی نشده «امید» است نه کنترل.
- داده‌ی حقوقی ماه‌ها کار است و الان فقط یک نسخه روی مک دارد.
- مهاجرت باید بعد از (۲) تا (۴) باشد، نه قبل.

## ۳. پیش‌نیازها
- دسترسی Cloudflare (سه دامنه: `ghazihoushmand.ir`، `roxira.ir`، `roxira.net`)، سرور `5.75.200.67`، Docker Desktop روشن روی مک.
- نصب ابزار: `brew install restic hcloud` (فعلاً روی مک نصب نیستند؛ gitleaks، age، gh، docker هستند).
- برای مهاجرت: حساب Hetzner و یک API token (Console > Project > Security > API tokens؛ آن را در چت نفرستید).
- یک هارد/فلش خارجی برای نسخه‌ی دوم.

## ۴. قدم‌به‌قدم

### D1. تصمیم «کاربر ایران یا خارج؟» (۲۰ دقیقه، بدون هزینه)
چرا: در پژوهش داخلی آمده که در دوره‌های «اینترنت طبقاتی/whitelist» آی‌پی‌های Hetzner از داخل ایران ممکن است بسته شود؛ اگر بیشتر کاربران شما در ایران‌اند، سرور فقط-خارجی یک ریسک بزرگ است و باید به آینه‌ی داخلی (مثلاً ArvanCloud) فکر کرد.
۱) در Cloudflare: دامنه‌ی `ghazihoushmand.ir` را انتخاب کنید > Analytics & Logs > Traffic، بازه‌ی ۳۰ روز، تب Country. درصد ایران را یادداشت کنید.
۲) از ۵ مشتری/وکیل آشنا بپرسید: با کدام اینترنت (همراه/ثابت) و با یا بدون VPN سایت را باز می‌کنند.
۳) تصمیم را در یک خط بنویسید و برای hub بفرستید:
- «بیش از ۶۰٪ ایران» → گام‌های D2 اجباری است و بعداً آینه‌ی داخلی (Claude طرحش را می‌نویسد، هزینه‌ی ریالی جدا).
- «بیشتر خارج یا مساوی» → همان معماری فعلی کافی است؛ D2 را هم انجام دهید.
فعلاً هیچ‌چیز نخرید.

### D2. تنظیمات Cloudflare برای کاربر ایرانی (۲۰ دقیقه)
برای هر سه دامنه، یکی‌یکی (داشبورد Cloudflare، اول دامنه را انتخاب کنید):
۱) **HTTP/3 را خاموش کنید:** Speed > Settings > Protocol Optimization > HTTP/3 > Off. (QUIC/UDP روی بسیاری از شبکه‌های ایران افت می‌کند و باعث تأخیر طولانی می‌شود.)
۲) **سطح چالش:** Security > Settings. اگر گزینه‌ی Security level دیدید روی Medium (یا Low) بگذارید و مطمئن شوید «Under Attack» خاموش است. اگر فقط Under Attack دیدید، خاموش بودنش کافی است (در داشبورد جدید ممکن است سطح‌ها مخفی باشند).
۳) **Bot Fight Mode را خاموش کنید:** Security > Settings > فیلتر Bot traffic > Bot fight mode > Off. (ترافیک ایران اغلب CGNAT است و ربات تشخیص داده می‌شود.)
۴) **Browser Integrity Check را خاموش کنید:** Security > Settings > Browser integrity check > Off.
۵) **ببینید چالش به ایرانی‌ها خورده یا نه:** Security > Events، فیلتر Country = Iran؛ هر Action از نوع Challenge/Block یعنی همین مشکل است.
۶) **کش فایل‌های ثابت** (سرعت برای اینترنت کند): Caching > Cache Rules > Create rule. اسم: `next-static`. شرط: Custom filter expression → `starts_with(http.request.uri.path, "/_next/static/")`. Then: Cache eligibility = Eligible for cache. Edge TTL = یک ماه. Deploy. (این فایل‌ها هش در اسم دارند، پس امن است. روی `/api/` هرگز قانون کش نگذارید.)
۷) تست کش (مک):
```bash
curl -sI https://ghazihoushmand.ir/ | grep -i -E "alt-svc|cf-cache-status"
```
انتظار: خط `alt-svc` با h3 دیگر دیده نشود (ممکن است چند دقیقه طول بکشد).
۸) تست از دید ایران: در مرورگر `https://check-host.net/check-http` را باز کنید، آدرس `https://ghazihoushmand.ir` را بدهید و فقط نودهای Iran را انتخاب کنید. انتظار: وضعیت 200 برای همه‌ی نودها. روی `roxira.ir` و `roxira.net` هم تکرار کنید.
۹) در پنل IRNIC تاریخ انقضای `roxira.ir` و `ghazihoushmand.ir` را ببینید؛ دامنه‌ی منقضی از داخل ایران فیلتر می‌شود.
۱۰) اگر هنوز از ایران باز نشد: از خود شبکه‌ی ایران این دو را اجرا کنید و خروجی را به hub بدهید: `curl -sv https://ghazihoushmand.ir/ -o /dev/null --http1.1` و همان با `-k https://5.75.200.67` (با این می‌فهمیم مشکل مسیر Cloudflare است یا آی‌پی سرور).

### D3. تمرین بازیابی ثبت‌شده (۳۰ دقیقه، فقط روی مک)
متن کامل در `docs/ops/RESTORE_DRILL.md`؛ اینجا خلاصه‌ی اجرایی است. هرگز روی سرور تولید اجرا نشود.
۱) آخرین مجموعه‌ی بکاپ:
```bash
LATEST="$(ls -1dt "$HOME"/RoxiraBackups/20??-??-?? | head -1)"; echo "$LATEST"; ls -lh "$LATEST"
```
انتظار: فایل‌های `postgres_*.sql.gz` و `qdrant_*.tar.gz` با تاریخ نزدیک. اگر پوشه‌ی امروز/دیروز نیست، اول:
```bash
bash scripts/ops/backup/mac_pull.sh
```
۲) تعریف متغیرها و سلامت فایل‌ها:
```bash
PG_DUMP="$(ls -1t "$LATEST"/postgres_*.sql.gz | head -1)"; QD_TAR="$(ls -1t "$LATEST"/qdrant_*.tar.gz | head -1)"; gzip -t "$PG_DUMP" && gzip -t "$QD_TAR" && echo gzip-OK
```
۳) Postgres موقت (کانتینر دورانداختنی، پورت 55432):
```bash
docker run -d --rm --name roxira_restore_pg -e POSTGRES_USER=enterprise_admin -e POSTGRES_DB=enterprise_db -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgres:17-alpine
```
۴) ۱۰ ثانیه صبر کنید، سپس ریستور (هر خطای SQL باید متوقف کند):
```bash
gunzip -c "$PG_DUMP" | docker exec -i roxira_restore_pg psql -v ON_ERROR_STOP=1 -U enterprise_admin -d enterprise_db > /dev/null && echo pg-restore-OK
```
۵) Qdrant موقت:
```bash
QD_DIR="$HOME/RoxiraRestore/qdrant"; rm -rf "$QD_DIR"; mkdir -p "$QD_DIR"; tar xzf "$QD_TAR" -C "$QD_DIR"; ls "$QD_DIR"
```
```bash
docker run -d --rm --name roxira_restore_qdrant -p 127.0.0.1:16333:6333 -v "$QD_DIR":/qdrant/storage qdrant/qdrant:latest
```
۶) صبر کنید (تا ۲ دقیقه) و بشمارید:
```bash
for C in iran_laws_v2 iran_laws_v3 iran_laws_bge_m3; do printf "%s " "$C"; curl -s "http://127.0.0.1:16333/collections/$C" | python3 -c 'import json,sys; r=json.load(sys.stdin).get("result"); print(r["status"], r["points_count"]) if r else print("MISSING")'; done
```
انتظار: `iran_laws_v2` حدود ۵۰۰۰ نقطه و سبز؛ `iran_laws_v3` اگر روی سرور ساخته شده باشد هست (اگر MISSING بود به hub بگویید؛ ممکن است بکاپ قدیمی باشد). تعداد را یادداشت کنید.
۷) تعداد سطرها:
```bash
docker exec roxira_restore_pg psql -U enterprise_admin -d enterprise_db -tAc "SELECT count(*) FROM users"
```
۸) ثبت نتیجه (برای مقایسه ماه بعد):
```bash
printf '%s set=%s result=PASS_OR_FAIL users=N v2=N v3=N minutes=N\n' "$(date +%F)" "$(basename "$LATEST")" >> "$HOME/RoxiraBackups/drill.log"
```
(قبل از اجرا PASS_OR_FAIL و N را با اعداد واقعی عوض کنید.) همان یک خط را به hub بدهید تا در `docs/ops/RESTORE_DRILL_LOG.md` ثبت شود.
۹) پاکسازی:
```bash
docker rm -f roxira_restore_pg roxira_restore_qdrant
```
```bash
rm -rf "$HOME/RoxiraRestore/qdrant"
```

### D4. نسخه‌ی دوم داده‌ی حقوقی (۱۵ دقیقه)
قانون: `~/Backups` تغییرناپذیر است؛ فقط کپی بگیرید، چیزی را حذف نکنید.
۱) هارد خارجی را وصل کنید و نامش را ببینید:
```bash
ls /Volumes
```
۲) کپی (با `<DISK>` نام هارد):
```bash
rsync -a --progress ~/Backups/roxira-legal/phase1_20261004/ "/Volumes/<DISK>/roxira-legal/phase1_20261004/"
```
۳) راستی‌آزمایی (باید بدون خروجی باشد):
```bash
diff -rq ~/Backups/roxira-legal/phase1_20261004 "/Volumes/<DISK>/roxira-legal/phase1_20261004"
```
۴) کپی سوم رمزشده برای ابر (اختیاری؛ با کلید عمومی age خودتان):
```bash
tar -czf - -C ~/Backups/roxira-legal phase1_20261004 | age -r "$(age-keygen -y ~/Secrets/roxira/backup-age.key)" > "$HOME/phase1_20261004.tar.age"
```
فایل `.tar.age` را می‌توانید در هر فضای ابری بگذارید؛ بدون کلید خصوصی خوانده نمی‌شود.
۵) **کلید خصوصی age** (`~/Secrets/roxira/backup-age.key`): یک نسخه در مدیر رمز عبور شما و یک نسخه روی کاغذ/فلش جدا. بدون آن بکاپ ایمیلی و نسخه‌ی رمزشده بی‌مصرف است.

### D5. مهاجرت به سرور جدید
چک‌لیست ۳۱ مرحله‌ای کامل و تست‌شده در `scripts/infra/migrate_checklist.md` است؛ دوباره ننویسیم، فقط ترتیب و نکته‌ها:
۱) پیش از خرید: D3 باید «PASS» باشد؛ x-ui را با مسیر C تصمیم بگیرید (چک‌لیست گام ۵).
۲) نصب ابزار و ورود:
```bash
brew install hcloud
```
```bash
hcloud context create roxira
```
(توکن را در پرامپت وارد می‌کنید، چاپ نمی‌شود.)
۳) موجودی پلن را ببینید: `hcloud server-type list | grep -E 'cax|cx|cpx'`؛ پیشنهاد پلن CAX31 در Nuremberg (جزئیات و جایگزین‌ها: بخش ۱.۳ و ۱.۴ `NEW_SERVER_PLAN`).
۴) از گام ۶ چک‌لیست (ساخت سرور) تا گام ۱۹ (تست دود روی آی‌پی جدید) طبق همان فایل پیش بروید؛ هر مرحله را اجرا و خروجی را چک کنید، بعد بروید بعدی. چیزی روی سرور قدیم تغییر نمی‌کند تا گام ۲۰.
۵) قطع (گام ۲۰ تا ۲۵) را در ساعت کم‌ترافیک انجام دهید (۱۵ تا ۳۰ دقیقه)؛ تغییر رکورد A در Cloudflare، سپس قفل مبدأ با `cloudflare_only.sh --apply`.
۶) سرور قدیم را ۴۸ ساعت نگه دارید؛ فقط با تأیید شما و فقط همان یک سرور حذف شود (گام ۳۱).

## ۵. چطور بفهمم درست انجام شد
- [ ] D1: یک خط تصمیم + درصد ایران ثبت شده.
- [ ] D2: `alt-svc` ندارد، check-host از نودهای ایران 200 می‌دهد، Security Events برای IR چالش ندارد، قانون کش فعال است (دومین `curl -I` به یک فایل `/_next/static/...` مقدار `cf-cache-status: HIT`).
- [ ] D3: خط PASS در `drill.log` و ارسال به hub؛ تعداد نقاط v2 (و v3) معقول.
- [ ] D4: `diff -rq` بی‌خروجی؛ کلید age در دو جای جدا.
- [ ] D5: شرایط گام ۲۸ چک‌لیست (دو ایمیل بکاپ از سرور جدید، drill موفق، `certbot renew --dry-run`).

## ۶. خطرها و راه برگشت
- تنظیمات Cloudflare: هر کدام با یک کلید برگشت‌پذیر است. HTTP/3 را اگر مشکل ساخت دوباره On کنید. سطح امنیتی پایین‌تر یعنی ربات بیشتر؛ در صورت حمله دوباره Under Attack بزنید.
- D3 فقط کانتینر موقت می‌سازد؛ به تولید دست نمی‌زند.
- D5: برگشت = برگرداندن رکورد A به آی‌پی قدیم (چک‌لیست گام ۲۷). هرگز cron دو سرور هم‌زمان روشن نباشد.
- مهاجرت داده‌ی کاربر را جابه‌جا می‌کند: بدون بکاپ تازه و drill موفق شروع نکنید.

## ۷. زمان و هزینه
D1 ۲۰ دقیقه؛ D2 ۲۰ دقیقه؛ D3 ۳۰ دقیقه (بار اول با دانلود ایمیج‌ها تا ۱۵ دقیقه بیشتر)؛ D4 ۱۵ دقیقه؛ D5 حدود یک روز کاری پراکنده + ۱۵ تا ۳۰ دقیقه قطع. هزینه: D1 تا D4 صفر (هارد خارجی اگر ندارید)؛ سرور جدید طبق پلن (قیمت CAX31 در منابع ما تأییدشده نیست و در ۲۰۲۶ تغییر کرده؛ قیمت زنده را در کنسول Hetzner ببینید. آی‌پی v4 ممکن است جدا حدود ۰٫۵ یورو در ماه حساب شود).

## ۸. کجا Claude کمک می‌کند
- خروجی `curl -sI https://ghazihoushmand.ir/ | grep -i -E "alt-svc|cf-cache-status"` و تصویر نتیجه‌ی check-host.
- خط drill.log، یا اولین خطای SQL/Qdrant در D3 (آخرین ۲۰ خط).
- هر گام چک‌لیست مهاجرت که خروجی‌اش با «انتظار» نمی‌خواند: شماره‌ی گام + خروجی (بدون رمز).
- Claude می‌تواند اسکریپت `iran_probe.py` (پروب خودکار از نودهای ایران) را به agent بدهد و `RESTORE_DRILL_LOG.md` را بنویسد.

## منابع
- Cloudflare HTTP/3 (مسیر Speed > Settings > Protocol Optimization): https://developers.cloudflare.com/speed/optimization/protocol/http3/
- Cloudflare Browser Integrity Check (Security > Settings): https://developers.cloudflare.com/waf/tools/browser-integrity-check/
- Cloudflare Bot Fight Mode (Security > Settings، فیلتر Bot traffic): https://developers.cloudflare.com/bots/get-started/free/
- Cloudflare Security Level / Under Attack: https://developers.cloudflare.com/waf/tools/security-level/
- Cloudflare Cache Rules: https://developers.cloudflare.com/cache/how-to/cache-rules/create-dashboard/
- داخلی: `docs/ops/SITE_HEALTH_2026-10-09.md`، `docs/ops/RESTORE_DRILL.md`، `scripts/infra/migrate_checklist.md`.
