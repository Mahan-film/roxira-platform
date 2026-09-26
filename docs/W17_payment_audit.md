# W17 — حسابرسی مسیر پرداخت ghazihoushmand.ir

## خلاصهٔ حکم
کاربر واقعی امروز **پول واقعی پرداخت نمی‌کند**. دکمهٔ پرداخت در رابط کاربری زنده
(`PaymentCheckoutModal.tsx`) فقط به یک اندپوینت stub وصل است که لینک ساختگی
ZarinPal (`SANDBOX_...`) برمی‌گرداند و اصلاً به بانک/شاپرک وصل نمی‌شود. حتی همین
کامپوننت در هیچ صفحهٔ زندهٔ اپ (`app/judge/page.tsx`) import نشده — یعنی مسیر UI
که این fetch را صدا می‌زند احتمالاً از نسخهٔ قبلی سایت مانده یا از مسیر دیگری صدا
زده می‌شود که در این ریپو دیده نشد؛ لاگ سرور ۵ فراخوانی واقعی آن را در ۱۴ روز
اخیر ثبت کرده است.

## نقشهٔ جریان فعلی (متنی)
```
کاربر → PaymentCheckoutModal → POST /api/v1/apps/judge/payments/create-invoice
        [STUB — مبلغ هاردکد ۹۹,۰۰۰/۴۹۰,۰۰۰ تومان، شماره پیش‌فرض ۰۹۱۲۹۳۶۷۷۹۶]
        → payment_url ساختگی «payment.zarinpal.com/pg/StartPay/SANDBOX_xxx»
        → کاربر به هیچ درگاه واقعی نمی‌رسد → پولی منتقل نمی‌شود
        (اگر UI بعداً /payments/verify را صدا بزند: همیشه status=PAID برمی‌گرداند،
         بدون هیچ استعلام واقعی؛ authority پیش‌فرض هم "MOCK_AUTH_SUCCESS")

مسیر واقعی و کارکردی (ولی صدا زده نمی‌شود):
app → POST /api/v1/payment/zibal/checkout → zibal_service.create_payment_request
    → gateway.zibal.ir/v1/request واقعی → کاربر به درگاه واقعی زیبال می‌رود
    → GET /api/v1/payment/zibal/callback → zibal_service.verify_payment
    → gateway.zibal.ir/v1/verify واقعی → activate_user_subscription (فقط dict، بدون DB!)
```
همین روتر واقعی یک‌بار دیگر هم زیر `smartjudge_module.py` (خط ۴۷۰۳ و ۴۷۱۳)
mount می‌شود؛ تلاش برای `app.include_router` در آنجا با NameError شکست می‌خورد
(نام `app` در آن اسکوپ تعریف نشده) و به‌صورت خاموش روی `router` می‌افتد —
نتیجه یک مسیر تکراری بی‌فایده `/api/v1/apps/judge/api/v1/payment/zibal/...` است.

## واقعی در برابر Stub
| اندپوینت | وضعیت |
|---|---|
| `/payments/create-invoice` | **Stub** — لینک ساختگی، بدون تماس با بانک |
| `/payments/verify` | **Stub** — همیشه PAID برمی‌گرداند، بدون استعلام واقعی |
| `/payments/zibal/create-invoice` | **Stub** — track_id و URL جعلی می‌سازد |
| `/payments/crypto/create-invoice` | نیمه‌واقعی — والت هاردکد، تأیید تراکنش کاملاً دستی |
| `/payments/pricing-matrix` | واقعی — محاسبهٔ پویا بر پایه نرخ دلار |
| `/api/v1/payment/zibal/checkout` + `/callback` (`router_payment.py`/`zibal_service.py`) | **واقعی** — تماس واقعی با gateway.zibal.ir، ولی هیچ‌جا از UI صدا زده نمی‌شود؛ ۰ فراخوانی در ۱۴ روز اخیر |
| `activate_user_subscription` | حتی در مسیر واقعی، فقط dict برمی‌گرداند — **هیچ‌جا در DB ذخیره نمی‌شود** و دسترسی VIP در عمل فقط از JWT claim / لیست سفید شماره تلفن (`VIP_PHONE_ALLOWLIST`) خوانده می‌شود، نه از نتیجهٔ پرداخت |

ناسازگاری قیمت: pricing-matrix برای `SINGLE_DRAFT` رقم واقعی حدود
۶۲۵,۰۰۰ تومان (۲.۵$ × نرخ روز) می‌دهد، در حالی‌که stub همان پلن را
۹۹,۰۰۰ تومان نشان می‌دهد — فاصلهٔ حدود ۶ برابری.

## ریسک‌ها (به ترتیب شدت)
1. **از دست رفتن درآمد (Critical)** — مسیر پرداخت واقعی زیبال هیچ‌گاه فراخوانی
   نمی‌شود؛ هر خریدی که کاربر «انجام می‌دهد» در واقع رخ نداده.
2. **کلاه‌برداری/دسترسی رایگان (Critical)** — `/payments/verify` بدون بررسی
   واقعی PAID برمی‌گرداند؛ اگر UI به آن متکی شود، دسترسی VIP بدون پرداخت
   ممکن می‌شود. مسیر crypto هم صرفاً بر پایهٔ اعلام دستی TxHash است، بدون
   بررسی on-chain.
3. **قطع بودن فعال‌سازی حتی در مسیر واقعی (High)** — `activate_user_subscription`
   چیزی در Postgres نمی‌نویسد؛ حتی پرداخت موفق زیبال اشتراک را برای مراجعات
   بعدی فعال نمی‌کند.
4. **UX/داده نادرست (Medium)** — شمارهٔ تلفن پیش‌فرض هاردکد
   (`09129367796`) در چند اندپوینت، و مغایرت قیمت stub در برابر pricing-matrix.

## طرح رفع — تصمیم‌های مالک
- تأیید این‌که مرچنت کد زیبال (env: `ZIBAL_MERCHANT`) واقعی و متعلق به کسب‌وکار
  فعال روی درگاه است (فقط نام env بررسی شد، مقدار خوانده نشد).
- انتخاب این‌که آیا مسیر ZarinPal اصلاً لازم است یا زیبال تنها درگاه رسمی باشد.
- تصمیم دربارهٔ حذف/غیرفعال‌سازی کامل مسیر crypto تا پیاده‌سازی تأیید on-chain.

## طرح رفع — تغییرات کد (پیشنهادی، اجرا نشده)
- حذف یا قفل‌کردن stubهای `create-invoice`/`verify`/`zibal/create-invoice` در
  `smartjudge_module.py` پشت یک فلگ محیطی، و اتصال UI به `/api/v1/payment/zibal/checkout`.
- افزودن جدول Postgres برای subscription و نوشتن واقعی در `activate_user_subscription`.
- حذف mount تکراری زیر `smartjudge_module.py` (خطوط ۴۷۰۳ و ۴۷۰۸-۴۷۱۳).
- یکسان‌سازی قیمت‌ها: همه از `get_calculated_pricing()` بخوانند، نه اعداد هاردکد.
- حذف شمارهٔ تلفن پیش‌فرض هاردکد از همهٔ اندپوینت‌های پرداخت.
