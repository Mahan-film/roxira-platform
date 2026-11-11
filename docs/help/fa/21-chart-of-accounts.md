<!-- Sources (origin/main): output_apps/enterprise_hub/modules/accounting/controllers/accounting.controller.ts, output_apps/enterprise_hub/modules/accounting/controllers/dimension.controller.ts, output_apps/enterprise_hub/modules/accounting/controllers/fiscal-year.controller.ts, output_apps/enterprise_hub/modules/accounting/dto/create-account.dto.ts, output_apps/enterprise_hub/modules/accounting/dto/dimension.dto.ts, output_apps/enterprise_hub/modules/accounting/enums/accounting.enum.ts, output_apps/enterprise_hub/modules/accounting/services/accounting.service.ts, output_apps/enterprise_hub/modules/accounting/services/dimension.service.ts, output_apps/enterprise_hub/frontend/src/app/app/accounting/page.tsx, output_apps/enterprise_hub/frontend/src/components/accounting/account-tree-card.tsx, output_apps/enterprise_hub/frontend/src/lib/account-tree.ts, output_apps/enterprise_hub/frontend/src/app/app/accounting/fiscal-years/page.tsx -->
# سرفصل حساب‌ها و تفصیلی‌های شناور

در صفحهٔ **درخت و سرفصل حساب‌ها** (`/app/accounting/chart`)، کارت **«سرفصل حساب‌ها»** ساختار درختی حساب‌های دفتر کل سازمان را نشان می‌دهد. همچنین از صفحهٔ **سال مالی و سرفصل** (`/app/accounting/fiscal-years`) می‌توانید قالب‌های سرفصل استاندارد ایران را روی سازمان اعمال کنید.

## درخت سرفصل حساب‌ها در رابط کاربری

1. **نمایش درختی بر پایهٔ پیشوند کد**: حساب‌ها بر اساس پیشوند کد مرتب و تورفته می‌شوند (مثلاً کد `1101` زیرمجموعهٔ `11` و آن زیرمجموعهٔ `1` است). برای هر حساب، **مانده** خود حساب به ریال نمایش داده می‌شود. ستون **مانده با زیرمجموعه** فقط برای حساب‌هایی که زیرحساب دارند جمع ماندهٔ حساب و تمام زیرحساب‌هایش را نشان می‌دهد؛ در ردیف حساب بدون زیرحساب «—» نمایش داده می‌شود.
2. **افزودن حساب یا زیرحساب**:
   - با دکمهٔ **«حساب جدید»** در بالای کارت یا دکمهٔ **«زیرحساب»** روبه‌روی هر ردیف (که کد حساب مادر را در فیلد کد پیش‌فرض می‌گذارد)، فرم ثبت باز می‌شود.
   - فیلدهای فرم شامل **کد** (یکتا در سازمان، تا ۳۲ نویسه)، **نام حساب** و **نوع** (دارایی، بدهی، سرمایه، درآمد، هزینه) است. کد تکراری با خطای ۴۰۹ رد می‌شود.
3. **هشدار جایگاه مشکوک**: اگر حسابی با نام «بانک» زیرمجموعهٔ حساب‌های «دریافتنی/مطالبات» قرار گرفته باشد، برنامه حساب را خودکار جابه‌جا نمی‌کند، اما برچسب **«نیاز به بررسی»** را کنار نام حساب و هشدار بالای جدول نمایش می‌دهد.
4. **قالب سرفصل استاندارد**: در مسیر `/app/accounting/fiscal-years`، کارت **«قالب سرفصل حساب‌ها»** فهرست قالب‌های استاندارد را نشان می‌دهد. با زدن دکمهٔ **«اعمال»**، حساب‌های جاافتاده اضافه و حساب‌های موجود طبقه‌بندی می‌شوند.

## سطوح حساب (گروه، کل، معین و تفصیلی)

در لایهٔ سرور (`AccountLevel`)، هر حساب می‌تواند یکی از چهار سطح زیر را داشته باشد:
- `GROUP` (گروه) و `KOL` (کل): حساب‌های سرفصل و سرجمع هستند. **ثبت سطر سند روی حساب گروه یا کل مجاز نیست** و سرور آن را با خطای ۴۰۰ («سند روی حساب گروه یا کل ثبت نمی‌شود؛ حساب معین یا تفصیلی انتخاب کنید») رد می‌کند.
- `MOEIN` (معین) و `TAFSILI` (تفصیلی): حساب‌های قابل ثبت در سطرهای سند حسابداری هستند.
- هنگام ایجاد حساب از طریق API (`POST /enterprise-hub/accounting/accounts`)، علاوه بر `code`، `name` و `accountType`، ارسال `currency` (پیش‌فرض `IRR`)، `level`، `parentCode` (باید از قبل در سازمان وجود داشته باشد) و `reportLine` (ردیف صورت‌های مالی) پشتیبانی می‌شود.

## تفصیلی‌های شناور

TODO: not built yet — صفحهٔ مدیریت تفصیلی‌های شناور در رابط کاربری هنوز ساخته نشده است و در حال حاضر از طریق API کار می‌کند.

تفصیلی شناور (`DimensionKind.DETAIL`) یک بُعد مستقل از کد حساب معین است تا یک کد تفصیلی (مثل شخص، پرونده یا قرارداد) بتواند زیر چندین حساب معین گردش داشته باشد:

1. **تعریف تفصیلی شناور**: `POST /enterprise-hub/accounting/dimensions` با دسترسی `accounting:create` و بدنهٔ `{ "kind": "DETAIL", "code": "P-1001", "name": "..." }` (کد فقط حروف لاتین، عدد و `. _ -` تا ۳۲ نویسه؛ تفصیلی شناور نمی‌تواند `parentCode` داشته باشد).
2. **فهرست تفصیلی‌های شناور**: `GET /enterprise-hub/accounting/dimensions?kind=DETAIL`.
3. **استفاده در سطر سند**: در `POST /enterprise-hub/accounting/journal-entries`، هر سطر می‌تواند فیلد `detailCode` (کد تفصیلی شناورِ تعریف‌شده) یا `partyCode` داشته باشد. اگر `detailCode` تعریف نشده باشد، ثبت سند با خطای ۴۰۰ رد می‌شود.
4. **گزارش گردش و ماندهٔ تفصیلی شناور**: `GET /enterprise-hub/accounting/dimensions/DETAIL/balances?from=YYYY-MM-DD&to=YYYY-MM-DD` جمع بدهکار، بستانکار و ماندهٔ هر تفصیلی شناور را از روی سطرهای اسناد **قطعی (POSTED)** در آن بازه برمی‌گرداند.
