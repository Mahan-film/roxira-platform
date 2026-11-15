# Standing Antigravity prompt (updated 2026-11-15)

Paste the same text into each of the 4 chats. Only change the first line: L1, L2, L3 or L4.

---

```
تو lane L1 هستی. /boost اول docs/agents/LESSONS.md را کامل بخوان. بعد issue 592 را باز کن و آخرین کامنتی را که با «## WAVE» شروع می‌شود بخوان؛ فقط ردیف‌های lane خودت صف کار توست.

قبل از هر تسک:
۱. روی PRهای باز خودت آخرین کامنتی را که با «Cross-family review» شروع می‌شود بخوان. اگر برای head فعلی «Verdict: blocker» بود، اول همان را درست کن. اگر آن review برای head قدیمی‌تری است، PR منتظر بازبینی است؛ به آن دست نزن و سراغ تسک بعدی برو. بازبین خودکار هر ۲ ساعت روی GitHub اجرا می‌شود؛ منتظرش نمان.
۲. اگر یقین داری یک blocker اشتباه است (مثلاً می‌گوید یک نسخه وجود ندارد ولی CI روی main با همان نسخه سبز است)، زیر PR فقط یک خط بنویس: «false positive: <دلیل با مسیر فایل>». بعد ادامه بده. تصمیم با هماهنگ‌کننده است.
۳. در issue 592 بنویس «taking T<n> (L1)». اگر کس دیگری (یک lane دیگر یا hub) قبلاً همان T را برداشته، آن را برندار.

هر تسک:
- یک PR جدا داشته باشد.
- specها را اجرا کن، push کن و با gh pr view <n> --json mergeable چک کن که MERGEABLE است.
- در بدنهٔ PR بخش‌های «Coordinator must add» و «What was NOT checked» را بنویس.
- منتظر merge نمان (قانون Stacking). هیچ‌وقت merge نکن.
- اگر یکی از PRهایت CONFLICTING شد، rebase کن، specها را اجرا کن و push کن.

قانون‌ها:
- برای migration جدید، timestamp را بزرگ‌تر از همهٔ migrationهای main و همهٔ PRهای باز انتخاب کن.
- فایل .env یا کلید را نخوان و ننویس.
- شناسهٔ مدل را فقط در config/models.yaml بگذار.
- --no-verify ممنوع است.
- pytest را روی src/ یا ریشهٔ مخزن اجرا نکن.
- تا وقتی تسک آزاد هست ادامه بده.

قبل از فرستادن گزارش، آن را در یک فایل ذخیره کن و این را اجرا کن:
python3 scripts/dev/verify_agent_report.py --since <تاریخ شروع موج> <فایل>
هر مشکلی را که نشان داد درست کن (یا آن ردیف را به BLOCKED ببر) تا «RESULT: OK» بدهد، و خط آخرش را زیر گزارش بگذار.

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
