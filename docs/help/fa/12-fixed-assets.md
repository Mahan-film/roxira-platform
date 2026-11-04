<!-- Sources (origin/main): output_apps/enterprise_hub/modules/accounting/controllers/fixed-asset.controller.ts, modules/accounting/dto/fixed-asset.dto.ts, modules/accounting/services/fixed-asset.service.ts. No frontend page exists for fixed assets. -->
# دارایی‌های ثابت و استهلاک

TODO: not built yet — صفحه یا منوی «دارایی‌های ثابت» در برنامه وجود ندارد. فقط API سرور آماده است (مسیر پایه `/enterprise-hub/accounting/fixed-assets`).

1. **فهرست دارایی‌ها**: `GET` فهرست دارایی‌ها را با ارزش دفتری برمی‌گرداند.
2. **ثبت دارایی**: `POST` با این فیلدها:
   - `code` (لاتین، عدد و `. _ -` تا ۳۲ نویسه؛ تکراری ممکن نیست)، `name`، `category`
   - `acquisitionDate` (`YYYY-MM-DD`)، `cost` و اختیاری `salvageValue`
   - `method`: `STRAIGHT_LINE` (خط مستقیم) یا `DECLINING_BALANCE` (نزولی)
   - برای خط مستقیم `lifeMonths` (عمر مفید به ماه)؛ برای نزولی `annualRate` (نسبت بین ۰ و ۱) و اختیاری `rateSource` (منبع نرخ)
   - کدهای حساب: `assetAccountCode`، `accumulatedAccountCode`، `expenseAccountCode`
3. **سند استهلاک ماهانه**: `POST /depreciation-runs` با `year` و `month` (شمسی، ماه ۱ تا ۱۲). هر دارایی در هر ماه فقط یک بار استهلاک می‌گیرد، ماه‌ها نباید جا بیفتند و دورهٔ قفل‌شده با خطای ۴۲۳ رد می‌شود.

ثبت دارایی به دسترسی «ثبت و ویرایش» و اجرای استهلاک به دسترسی «قطعی‌سازی» نیاز دارد.
