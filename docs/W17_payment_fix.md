# W17 — رفع مسیر پرداخت (پولِ واقعی)

## چه چیزی عوض شد
- `/payments/create-invoice` و `/payments/verify` دیگر stub نیستند: مسیر واقعی
  `zibal_service.create_payment_request` / `verify_payment` را صدا می‌زنند.
  قیمت فقط از `get_calculated_pricing()` سمت سرور خوانده می‌شود؛ کلاینت هرگز
  مبلغ تعیین نمی‌کند. `plan_type` نامعتبر → ۴۰۰. شماره تلفن هاردکد حذف شد.
- `verify` با `track_id` واقعی نزد زیبال استعلام می‌گیرد، مبلغ را با فاکتور
  ذخیره‌شده مطابقت می‌دهد و idempotent است (تراکنش paid دوباره فعال نمی‌شود).
- جدول Postgres جدید `payment_orders` (id, track_id, plan_type, amount_rial,
  status, phone/user_ref, created_at, paid_at, gateway_ref_number). چون این
  لایه پایتون ابزار migration ندارد (migrations فعلی فقط برای NestJS است)،
  مثل بقیه schema این لایه با `CREATE TABLE IF NOT EXISTS` idempotent ساخته
  می‌شود (`payment_orders.py`).
- `activate_user_subscription` حالا واقعاً در Postgres می‌نویسد
  (`user_entitlements`، upsert)، نه فقط یک dict.
- همه‌چیز پشت فلگ `PAYMENTS_LIVE` (پیش‌فرض خاموش): وقتی خاموش، create-invoice
  و verify به‌جای موفقیت جعلی ۵۰۳ می‌دهند.
- پرداخت کریپتو پشت `PAYMENTS_CRYPTO_ENABLED` (پیش‌فرض خاموش) همیشه ۵۰۳
  می‌دهد — تا زمانی‌که تایید on-chain واقعی پیاده‌سازی شود.
- mount تکراری روتر زیبال در `smartjudge_module.py` حذف شد (مسیر خراب و
  بی‌فایده `/api/v1/apps/judge/api/v1/payment/zibal/...`)؛ mount واقعی فقط
  یک‌بار، مستقیم روی `app` در `run_unified_server.py` باقی می‌ماند.
- Frontend: `PaymentCheckoutModal.tsx` به `payment_url` واقعی زیبال ریدایرکت
  می‌شود؛ صفحه بازگشت جدید `judge/payment/callback` نتیجه را از `/payments/verify`
  می‌خواند و paid/failed/در-حال-تلاش-دوباره نشان می‌دهد.

## رفع بازخورد هاب روی PR #53
- خطای گذرا/شبکه در verify دیگر سفارش را برای همیشه failed نمی‌کند: فقط پاسخ
  قطعی زیبال (result=202) اجازهٔ `mark_failed` می‌دهد؛ پاسخ نامشخص/خطای شبکه
  → `PENDING_RETRY` (HTTP ۵۰۳)، سفارش pending می‌ماند و قابل تلاش دوباره است.
  `mark_paid` حالا هم از pending و هم از failed به paid منتقل می‌کند (بازیابی
  failed→paid) و اتمیک است (race بین دو verify هم‌زمان امن).
- `create-invoice` بدون هویت (JWT معتبر یا موبایل معتبر) ۴۰۰ می‌دهد — دیگر
  فاکتوری بدون گیرنده برای فعال‌سازی ساخته نمی‌شود. هویت با `_hashed_user_ref`
  هش می‌شود و همان کلید هم در create و هم در verify/activation استفاده می‌شود.
- اگر نوشتن entitlement بعد از پرداخت موفق شکست بخورد، پرداخت paid می‌ماند
  (هرگز rollback نمی‌شود) اما پاسخ verify فیلد `activation_pending: true`
  دارد و یک خطای ERROR با track_id (بدون PII) لاگ می‌شود.

## متغیرهای محیطی (فقط نام)
`ZIBAL_MERCHANT`, `PAYMENTS_LIVE`, `PAYMENTS_CRYPTO_ENABLED`,
`ZIBAL_CALLBACK_URL` (اختیاری), `DATABASE_URL`/`POSTGRES_*` (موجود).

## چک‌لیست مالک قبل از فعال‌سازی
1. تایید کنید `ZIBAL_MERCHANT` روی سرور یک مرچنت **واقعی** است، نه sandbox.
2. در deploy، `PAYMENTS_LIVE=true` ست شود.
3. یک پرداخت واقعی با کمترین مبلغ ممکن تست شود و `payment_orders` بررسی شود.

## بازیابی دستی (reconcile) — سفارش‌های paid بدون entitlement
اگر لاگ ERROR بالا دیده شد یا لازم بود دستی بررسی شود، سفارش‌های paid که
entitlement متناظرشان در `user_entitlements` نیست را این‌طور پیدا کنید
(read-only؛ اجرای دستی روی سرور فقط با تایید مالک):

```sql
SELECT po.track_id, po.user_ref, po.plan_type, po.amount_rial, po.paid_at
FROM payment_orders po
LEFT JOIN user_entitlements ue ON ue.user_ref = po.user_ref
WHERE po.status = 'paid'
  AND (ue.user_ref IS NULL OR ue.status IS DISTINCT FROM
       (CASE po.plan_type WHEN 'PERMANENT' THEN 'PERMANENT_ACTIVE'
                          WHEN '7_DAYS_TRIAL' THEN 'TRIAL_ACTIVE'
                          ELSE 'MONTHLY_ACTIVE' END))
ORDER BY po.paid_at DESC;
```
برای هر ردیف، فعال‌سازی را دستی دوباره اجرا کنید (همان تابع
`zibal_service.activate_user_subscription(user_ref, plan_type)`) یا مستقیماً
`INSERT ... ON CONFLICT` در `user_entitlements` بزنید.

## Rollback
`PAYMENTS_LIVE=0` (یا حذف env) → بازگشت آنی به ۵۰۳ بدون تغییر کد؛ جدول
`payment_orders` دست‌نخورده می‌ماند.
