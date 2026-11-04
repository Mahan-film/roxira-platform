<!-- Sources (origin/main): output_apps/enterprise_hub/modules/tax_compliance/controllers/corporate-tax.controller.ts, business-tax.controller.ts, rental-tax.controller.ts; dto/corporate-tax-preview.dto.ts, business-tax-preview.dto.ts, rental-tax-preview.dto.ts; frontend/src/app/app/tax/page.tsx (no preview screen there) -->
# پیش‌نمایش مالیات بر درآمد

TODO: not built yet — صفحهٔ «مالیات» در برنامه (`/app/tax`) فعلاً پیش‌نویس اظهارنامهٔ ارزش افزوده را نشان می‌دهد و فرمی برای پیش‌نمایش مالیات بر درآمد ندارد. سه پیش‌نمایش زیر فقط از API در دسترس‌اند. هر سه «بدون ثبت سند» هستند: فقط محاسبه می‌کنند و چیزی در دفتر نمی‌نویسند.

1. **شرکت (ذخیرهٔ مالیات)**: `POST /enterprise-hub/tax-compliance/corporate-tax/preview` با `fiscalYear`، `accountingProfit`، `nonDeductibleAdditions`، `exemptIncomeAndDeductions`، `lossesBroughtForward` و اختیاری `expenseAccountCode` و `payableAccountCode`.
2. **صاحب شغل یا مشارکت مدنی**: `POST /enterprise-hub/tax-compliance/business-tax/preview` با `fiscalYear`، `mode` (`SOLE` یا `PARTNERSHIP`)، فهرست `units` (هر واحد `revenue` و `deductibleExpenses`) و برای مشارکت `partners` (`shareBps`، اختیاری `spouseGroup` و `isHusband`).
3. **اجاره (معافیت ماده ۵۷)**: `POST /enterprise-hub/tax-compliance/rental-tax/preview` با `fiscalYear`، `rentReceived`، `lessorIsOwner` و اختیاری `inKindIncome`، `rentPaid`، `exemptRentPortion`، `otherTaxableIncome`، `minorUnderGuardianship`.

مبلغ‌ها رشتهٔ عددی‌اند. نرخ‌ها و پله‌های مالیات از پارامترهای سامانه می‌آیند، نه از این راهنما؛ نتیجه را پیش از استفاده با حسابدار تطبیق دهید.
