<!-- Sources (origin/main):
  output_apps/enterprise_hub/modules/sales/controllers/sales.controller.ts
  output_apps/enterprise_hub/modules/sales/dto/sales.dto.ts
  output_apps/enterprise_hub/modules/sales/enums/sales-status.enum.ts
  output_apps/enterprise_hub/modules/sales/delivery/controllers/sales-delivery.controller.ts
  output_apps/enterprise_hub/modules/sales/delivery/dto/sales-delivery.dto.ts
  output_apps/enterprise_hub/modules/sales/delivery/delivery-math.ts
  output_apps/enterprise_hub/modules/sales/returns/controllers/sales-return.controller.ts
  output_apps/enterprise_hub/modules/sales/returns/dto/sales-return.dto.ts
  output_apps/enterprise_hub/modules/sales/returns/services/sales-return.service.ts
  output_apps/enterprise_hub/frontend/src/app/app/invoicing/page.tsx
-->

# چرخهٔ فروش: پیش‌فاکتور، سفارش، حوالهٔ تحویل، صورتحساب و برگشت از فروش

چرخهٔ کامل فروش در روکسیرا از پیش‌فاکتور آغاز شده و با سفارش فروش (رزرو موجودی)، حوالهٔ تحویل انبار (خروج FIFO و ثبت بهای تمام‌شده)، صدور صورتحساب فروش و در صورت نیاز برگشت از فروش تکمیل می‌شود.

## ۱. پیش‌فاکتور فروش (Quotation)

- **ثبت و ویرایش**: با `POST /enterprise-hub/sales/quotations` پیش‌فاکتور در وضعیت پیش‌نویس (`DRAFT`) با کد مشتری (`partyCode`)، تاریخ (`quoteDate`)، تاریخ اعتبار (`validUntil`) و ردیف‌های کالا (`itemId`، `quantity`، `unitPrice`، `discount`؛ تا ۲۰۰ سطر) ایجاد می‌شود. تا زمانی که پیش‌فاکتور `DRAFT` است با `PUT /enterprise-hub/sales/quotations/:id` قابل ویرایش است.
- **تغییر وضعیت**: از طریق `POST /enterprise-hub/sales/quotations/:id/status` مسیرهای مجاز این‌ها هستند: `DRAFT` به `SENT` (ارسال‌شده)؛ `SENT` به `ACCEPTED` (پذیرفته‌شده) یا `REJECTED` (ردشده)؛ و `ACCEPTED` به `REJECTED`. وضعیت `CONVERTED` (تبدیل‌شده) پایانی است.
- **تبدیل به سفارش فروش**: با `POST /enterprise-hub/sales/quotations/:id/convert` (همراه با تعیین `warehouseId` و `orderDate`)، یک سفارش فروش جدید در حالت `DRAFT` از روی پیش‌فاکتور ساخته شده و وضعیت پیش‌فاکتور به `CONVERTED` تغییر می‌یابد.

## ۲. سفارش فروش و رزرو موجودی (Sales Order)

- **ثبت مستقیم سفارش**: با `POST /enterprise-hub/sales/orders` سفارش فروش با تعیین مشتری، انبار خروج (`warehouseId`)، تاریخ سفارش (`orderDate`) و تاریخ تحویل وعده‌شده (`promisedDate`) در وضعیت `DRAFT` ثبت می‌شود.
- **استعلام موجودی قابل فروش**: مسیر `GET /enterprise-hub/sales/availability?itemIds=1,2,3` برای هر کالا سه مقدار **موجودی فیزیکی (`onHand`)**، **رزروشده در سفارش‌های تأییدشده (`reserved`)** و **قابل فروش (`available`)** را برمی‌گرداند.
- **تأیید سفارش (`POST /enterprise-hub/sales/orders/:id/confirm`)**: مقادیر سفارش را در انبار انتخاب‌شده **رزرو** می‌کند و وضعیت سفارش را به `CONFIRMED` تغییر می‌دهد. در این نسخه، سقف اعتبار مشتری و فعال بودن طرف حساب هنگام تأیید **بررسی نمی‌شود**.
- **لغو سفارش (`POST /enterprise-hub/sales/orders/:id/cancel`)**: رزرو موجودی کالاهای سفارش را آزاد کرده و سفارش را لغو می‌کند.

