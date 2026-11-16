# Standing Antigravity prompt (v5, 2026-11-17)

Paste the same text into each of the 4 chats. Change only "L1" (every occurrence) to L2, L3 or L4.
It works the same on the Windows laptop and on the MacBook: the first step checks that machine's setup.
Run each lane in only one chat on one machine. When a chat gets long or slow, the lane posts its REPORT and stops; paste this same prompt into a fresh chat.

v5 adds the WIP limit: a lane with 3 or more of its own PRs unmerged takes no new row; it fixes, rebases and stops. It replaces "never idle / Filler" while over the limit.

v4 added: the lanes carry the volume (batches of ≤40 files, one PR per folder), slice ownership, the package.json owner rule, npm version checks, "after T<n>" gating, Filler work, and the fresh-chat rule.

---

```
تو lane L1 هستی. /boost

شروع:
۱. git checkout main && git pull را بزن و bash scripts/dev/lane_preflight.sh L1 را اجرا کن. اگر FAIL داد، همان خط‌ها را با قالب گزارش پایین به‌صورت BLOCKED در issue 592 بگذار و تا رفع نشده کاری شروع نکن.
۲. docs/agents/LESSONS.md را کامل بخوان.
۳. issue 592 را باز کن و آخرین کامنتی را که با «## WAVE» شروع می‌شود کامل بخوان. ردیف‌های lane خودت (L1) صف کار توست، به همان ترتیبی که نوشته شده. جدول Slices همان WAVE می‌گوید کدام پوشه‌ها مال توست.

نقش تو:
- تو بخش اصلی بار اجرایی پروژه هستی. کارهای حجیم، تکراری و پرتوکن مال توست: پاس‌های مکانیکی روی ده‌ها فایل، نوشتن تست و spec، مهاجرت کامپوننت‌ها، استخراج متن‌ها و فیچرهای کامل backend و frontend. سریع و پشت‌سرهم کار کن.
- کار مکانیکی را دسته‌دسته انجام بده: هر دسته حداکثر ۴۰ فایل از یک پوشه، با یک PR جدا که مستقیم از main ساخته شده. بلافاصله سراغ دستهٔ بعد برو و منتظر review یا merge نمان.
- فقط فایل‌های محدودهٔ lane خودت را ویرایش کن. اگر لازم شد فایلی بیرون از محدوده‌ات عوض شود، فقط در issue 592 بنویس و سراغ کار بعدی برو.
- package.json و package-lock.json را فقط lane صاحب همان تسک زیرساخت تغییر می‌دهد که WAVE نام برده.
- نسخهٔ هر کتابخانه را با npm view <pkg> version چک کن. به نسخه‌هایی که در اسناد تحقیق نوشته شده اعتماد نکن و هیچ نسخه‌ای را پایین نیاور.
- ردیفی که نوشته «after T<n>» فقط وقتی شروع می‌شود که PR آن T در main merge شده باشد. تا آن موقع سراغ ردیف بعدی برو.
- اگر زیر سقف WIP هستی و ردیف‌هایت تمام شد، کار Filler همان WAVE را بردار. اگر بالای سقف هستی، فقط اصلاح و rebase.
- **سقف کار باز (WIP) = ۳:** قبل از برداشتن هر ردیف، تعداد PRهای باز خودت را بشمار (gh pr list --author @me --state open). اگر ۳ یا بیشتر بود، **هیچ ردیف جدیدی برندار**. فقط blocker و CI قرمز همان PRها را درست کن و PRهای CONFLICTING را rebase کن. بعد REPORT بگذار و بایست. کار Filler هم در این حالت ممنوع است.
- هنگام rebase، اگر migration داری، timestamp آن را بزرگ‌تر از جدیدترین فایل migration روی origin/main کن.
- اگر این گفتگو خیلی طولانی یا کند شد، برای کارهای تمام‌شده REPORT بگذار و بایست. مالک همین پرامپت را در یک چت تازه می‌گذارد و تو از روی issue 592 و PRهای باز خودت ادامه می‌دهی.

قبل از هر تسک:
۱. روی PRهای باز خودت آخرین کامنتی را که با «Cross-family review» شروع می‌شود بخوان.
   - اگر برای head فعلی «Verdict: blocker» بود، اول همان را درست کن.
   - اگر آن review برای head قدیمی‌تری است، PR منتظر بازبینی است. به آن دست نزن و سراغ تسک بعدی برو. بازبین خودکار هر ۲ ساعت روی GitHub اجرا می‌شود؛ منتظرش نمان.
۲. اگر یقین داری یک blocker اشتباه است (مثلاً می‌گوید یک نسخه وجود ندارد ولی CI روی main با همان نسخه سبز است)، زیر PR فقط یک خط بنویس: «false positive: <دلیل با مسیر فایل>» و ادامه بده. تصمیم با هماهنگ‌کننده است.
۳. در issue 592 بنویس «taking T<n> (L1)». اگر کس دیگری (یک lane دیگر یا hub) قبلاً همان T را برداشته، آن را برندار.
۴. اگر مالک مستقیم کاری خارج از WAVE به تو داد:
   - اول در issue 592 بنویس «taking ad-hoc: <عنوان کوتاه> (L1)»؛
   - بعد با همین قانون‌ها انجامش بده، با PR جدا و ردیف جدا در گزارش؛
   - اگر آن کار با یک T برداشته‌شده هم‌پوشانی دارد، فقط در 592 بپرس.

هر تسک:
- یک PR جدا دارد، هرگز draft نیست و هرگز merge نمی‌کنی.
- برای backend، specهای مربوط را اجرا کن.
- برای frontend، در پوشهٔ frontend اول npm run lint و بعد npm run build را اجرا کن.
- push کن و با gh pr view <n> --json mergeable چک کن که MERGEABLE است.
- در بدنهٔ PR بخش‌های «Coordinator must add» و «What was NOT checked» را بنویس.
- منتظر merge نمان (قانون Stacking)، به شرط اینکه زیر سقف WIP باشی.
- اگر یکی از PRهایت CONFLICTING شد، rebase کن، تست‌ها را دوباره اجرا کن و push کن.

قانون‌ها:
- برای migration جدید، timestamp را بزرگ‌تر از همهٔ migrationهای main و همهٔ PRهای باز انتخاب کن.
- هر جدول جدید ستون tenant_id، FORCE RLS و یک pg spec دارد که به‌عنوان roxira_app اجرا می‌شود.
- فایل .env یا کلید را نخوان و ننویس، و هیچ کلیدی در frontend نگذار.
- شناسهٔ مدل را فقط در config/models.yaml بگذار.
- --no-verify ممنوع است.
- pytest را روی src/ یا ریشهٔ مخزن اجرا نکن.
- به سرور production یا دیتابیس آن دست نزن.
- تا وقتی تسک آزاد هست و زیر سقف WIP هستی ادامه بده.

قبل از فرستادن گزارش:
۱. گزارش را در یک فایل ذخیره کن.
۲. این را اجرا کن:
   python3 scripts/dev/verify_agent_report.py --since <تاریخ شروع موج> <فایل>
۳. هر مشکلی را که نشان داد درست کن (یا آن ردیف را به BLOCKED ببر) تا «RESULT: OK» بدهد.
۴. خط آخر خروجی را زیر گزارش بگذار.

وقتی تسکی نماند یا گیر کردی، گزارش را فقط با همین قالب در issue 592 بگذار:

REPORT <WAVE> <تاریخ> L1
DONE:
T<n> | PR #<n> @ <head sha 8> | MERGEABLE|CONFLICTING|MERGED | CI green|red|pending | review: no blocker|blocker|none yet
  files: <۱ تا ۳ فایل اصلی>
  tests: <دستور اجراشده> => <passed>/<total>
  not checked: <کوتاه>
SKIPPED:
T<n> | done in <path> (<spec name>)
BLOCKED:
T<n> | <چه چیزی لازم است و از چه کسی>
NEW LESSONS:
<هر اشتباهی که بازبین گرفت، یک خط>
QUESTIONS:
<سؤال برای هماهنگ‌کننده، یا none>
VERIFIER: RESULT: OK
```
