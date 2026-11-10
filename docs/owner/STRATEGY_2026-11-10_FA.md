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
| دیسک | امروز به ۹۶٪ رسید؛ نگهبان دیسک ساعتی خودش پاک کرد؛ الان ۷۶٪ | کار می‌کند؛ بند ۳-ب آن را دائمی حل می‌کند |
| سرور | ۴ هسته، ۷٫۵ گیگ رم (۳٫۵ گیگ آزاد)، ۲۸ روز بدون ری‌استارت | فعلاً کافی است؛ خرید سرور بزرگ‌تر لازم نیست |

کارهایی که **نباید** بکنیم (هزینه دارند و الان سودی ندارند): Kubernetes، microservice، ارتقای Postgres به ۱۸، سرور بزرگ‌تر، ابزار پولی مانیتورینگ.

## ۲. تنها ریسک بزرگ: کاربر ایرانی در قطعی اینترنت

roxira.ir برای مشتری ایرانی است، ولی سرور در آلمان است. در دوره‌های «اینترنت طبقاتی» یا قطعی بین‌الملل، مشتری ایرانی به نرم‌افزار حسابداری‌اش دسترسی ندارد. برای نرم‌افزاری که هر روز با آن فاکتور می‌زنند، این بزرگ‌ترین ریسک کسب‌وکار است. پژوهش قبلی (`docs/research/2026-10-31/02-product-strategy-global.md` بخش 9.5) هم همین را گفته است.

راه‌حل احتمالی یک سرور یا آینهٔ کوچک داخل ایران است. ولی هزینه، قانون نگهداری دادهٔ مالی، و نحوهٔ همگام‌سازی معلوم نیست. برای همین پرامپت دیپ ریسرچ ۱ (بند ۶) را آماده کرده‌ام. **تا جواب آن نیامده، چیزی نخرید.**

## ۳. بهبودهای کم‌هزینه (به ترتیب)

| # | کار | چرا | هزینه | چه کسی |
|---|---|---|---|---|
| الف | قبل از اولین مشتری پولی: مدل‌های رایگانی که داده را ذخیره می‌کنند برای دادهٔ مشتری خاموش شوند | قانون AGENTS.md این را لازم می‌داند؛ الان چون همه حساب تست‌اند مجاز است | صفر | من، وقتی شما بگویید اولین مشتری واقعی آمد |
| ب | ساخت imageها در GitHub Actions (رایگان برای ریپوی عمومی) به‌جای ساخت روی سرور prod | امروز ۳۳ deploy روی خود سرور ساخته شد و دیسک را ۹۶٪ کرد؛ deploy سریع‌تر و rollback فوری می‌شود | صفر | Antigravity (WAVE 5)، با تأیید شما چون به workflow و deploy دست می‌زند |
| ج | ثابت کردن نسخهٔ imageهای `latest` (`pgbouncer`، `searxng`، `nginx:alpine`) | یک به‌روزرسانی ناخواسته می‌تواند سایت را بخواباند | صفر | Antigravity (WAVE 5) |
| د | چک اینکه کلیدهای قدیمی که در تاریخچهٔ ریپوی خصوصی بودند عوض شده‌اند | گزارش ۳ نوامبر: کلیدهای search و Kira در تاریخچه بودند | صفر | شما (بند ۵) |

## ۴. مدل کار (برای اینکه کمتر به لیمیت بخوریم)

```
Antigravity  ← کارهای سطح پایین و متوسط (ساخت، تست، rebase)؛ مدل خودش، هزینهٔ ما صفر
لپتاپ        ← کارهای #227 با OpenCode و gateway (اول رایگان)
بازبین ساعتی ← بررسی همهٔ PRها با DeepSeek (چند سنت) و ادغام خودکار PRهای سالم
من (Claude)  ← فقط استراتژی و بازبینی نهایی: یک بار بعد از هر گزارش Antigravity
```

چرخهٔ کار:
۱. شما پرامپت ثابت (بند ۷) را به Antigravity می‌دهید.
۲. Antigravity کار می‌کند و آخر کار یک «گزارش کوتاه» با قالب ثابت می‌دهد.
۳. شما همان گزارش را برای من paste می‌کنید.
۴. من مدرک‌ها را چک می‌کنم، #230 را تیک می‌زنم، و صف بعدی (WAVE بعدی) را در issue 592 می‌نویسم.

## ۵. کارهایی که فقط شما می‌توانید بکنید (حیاتی)

۱. **وقتی اولین مشتری پولی واقعی نزدیک شد به من خبر بدهید.** قبل از آن باید بند ۳-الف و صفحهٔ حریم خصوصی عوض شوند.
۲. **چک کلیدهای قدیمی (۱۰ دقیقه):** اگر بعد از ۳ نوامبر کلیدهای search و Kira را عوض نکرده‌اید، در پنل همان سرویس‌ها کلید جدید بسازید و با `scripts/dev/set_secret.sh` جایگزین کنید. اگر عوض کرده‌اید، فقط به من بگویید «عوض شده».
۳. **دیپ ریسرچ ۱ و ۲ (بند ۶)** را اجرا کنید و جواب را برای من بفرستید.

## ۶. پرامپت‌های دیپ ریسرچ

### دیپ ریسرچ ۱: میزبانی داخل ایران برای نرم‌افزار حسابداری ابری

