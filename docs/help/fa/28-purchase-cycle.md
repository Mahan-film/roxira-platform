<!-- Sources (origin/main):
  output_apps/enterprise_hub/modules/inventory/purchasing/purchase.controller.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/purchase.dto.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/purchase-cycle.service.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/supplier-invoice.controller.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/supplier-invoice.service.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/supplier-invoice.dto.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/invoice-match.domain.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/landed-cost.controller.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/landed-cost.dto.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/landed-cost.domain.ts
  output_apps/enterprise_hub/modules/inventory/purchasing/purchase-posting.adapter.ts
-->

# چرخهٔ خرید، تطبیق سه‌جانبه (3-Way Match) و هزینهٔ سربار خرید

چرخهٔ تدارکات و خرید در روکسیرا شامل درخواست خرید، سفارش خرید، رسید انبار، صورتحساب تأمین‌کننده با **تطبیق سه‌جانبه (3-Way Match)** و تخصیص **هزینهٔ سربار خرید (Landed Cost)** به لایه‌های FIFO است.

## ۱. درخواست خرید و سفارش خرید (PR & PO)

- **درخواست خرید (`POST /enterprise-hub/inventory/purchasing/requests`)**: ثبت نیاز کالا (`sku` و `quantity` به صدم واحد؛ مثلاً `"1000"` معادل `10.00`).
- **تبدیل درخواست به سفارش (`POST .../requests/:id/convert`)**: با تعیین کد تأمین‌کننده (`supplierCode`)، تاریخ سفارش (`orderDate`) و جدول قیمت واحد هر کالا (`prices` به صدم ریال)، درخواست به یک سفارش خرید تبدیل می‌شود.
- **ثبت مستقیم سفارش خرید (`POST /enterprise-hub/inventory/purchasing/orders`)**: ثبت سفارش خرید با سطرهای شامل `sku`، `quantity` و `unitPrice`.
- **تأیید و لغو سفارش**:
  - `POST .../orders/:id/approve`: تأیید سفارش خرید (وضعیت `DRAFT` به `APPROVED`) و نیازمند دسترسی تأیید (`approve`). در این نسخه، جلوگیری از اینکه ثبت‌کنندهٔ سفارش خودش آن را تأیید کند **پیاده‌سازی نشده** است.
  - `POST .../orders/:id/cancel`: لغو سفارش خرید.
  - `POST .../orders/:id/close`: بستن سفارش خرید.

## ۲. رسید کالا و حساب واسط GRNI

- با `POST /enterprise-hub/inventory/purchasing/orders/:id/receipts` دریافت کامل یا جزئی سطرهای یک سفارش تأییدشده ثبت می‌شود (با امکان تعیین وزن `weight` برای تسهیم کرایه حمل و `idempotencyKey` برای جلوگیری از تکرار).
- **کنترل اضافه‌دریافت**: مجموع مقدار دریافتی هر سطر سفارش حداکثر تا سقف تلورانس اضافه‌دریافت سازمان (`overReceiptToleranceBp` بر حسب صدم درصد) مجاز است.
- **ثبت لایهٔ FIFO و سند حسابداری**: به محض ثبت رسید، لایهٔ FIFO به بهای سفارش در انبار ایجاد شده و سند حسابداری **بدهکار موجودی کالا (`INVENTORY`) / بستانکار کالای رسیدهٔ فاکتورنشده (`GRNI`)** صادر می‌شود.

## ۳. صورتحساب تأمین‌کننده و تطبیق سه‌جانبه (3-Way Match)

صورتحساب تأمین‌کننده با `POST /enterprise-hub/inventory/purchasing/orders/:orderId/invoices` ثبت می‌شود (فهرست: `GET /enterprise-hub/inventory/purchasing/invoices`). هر سطر صورتحساب (`receiptLineId`، `quantity`، `unitPrice`) به صورت خودکار با **مقدار رسید کالا** و **قیمت واحد سفارش خرید** مقایسه می‌شود:

