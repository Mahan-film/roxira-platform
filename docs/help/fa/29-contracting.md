<!-- Sources (origin/main):
  output_apps/enterprise_hub/modules/contracting/controllers/contracts.controller.ts
  output_apps/enterprise_hub/modules/contracting/controllers/statements.controller.ts
  output_apps/enterprise_hub/modules/contracting/controllers/movements.controller.ts
  output_apps/enterprise_hub/modules/contracting/controllers/profitability.controller.ts
  output_apps/enterprise_hub/modules/contracting/dto/contract.dto.ts
  output_apps/enterprise_hub/modules/contracting/dto/statement.dto.ts
  output_apps/enterprise_hub/modules/contracting/dto/movement.dto.ts
  output_apps/enterprise_hub/frontend/src/app/app/contracting/page.tsx
  output_apps/enterprise_hub/frontend/src/app/app/contracting/contracts/[id]/page.tsx
  output_apps/enterprise_hub/frontend/src/app/app/contracting/profitability/page.tsx
  output_apps/enterprise_hub/frontend/src/lib/contracting-ui.ts
-->

# پیمانکاری: قراردادها، صورت‌وضعیت‌ها و سپردهٔ حسن انجام کار

ماژول پیمانکاری روکسیرا (`/app/contracting`) امکان مدیریت پروژه‌ها، قراردادهای کارفرمایی و پیمانکاری، ثبت صورت‌وضعیت‌های تجمعی، محاسبهٔ خودکار کسورات قانونی و قراردادی (سپردهٔ حسن انجام کار، سپردهٔ بیمه و استهلاک پیش‌پرداخت) و صدور اسناد حسابداری را فراهم می‌کند.

## ۱. تعریف پروژه و قرارداد (`/app/contracting`)

۱. در بخش **«پروژه‌ها»** می‌توانید پروژهٔ جدید با **کد پروژه**، **نام پروژه** و **بودجه کل (ریال)** ثبت کنید (`POST /enterprise-hub/contracting/projects`).
۲. در بخش **«قراردادها»** برای ثبت قرارداد جدید (`POST /enterprise-hub/contracting/contracts`) فیلدهای زیر را وارد کنید:
   - **کد قرارداد (`code`)** و **عنوان قرارداد (`title`)**: کد قرارداد در سطح سازمان یکتا و بدون فاصله است.
   - **نقش سازمان (`side`)**:
     - `employer`: **«ما کارفرما هستیم (پرداخت به پیمانکار)»**
     - `contractor`: **«ما پیمانکار هستیم (صورت‌حساب به کارفرما)»**
   - **کد طرف حساب (`partyCode`)**: کد تفصیلی پیمانکار یا کارفرما.
   - **پروژه (`projectId`، اختیاری)**، **تاریخ قرارداد (`contractDate`)**، **مبلغ قرارداد (`amount`)** و **پیش‌پرداخت توافقی (`advanceAmount`، اختیاری)**.
   - وضعیت قرارداد (`status`) می‌تواند `draft` (پیش‌نویس)، `active` (فعال) یا `closed` (بسته) باشد. پس از ایجاد، فیلدهای `code`، `side` و `partyCode` قابل تغییر نیستند.

## ۲. ثبت و قطعی‌سازی صورت‌وضعیت (`/app/contracting/contracts/[id]`)

با کلیک روی کد هر قرارداد در فهرست، صفحهٔ جزئیات قرارداد باز می‌شود که در بالای آن سه شاخص **مبلغ قرارداد**، **پیش‌پرداخت مستهلک‌نشده** (`advanceUnrecovered`) و **سپرده حسن انجام کار** (`retentionHeld`) نمایش داده می‌شود.

۱. در بخش **«ثبت صورت‌وضعیت تجمعی»**، **تاریخ صورت‌وضعیت (`statementDate`)** و **مبلغ تجمعی کارکرد تا این صورت‌وضعیت (`cumulativeAmount`)** را وارد و روی **«محاسبه و ثبت پیش‌نویس»** کلیک کنید (`POST /enterprise-hub/contracting/contracts/:id/statements`).
۲. سیستم به صورت خودکار مقادیر زیر را محاسبه می‌کند:
   - **کارکرد دوره (`periodAmount`)**: مابه‌التفاوت کارکرد تجمعی جدید و کارکرد تجمعی صورت‌وضعیت قبلی (`previousAmount`).
   - **سپرده حسن انجام کار (`retentionAmount`)**، **سپرده بیمه (`insuranceAmount`)** و **استهلاک پیش‌پرداخت (`advanceRecoveryAmount`)**.
   - **خالص قابل پرداخت (`netPayable`)**.
۳. در جدول صورت‌وضعیت‌ها، نرخ‌های به‌کاررفته در کسورات (`termsUsed`) به همراه برچسب منشأ آن‌ها («مقدار قانونی تأییدشده»، «مقدار ثبت‌شده سازمان (تأیید قانونی نشده)» یا «مقدار ثانویه، هنوز تأیید نشده») نمایش داده می‌شود.
۴. **چرخهٔ وضعیت صورت‌وضعیت**:
   - در وضعیت **پیش‌نویس (`draft`)**: دکمهٔ **«تأیید»** (`POST .../statements/:statementId/approve`) وضعیت را به `approved` تغییر می‌دهد.
   - در وضعیت **تأییدشده (`approved`)**: دکمهٔ **«ثبت سند»** (`POST .../statements/:statementId/post`) سند حسابداری صورت‌وضعیت و کسورات آن را در دفتر کل ثبت کرده، وضعیت را به **ثبت‌شده (`posted`)** تغییر می‌دهد و شمارهٔ سند (`journalEntryNumber`) را نمایش می‌دهد.

## ۳. ثبت پیش‌پرداخت و آزادسازی سپردهٔ حسن انجام کار

در پایین صفحهٔ جزئیات هر قرارداد دو فرم عملیاتی قرار دارد:

- **پرداخت / دریافت پیش‌پرداخت** (`POST /enterprise-hub/contracting/contracts/:id/advance-payments`): با وارد کردن تاریخ و مبلغ (به ریال) و کلیک روی **«ثبت سند پیش‌پرداخت»**، سند حسابداری پیش‌پرداخت صادر شده و ماندهٔ پیش‌پرداخت مستهلک‌نشدهٔ قرارداد افزایش می‌یابد.
- **آزادسازی سپرده حسن انجام کار** (`POST /enterprise-hub/contracting/contracts/:id/retention-releases`): پس از تحویل موقت یا قطعی، با وارد کردن تاریخ و مبلغ آزادسازی و کلیک روی **«ثبت سند آزادسازی»**، سند حسابداری تسویهٔ سپرده صادر شده و از ماندهٔ سپردهٔ قرارداد کسر می‌شود.

## ۴. گزارش سودآوری پروژه‌ها (`/app/contracting/profitability`)

با کلیک روی دکمهٔ **«سودآوری پروژه‌ها»** در بالای صفحهٔ پیمانکاری (`GET /enterprise-hub/contracting/reports/profitability`)، جدول مقایسه‌ای هر پروژه شامل **بودجه**، **هزینه پیمانکاران**، **هزینه دفتر کل** (در صورت تعریف مرکز هزینهٔ هم‌کد با پروژه)، **هزینه واقعی کل**، **باقی‌مانده بودجه**، **مبلغ صورت‌حساب‌شده** و **حاشیه سود** نمایش داده می‌شود.