## ۳. حوالهٔ تحویل و پیگیری کسری ارسال (Delivery & Backorders)

- **ثبت حوالهٔ تحویل (`POST /enterprise-hub/sales/orders/:id/deliveries`)**:
  - روی یک سفارش `CONFIRMED`، خروج کامل یا جزئی هر سطر (`orderLineId` و `quantity`) ثبت می‌شود (پشتیبانی از `idempotencyKey` برای جلوگیری از ثبت تکراری).
  - سیستم موجودی را به روش **FIFO** از لایه‌های انبار خارج کرده، سند خروج انبار (`stockDocumentId`) و سند حسابداری **بهای تمام‌شدهٔ کالای فروش‌رفته (COGS) / موجودی کالا** (`journalEntryId`) را صادر می‌کند.
- **وضعیت تحویل و خطوط بازمانده (Backorder)**:
  - `GET /enterprise-hub/sales/orders/:id/fulfilment`: به ازای هر سطر سفارش، مقدار سفارش‌شده (`ordered`)، تحویل‌شده (`delivered`)، بازمانده (`backorder`) و وضعیت (`NONE`، `PARTIAL`، `COMPLETE`) را برمی‌گرداند.
  - `GET /enterprise-hub/sales/backorders`: فهرست تمام سطرهای سفارش‌های تأییدشده که هنوز کامل تحویل نشده‌اند را (با امکان فیلتر `partyCode`) نمایش می‌دهد.

## ۴. صدور صورتحساب فروش (Invoice)

- **صدور صورتحساب از روی حواله‌های تحویل (`POST /enterprise-hub/sales/invoices/from-deliveries`)**: یک یا چند حوالهٔ تحویل از یک سفارش را تجمیع کرده و صورتحساب فروش قطعی به همراه سند حسابداری (بدهکار حساب‌های دریافتنی / بستانکار درآمد فروش و مالیات بر ارزش افزوده) صادر می‌کند. هر حواله فقط یک بار قابل صورتحساب شدن است.
- **وضعیت صورتحساب سفارش (`GET /enterprise-hub/sales/orders/:id/invoicing`)**: به ازای هر سطر سفارش، مقادیر تحویل‌شده، صورتحساب‌شده و تحویل‌شدهٔ بدون صورتحساب را نشان می‌دهد.
- **صدور مستقیم صورتحساب در رابط کاربری**: در صفحهٔ **صدور فاکتور** (`/app/invoicing`) می‌توانید فاکتور فروش را مستقیماً ثبت کنید و نسخهٔ چاپی آن را باز کنید. ارسال به سامانهٔ مودیان از این صفحه در دسترس نیست.

## ۵. برگشت از فروش (Sales Return)

- با `POST /enterprise-hub/sales/invoices/:invoiceId/returns` امکان ثبت برگشت کامل یا جزئی از یک صورتحساب تحویل‌شده بر اساس `deliveryLineId` و `quantity` وجود دارد (مجموع مقادیر برگشتی هر سطر حواله نمی‌تواند از مقدار تحویل‌شده بیشتر شود).
- سیستم به صورت خودکار:
  ۱. یک صورتحساب برگشتی (`RETURN`) متصل به صورتحساب مرجع (`relatedInvoiceId`) صادر می‌کند.
  ۲. کالای برگشتی را دقیقاً با **بهای واحد تمام‌شدهٔ همان سطر حواله (هزینهٔ FIFO زمان خروج)** به انبار برمی‌گرداند.
  ۳. سند حسابداری برگشت درآمد/حساب‌های دریافتنی و برگشت بهای تمام‌شده/موجودی کالا را ثبت می‌کند.

> **وضعیت رابط کاربری**: صفحهٔ صدور و مدیریت صورتحساب در `/app/invoicing` فعال است. صفحات رابط کاربری اختصاصی برای پیش‌فاکتور، سفارش فروش، حوالهٔ تحویل و برگشت از فروش: `TODO: not built yet` (همگی از طریق APIهای بالا در دسترس هستند).
