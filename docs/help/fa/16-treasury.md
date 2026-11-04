<!-- Sources (origin/main): output_apps/enterprise_hub/modules/treasury/controllers/treasury.controller.ts, output_apps/enterprise_hub/modules/treasury/dto/treasury.dto.ts, output_apps/enterprise_hub/modules/treasury/allocation/allocation-engine.ts, output_apps/enterprise_hub/modules/treasury/enums/treasury.enum.ts, output_apps/enterprise_hub/frontend/src/print-templates/receipt-payment-voucher-a5.html, output_apps/enterprise_hub/frontend/src/components/app/app-shell.tsx -->
# خزانه: رسید دریافت و پرداخت

هنوز صفحه‌ای برای خزانه در برنامه ساخته نشده است.

TODO: not built yet — فرم ثبت و فهرست اسناد در رابط کاربری وجود ندارد؛ در حال حاضر فقط API در دسترس است.

## از طریق API
این نقطه‌های پایانی زیر ماژول **بانک و تطبیق** (نقش حسابدار) و با شناسهٔ سازمان از توکن فعال‌اند:

1. `GET /enterprise-hub/treasury/documents` — فهرست اسناد؛ فیلترهای `kind`، `partyCode`، `from` و `to`.
2. `POST /enterprise-hub/treasury/documents` — ثبت یک **رسید دریافت** (پول از مشتری) یا **رسید پرداخت** (پول به تأمین‌کننده) با فیلدهای `kind`، `partyType`، `partyCode`، `partyName`، `docDate`، `methods`، `allocations` و `description`.
3. `GET /enterprise-hub/treasury/documents/:id` — جزئیات سند همراه روش‌های پرداخت و تخصیص‌ها.
4. `POST /enterprise-hub/treasury/documents/:id/allocations` — تخصیص ماندهٔ تخصیص‌نیافته به **صورتحساب‌ها**.
5. `GET /enterprise-hub/treasury/open-invoices` — ماندهٔ قابل تخصیص برای **صورتحساب‌ها** (پارامترهای `kind` و `ids`).
6. `GET /enterprise-hub/treasury/allocations` — گزارش تخصیص‌ها برای سنی بدهی (`partyCode` و `asOf`).
7. `GET /enterprise-hub/treasury/settings` و `PUT /enterprise-hub/treasury/settings` — خواندن و تعیین سقف تخفیف هر **صورتحساب** (`writeoffTolerance`).

هر ردیف روش شامل `method`، `amount` و در صورت نیاز `reference` است؛ برای **واریز بانکی** و **کارتخوان** فیلد `bankAccountId`، و برای چک `chequeNumber`، `sayadNumber`، `chequeBankName` و `dueDate`. تخصیص به **صورتحساب‌ها** با `invoiceId`، `amount` و `writeoff` انجام می‌شود؛ `writeoff` فقط برای بستن کامل **صورتحساب** و تا سقف مجاز سازمان پذیرفته می‌شود. هر سند یک **سند حسابداری** خودکار می‌سازد و ماندهٔ تخصیص‌نیافته به‌عنوان پیش‌دریافت/پیش‌پرداخت روی سند می‌ماند.
