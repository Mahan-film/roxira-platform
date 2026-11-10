# استراتژی و بررسی زیرساخت (۲۰۲۶-۱۱-۱۰)

این سند پاسخ این سؤال است: «آیا باید چیزی را به‌روز یا عوض کنیم؟» و برنامهٔ ادامهٔ کار با کمترین هزینه.

## ۱. نتیجهٔ بررسی: بازنویسی یا تکنولوژی جدید لازم نیست

همهٔ این‌ها روی سرور (srv1) یا در کد چک شد:

| بخش | وضعیت | حکم |
|---|---|---|
| سیستم‌عامل، Docker | Ubuntu 26.04، Docker 29.9 | به‌روز است |
| دیتابیس | Postgres 17 با PgBouncer؛ کل داده کوچک است | ارتقا لازم نیست |
| بک‌اند و فرانت | NestJS، Next.js، Node 22 (از PR #701) | به‌روز است |
| مدل‌های AI | gateway روی سرور (LiteLLM 1.105)، اول رایگان، بعد DeepSeek؛ سقف ۲ دلار در روز | درست کار می‌کند |
| بکاپ | بکاپ روزانه، نسخهٔ خارج از سرور (Neon و Telegram)، تست بازیابی هفتگی؛ آخرین تست (۸ نوامبر) قبول شد | سالم |
| دیسک | امروز به ۹۶٪ رسید؛ نگهبان دیسک ساعتی خودش پاک کرد؛ الان ۷۶٪ | کار می‌کند؛ بند ۲-ب آن را دائمی حل می‌کند |
| سرور | ۴ هسته، ۷٫۵ گیگ رم (۳٫۵ گیگ آزاد)، ۲۸ روز بدون ری‌استارت | فعلاً کافی است؛ خرید سرور بزرگ‌تر لازم نیست |

کارهایی که **نباید** بکنیم (هزینه دارند و الان سودی ندارند): Kubernetes، microservice، ارتقای Postgres به ۱۸، سرور بزرگ‌تر، ابزار پولی مانیتورینگ.

## ۲. بهبودهای کم‌هزینه (به ترتیب)

| # | کار | چرا | هزینه | چه کسی |
|---|---|---|---|---|
| الف | قبل از اولین مشتری پولی: مدل‌های رایگانی که داده را ذخیره می‌کنند برای دادهٔ مشتری خاموش شوند | قانون AGENTS.md این را لازم می‌داند؛ الان چون همه حساب تست‌اند مجاز است | صفر | من، وقتی شما بگویید اولین مشتری واقعی آمد |
| ب | ساخت imageها در GitHub Actions (رایگان برای ریپوی عمومی) به‌جای ساخت روی سرور prod | امروز ۳۳ deploy روی خود سرور ساخته شد و دیسک را ۹۶٪ کرد؛ deploy سریع‌تر و rollback فوری می‌شود | صفر | Antigravity (WAVE 5)، با تأیید شما چون به workflow و deploy دست می‌زند |
| ج | ثابت کردن نسخهٔ imageهای `latest` (`pgbouncer`، `searxng`، `nginx:alpine`) | یک به‌روزرسانی ناخواسته می‌تواند سایت را بخواباند | صفر | Antigravity (WAVE 5) |
| د | چک اینکه کلیدهای قدیمی که در تاریخچهٔ ریپوی خصوصی بودند عوض شده‌اند | گزارش ۳ نوامبر: کلیدهای search و Kira در تاریخچه بودند | صفر | شما (بند ۵) |

## ۳. مدل کار (برای اینکه کمتر به لیمیت بخوریم)

```
Antigravity  ← کارهای سطح پایین و متوسط (ساخت، تست، rebase)؛ مدل خودش، هزینهٔ ما صفر
لپتاپ        ← کارهای #227 با OpenCode و gateway (اول رایگان)
بازبین ساعتی ← بررسی همهٔ PRها با DeepSeek (چند سنت) و ادغام خودکار PRهای سالم
من (Claude)  ← فقط استراتژی و بازبینی نهایی: یک بار بعد از هر گزارش Antigravity
```

چرخهٔ کار:
۱. شما پرامپت ثابت (بند ۶) را به Antigravity می‌دهید.
۲. Antigravity کار می‌کند و آخر کار یک «گزارش کوتاه» با قالب ثابت می‌دهد.
۳. شما همان گزارش را برای من paste می‌کنید.
۴. من مدرک‌ها را چک می‌کنم، #230 را تیک می‌زنم، و صف بعدی (WAVE بعدی) را در issue 592 می‌نویسم.

## ۴. کارهایی که فقط شما می‌توانید بکنید (حیاتی)

۱. **وقتی اولین مشتری پولی واقعی نزدیک شد به من خبر بدهید.** قبل از آن باید بند ۲-الف و صفحهٔ حریم خصوصی عوض شوند.
۲. **چک کلیدهای قدیمی (۱۰ دقیقه):** اگر بعد از ۳ نوامبر کلیدهای search و Kira را عوض نکرده‌اید، در پنل همان سرویس‌ها کلید جدید بسازید و با `scripts/dev/set_secret.sh` جایگزین کنید. اگر عوض کرده‌اید، فقط به من بگویید «عوض شده».
۳. **دیپ ریسرچ رقبا (بند ۵)** را اجرا کنید و جواب را برای من بفرستید.

## ۵. پرامپت دیپ ریسرچ

### دیپ ریسرچ: اولویت امکانات در برابر رقبای ایرانی

```
For the Iranian small and medium business accounting software market in 2026 (Sepidar, Mahak, Holoo, Hamkaran System, Rahkaran, Kasra, Tadbir, and cloud newcomers like Hesabfa, Parsian, Tik8, and others you find), research with sources:
1. Which features customers say they cannot live without (reviews, forums, Telegram groups, Divar/Torob comments, vendor sales pages), ranked by how often they appear.
2. Each product's price for a small business (one company, 2-3 users) per year, cloud vs desktop, and what is in the cheapest plan.
3. Moadian (سامانه مودیان) integration: which products send invoices directly, which need a trusted company (شرکت معتمد), and the per-invoice cost.
4. Top complaints about each product (support, speed, migration, price, bugs).
5. What makes a business switch from desktop accounting to cloud, and what blocks it (data migration from Sepidar/Holoo backups, internet cuts, trust).
Output: a feature priority table (feature, how many competitors have it, how often customers ask for it, difficulty), a price table, and the 10 features a new cloud product must have to win a switching customer.
```

## ۶. پرامپت ثابت Antigravity (هر بار همین را بدهید)

```
/boost اول docs/agents/LESSONS.md را کامل بخوان. بعد issue 592 را باز کن و آخرین کامنتی را که با «## WAVE» شروع می‌شود بخوان؛ صف کار تو همان است. تسک‌ها را به ترتیب بردار: برای هر کدام اول در issue 592 بنویس «taking T<n>»، کار را در یک PR جدا انجام بده، specها را اجرا کن، push کن، و با gh pr view <n> --json mergeable چک کن که MERGEABLE است. در هر PR بخش‌های «Coordinator must add» و «What was NOT checked» را بنویس. منتظر merge نمان (قانون Stacking). هیچ‌وقت merge نکن؛ بازبین ساعتی این کار را می‌کند. قبل از هر تسک، آخرین کامنت «Cross-family review» روی PRهای خودت را بخوان؛ اگر «Verdict: blocker» بود، اول همان را درست کن. در گزارش فقط PRهایی را بنویس که در همین موج باز یا push کرده‌ای. هر PR تو که CONFLICTING شد، rebase کن، specها را اجرا کن و push کن (T37). در هر گزارش فقط مسیری را بنویس که خودت باز کرده‌ای. تا وقتی تسک آزاد هست ادامه بده.

وقتی تسکی نماند یا گیر کردی، فقط این گزارش را بده، دقیقاً با همین قالب و بدون توضیح اضافه:

REPORT <WAVE> <تاریخ>
DONE:
T<n> | PR #<n> @ <head sha 8> | MERGEABLE|CONFLICTING|MERGED | CI green|red|pending | review: no blocker|blocker|none yet
  files: <۱ تا ۳ فایل اصلی که عوض شد>
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
```

## ۷. صف بعدی (WAVE 5، بعد از گزارش WAVE 4 در issue 592 نوشته می‌شود)

- ساخت imageها در GitHub Actions و pull روی سرور (بند ۲-ب)
- ثابت کردن نسخهٔ imageها (بند ۲-ج)
- کمبودهایی از #230 که WAVE 4 به آن‌ها نرسید
- نتیجهٔ دیپ ریسرچ رقبا به تسک تبدیل می‌شود