- **تلورانس‌های تطبیق** (قابل تنظیم از طریق `PUT /enterprise-hub/inventory/purchasing/settings` یا صفحهٔ `/app/settings/policies`):
  - `purchase.three_way.qty_excess_tolerance_bp`: تلورانس مقدار اضافهٔ صورتحساب نسبت به رسید (صدم درصد).
  - `priceToleranceBp`: تلورانس درصدی اختلاف قیمت واحد صورتحساب با سفارش (صدم درصد).
  - `priceToleranceAbs`: تلورانس مطلق اختلاف قیمت هر سطر (صدم ریال).
- **وضعیت تطبیق هر سطر (`matchStatus`)**: `MATCHED` (منطبق)، `QTY_MISMATCH` (مغایرت مقدار)، `PRICE_MISMATCH` (مغایرت قیمت) یا `QTY_AND_PRICE_MISMATCH` (مغایرت هم‌زمان مقدار و قیمت).
- اگر تمام سطرها در محدودهٔ تلورانس باشند، وضعیت صورتحساب `MATCHED` می‌شود؛ در غیر این صورت صورتحساب در وضعیت **معلق (`HELD`)** قرار می‌گیرد.

## ۴. پذیرش مغایرت و قطعی‌سازی صورتحساب خرید

- **پذیرش صورتحساب معلق (`POST .../invoices/:id/accept`)**: نیازمند ثبت دلیل (`note`، بین ۳ تا ۵۰۰ نویسه) است. قاعدهٔ سازمانی `purchase.invoice_review.reviewer_rule` تعیین می‌کند که آیا تأییدکننده حتماً باید غیر از ثبت‌کننده باشد (`always_differs`، پیش‌فرض)، فقط در صورت نبود تأییدکنندهٔ دیگر مجاز باشد (`differs_unless_sole_approver`) یا ثبت‌کننده هم بتواند تأیید کند (`creator_may_accept`، با ثبت پرچم `acceptedByCreator`).
- **قطعی‌سازی (`POST .../invoices/:id/post`)**: برای صورتحساب‌های `MATCHED` یا پذیرفته‌شده اجرا می‌شود و سند حسابداری را ثبت می‌کند: تسویهٔ حساب واسط **`GRNI`**، ثبت **انحراف قیمت خرید** (نقش حساب `PRICE_VARIANCE`)، ثبت **مالیات بر ارزش افزودهٔ خرید (`VAT`)** و بستانکار کردن **حساب‌های پرداختنی تأمین‌کننده (`AP`)**.

## ۵. تخصیص هزینهٔ سربار خرید (Landed Cost)

با `POST /enterprise-hub/inventory/purchasing/receipts/:id/landed-costs` هزینه‌های جانبی یک رسید کالا ثبت و تسهیم می‌شود:

- **دستهٔ هزینه (`category`)**: حمل (`FREIGHT`)، گمرک (`CUSTOMS`)، بیمه (`INSURANCE`) یا سایر (`OTHER`).
- **مبنای تسهیم (`basis`)**: به نسبت **ارزش ریالی (`VALUE`)**، **مقدار (`QUANTITY`)** یا **وزن (`WEIGHT`)** سطرهای رسید (به روش بزرگ‌ترین باقی‌مانده تا جمع سهم‌ها دقیقاً برابر مبلغ کل هزینه شود).
- **تفکیک بین موجودی انبار و بهای تمام‌شده**: برای هر سطر رسید، سهم بخش باقی‌مانده در لایهٔ FIFO (`toInventory`) بهای واحد لایهٔ موجودی را افزایش می‌دهد و سهم بخشی که قبلاً فروخته یا مصرف شده است (`toCogs`) مستقیماً به حساب **بهای تمام‌شدهٔ کالای فروش‌رفته (COGS)** منظور می‌شود.

> **وضعیت رابط کاربری**: ثبت رسید مستقیم انبار در `/app/inventory` و تنظیم قواعد تلورانس و بازبین صورتحساب خرید در `/app/settings/policies` فعال است. صفحات رابط کاربری اختصاصی سفارش خرید، صورتحساب تأمین‌کننده و هزینهٔ سربار خرید: `TODO: not built yet` (از طریق API در دسترس هستند).
