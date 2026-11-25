<!-- Sources (origin/main): output_apps/enterprise_hub/modules/tax_compliance/controllers/corporate-tax.controller.ts, business-tax.controller.ts, rental-tax.controller.ts; dto/corporate-tax-preview.dto.ts, business-tax-preview.dto.ts, rental-tax-preview.dto.ts; output_apps/enterprise_hub/frontend/src/app/app/tax/previews/page.tsx -->
# پیش‌نمایش مالیات بر درآمد

از منوی **حسابداری و مالیات** وارد **پیش‌نمایش‌های مالیاتی** (`/app/tax/previews`) شوید. این صفحه چهار زبانهٔ محاسبهٔ «بدون ثبت سند» دارد: **«مالیات بر درآمد شرکت‌ها»**، **«مشاغل و مشارکت (ماده ۱۰۱)»**، **«املاک و اجاره (ماده ۵۳ و ۵۷)»** و **«تکلیفی پزشکان»**. این پیش‌نمایش‌ها فقط محاسبه می‌کنند و سندی در دفتر نمی‌نویسند:

1. **شرکت (ذخیرهٔ مالیات)**: `POST /enterprise-hub/tax-compliance/corporate-tax/preview` با `fiscalYear`، `accountingProfit`، `nonDeductibleAdditions`، `exemptIncomeAndDeductions`، `lossesBroughtForward` و اختیاری `expenseAccountCode` و `payableAccountCode`.
2. **صاحب شغل یا مشارکت مدنی**: `POST /enterprise-hub/tax-compliance/business-tax/preview` با `fiscalYear`، `mode` (`SOLE` یا `PARTNERSHIP`)، فهرست `units` (هر واحد `revenue` و `deductibleExpenses`) و برای مشارکت `partners` (`shareBps`، اختیاری `spouseGroup` و `isHusband`).
3. **اجاره (معافیت ماده ۵۷)**: `POST /enterprise-hub/tax-compliance/rental-tax/preview` با `fiscalYear`، `rentReceived`، `lessorIsOwner` و اختیاری `inKindIncome`، `rentPaid`، `exemptRentPortion`، `otherTaxableIncome`، `minorUnderGuardianship`.

مبلغ‌ها رشتهٔ عددی‌اند. نرخ‌ها و پله‌های مالیات از پارامترهای سامانه می‌آیند، نه از این راهنما؛ نتیجه را پیش از استفاده با حسابدار تطبیق دهید.