```
I run a small cloud accounting/ERP SaaS for Iranian businesses (roxira.ir). Today it runs on one Hetzner server in Germany (4 vCPU, 8 GB RAM, Docker Compose: NestJS, Next.js, Postgres 17, Redis, Qdrant, nginx) behind Cloudflare. Customers are inside Iran. I need the cheapest reliable way to keep the product usable for Iranian customers during international internet disruptions (tiered internet / whitelisting / full international cut-offs, as seen in 2019, 2022, 2025).

Research and answer with sources (prefer 2025-2026 sources, Persian and English):
1. Iranian cloud providers for a small production workload (ArvanCloud, Abr Arvan, Sotoon, ParsPack, Asiatech, Afranet, Mobinhost, others): monthly price in rials for ~4 vCPU / 8 GB / 100 GB SSD, managed Postgres availability, object storage, backups, SLA, payment methods for a foreign-registered or Iranian-registered owner.
2. Laws and rules: does Iranian law (e.g. e-commerce, Moadian/tax system, data protection bills, NIN rules, e-namad requirements) require accounting or invoice data of Iranian companies to be stored inside Iran? Does an e-namad or Moadian "trusted company" status depend on domestic hosting?
3. Reachability: during past shutdowns, which hosting locations stayed reachable from inside Iran (domestic data centres on the National Information Network, domestic CDNs in front of foreign origins)? Did domestic CDN in front of a foreign origin still work when international links were cut?
4. Architecture options with monthly cost and complexity for a one-person team: (a) domestic CDN in front of the German server; (b) a domestic read-only mirror; (c) a domestic primary with offsite backups abroad; (d) a domestic warm standby with Postgres logical replication and manual failover. Which do small Iranian SaaS companies actually use?
5. Sanctions and payment risk for the owner of each option, and how to move data between Iran and Germany legally and safely.

Output: a comparison table (option, monthly cost in rials and USD, works during full cut-off yes/no, legal fit, effort), then one recommendation for a budget under 3 million tomans per month, and a 5-step migration plan.
```

### دیپ ریسرچ ۲: اولویت امکانات در برابر رقبای ایرانی

```
For the Iranian small and medium business accounting software market in 2026 (Sepidar, Mahak, Holoo, Hamkaran System, Rahkaran, Kasra, Tadbir, and cloud newcomers like Hesabfa, Parsian, Tik8, and others you find), research with sources:
1. Which features customers say they cannot live without (reviews, forums, Telegram groups, Divar/Torob comments, vendor sales pages), ranked by how often they appear.
2. Each product's price for a small business (one company, 2-3 users) per year, cloud vs desktop, and what is in the cheapest plan.
3. Moadian (سامانه مودیان) integration: which products send invoices directly, which need a trusted company (شرکت معتمد), and the per-invoice cost.
4. Top complaints about each product (support, speed, migration, price, bugs).
5. What makes a business switch from desktop accounting to cloud, and what blocks it (data migration from Sepidar/Holoo backups, internet cuts, trust).
Output: a feature priority table (feature, how many competitors have it, how often customers ask for it, difficulty), a price table, and the 10 features a new cloud product must have to win a switching customer.
```

## ۷. پرامپت ثابت Antigravity (هر بار همین را بدهید)

```
اول docs/agents/LESSONS.md را کامل بخوان. بعد issue 592 را باز کن و آخرین کامنتی را که با «## WAVE» شروع می‌شود بخوان؛ صف کار تو همان است. تسک‌ها را به ترتیب بردار: برای هر کدام اول در issue 592 بنویس «taking T<n>»، کار را در یک PR جدا انجام بده، specها را اجرا کن، push کن، و با gh pr view <n> --json mergeable چک کن که MERGEABLE است. در هر PR بخش‌های «Coordinator must add» و «What was NOT checked» را بنویس. منتظر merge نمان (قانون Stacking). هیچ‌وقت merge نکن؛ بازبین ساعتی این کار را می‌کند. اگر بازبین روی PR تو «Verdict: blocker» نوشت، اول همان را درست کن. هر PR تو که CONFLICTING شد، rebase کن، specها را اجرا کن و push کن (T37). در هر گزارش فقط مسیری را بنویس که خودت باز کرده‌ای. تا وقتی تسک آزاد هست ادامه بده.

وقتی تسکی نماند یا گیر کردی، فقط این گزارش را بده، دقیقاً با همین قالب و بدون توضیح اضافه:

REPORT <WAVE> <تاریخ>
DONE:
T<n> | PR #<n> | MERGEABLE|CONFLICTING|MERGED | CI green|red|pending | not checked: <کوتاه>
SKIPPED:
T<n> | <دلیل یک‌خطی>
BLOCKED:
T<n> | <چه چیزی لازم است و از چه کسی>
NEW LESSONS:
<هر اشتباهی که بازبین گرفت، یک خط>
QUESTIONS:
<سؤال برای هماهنگ‌کننده، یا none>
```

## ۸. صف بعدی (WAVE 5، بعد از گزارش WAVE 4 در issue 592 نوشته می‌شود)

- ساخت imageها در GitHub Actions و pull روی سرور (بند ۳-ب)
- ثابت کردن نسخهٔ imageها (بند ۳-ج)
- کمبودهایی از #230 که WAVE 4 به آن‌ها نرسید
- نتیجهٔ دیپ ریسرچ ۱ و ۲ به تسک تبدیل می‌شود
