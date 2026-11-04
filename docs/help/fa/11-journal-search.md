<!-- Sources (origin/main): output_apps/enterprise_hub/frontend/src/components/accounting/journal-entries-table.tsx, output_apps/enterprise_hub/modules/accounting/dto/query-journal-entry.dto.ts, modules/accounting/controllers/accounting.controller.ts (GET enterprise-hub/accounting/journal-entries) -->
# جست‌وجو در دفتر روزنامه

## از صفحهٔ برنامه
1. از منوی کناری وارد بخش حسابداری (`/app/accounting`) شوید و به کارت **دفتر روزنامه (اسناد حسابداری)** بروید.
2. در کادر **جست‌وجوی شماره سند** بخشی از شمارهٔ سند را بنویسید و روی **جست‌وجو** بزنید (جست‌وجوی جزئی است).
3. برای تازه کردن فهرست از دکمهٔ **بروزرسانی** استفاده کنید.

در رابط کاربری فعلاً فقط جست‌وجو بر پایهٔ شمارهٔ سند هست.

## فیلترهای بیشتر (فقط API)
TODO: not built yet — فیلترهای زیر در سرور آماده‌اند ولی فرمی برای آن‌ها در صفحه نیست. نقطهٔ پایانی `GET /enterprise-hub/accounting/journal-entries` این پارامترها را می‌پذیرد:
- `status` (وضعیت سند)، `entryNumber` (شمارهٔ سند)
- `fromDate` و `toDate` (میلادی، `YYYY-MM-DD`، شامل همان روز)
- `accountCode` (کد حساب)، `partyCode` (تفصیلی)
- `minAmount` و `maxAmount` (مبلغ بدهکار یا بستانکار یک سطر)
- `text` (جست‌وجو در شرح سند و شرح سطرها)
- `page` و `limit` (۱ تا ۱۰۰، پیش‌فرض ۲۰)
