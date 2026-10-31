/**
 * جدول صادقانهٔ پشتیبانی از قالب‌ها — «تنها منبع حقیقت».
 * UI آن را از `GET enterprise-hub/data-import/formats` می‌خواند و `docs/IMPORT_SUPPORT.md` از همین‌جا
 * تولید می‌شود (تست `support-matrix.spec.ts` ناهمخوانی را رد می‌کند). هر ردیف «supported» باید فایل
 * نمونه و تست داشته باشد؛ بدون آن فقط `heuristic`/`guide`/`unsupported` مجاز است.
 */

export type SupportStatus =
  | 'supported' // خوانده می‌شود و با فایل نمونه + تست پوشش داده شده
  | 'partial' // خوانده می‌شود با محدودیت مشخص
  | 'heuristic' // نگاشت حدسی از مستندات؛ با خروجی واقعی محصول آزمایش نشده
  | 'guide' // تشخیص داده می‌شود؛ فقط راهنمای فارسی می‌دهیم
  | 'unsupported'; // پشتیبانی نمی‌شود

export interface SupportRow {
  id: string;
  group: 'sheet' | 'text' | 'database' | 'accounting' | 'product' | 'other';
  titleFa: string;
  extensions: string[];
  status: SupportStatus;
  detailFa: string;
  /** فایل نمونهٔ آزمون در `__fixtures__` (برای supported/partial الزامی). */
  fixture?: string;
}

export const SUPPORT_MATRIX: readonly SupportRow[] = [
  { id: 'csv', group: 'text', titleFa: 'CSV / TSV / جداکنندهٔ ; یا pipe', extensions: ['.csv', '.tsv', '.txt'], status: 'supported', detailFa: 'رمزگذاری از روی محتوا: UTF-8، UTF-16، Windows-1256. حروف عربی ي/ك به ی/ک یکسان می‌شود.', fixture: 'formats/journal.csv' },
  { id: 'fixed-width', group: 'text', titleFa: 'متن با ستون‌های عرض‌ثابت', extensions: ['.txt', '.prn'], status: 'partial', detailFa: 'ستون‌ها از فاصلهٔ دست‌کم دوکاراکتری تشخیص داده می‌شود؛ جداکنندهٔ تک‌فاصله پشتیبانی نمی‌شود.', fixture: 'formats/journal-fixed.txt' },
  { id: 'json', group: 'text', titleFa: 'JSON', extensions: ['.json'], status: 'supported', detailFa: 'آرایهٔ اشیا یا شیئی با چند آرایه (هر آرایه یک جدول). عمق ≤ ۴۸.', fixture: 'formats/journal.json' },
  { id: 'xml', group: 'text', titleFa: 'XML', extensions: ['.xml'], status: 'supported', detailFa: 'رکوردهای تکرارشونده به جدول تبدیل می‌شوند. DTD/ENTITY به‌دلایل امنیتی رد می‌شود.', fixture: 'formats/journal.xml' },
  { id: 'html-table', group: 'sheet', titleFa: 'جدول HTML با پسوند xls', extensions: ['.xls', '.html'], status: 'supported', detailFa: 'خروجی «اکسل» بسیاری از نرم‌افزارها در واقع HTML است.', fixture: 'formats/journal-table.xls' },
  { id: 'xls', group: 'sheet', titleFa: 'اکسل قدیمی XLS (BIFF8)', extensions: ['.xls'], status: 'supported', detailFa: 'همهٔ برگه‌ها، تاریخ‌ها، رشته‌های اشتراکی. رمزدار و نسخه‌های قدیمی‌تر از Excel 97 رد می‌شوند.', fixture: 'formats/journal.xls' },
  { id: 'xlsx', group: 'sheet', titleFa: 'اکسل XLSX', extensions: ['.xlsx'], status: 'supported', detailFa: 'همهٔ برگه‌های نمایان، هر برگه یک جدول؛ برگه‌های پنهان خوانده نمی‌شوند و در یادداشت می‌آیند.', fixture: 'formats/multi-sheet.xlsx' },
  { id: 'ods', group: 'sheet', titleFa: 'OpenDocument ODS', extensions: ['.ods'], status: 'supported', detailFa: 'همهٔ برگه‌ها؛ تکرار سطر/ستون انفجاری رد می‌شود.', fixture: 'formats/journal.ods' },
  { id: 'dbf', group: 'database', titleFa: 'DBF (dBase / FoxPro / Clipper)', extensions: ['.dbf'], status: 'supported', detailFa: 'فایل memo (.dbt/.fpt) خوانده نمی‌شود. Iran System رد می‌شود.', fixture: 'formats/journal.dbf' },
  { id: 'sqlite', group: 'database', titleFa: 'دیتابیس SQLite', extensions: ['.sqlite', '.db'], status: 'supported', detailFa: 'فقط خواندن جدول‌ها.', fixture: 'erp_multicurrency_small.sqlite' },
  { id: 'sql', group: 'database', titleFa: 'دامپ SQL با دیالکت SQLite', extensions: ['.sql'], status: 'partial', detailFa: 'فهرست مجاز دستورها + اجرا در ورکر جداشده با timeout/سقف حافظه (PR 906)؛ بر خلاف MySQL/PostgreSQL، این مسیر اجرا می‌کند.', fixture: 'formats/sqlite-dump.sql.txt' },
  { id: 'sql-mysql', group: 'database', titleFa: 'دامپ MySQL / MariaDB', extensions: ['.sql'], status: 'supported', detailFa: 'متن توکن‌بندی می‌شود و هرگز اجرا نمی‌شود: CREATE TABLE، INSERT چندردیفی، escapeها، کلید خارجی.', fixture: 'formats/mysql-dump.sql.txt' },
  { id: 'sql-postgres', group: 'database', titleFa: 'دامپ PostgreSQL (با COPY)', extensions: ['.sql'], status: 'supported', detailFa: 'بلوک‌های COPY ... FROM stdin، INSERT، $$…$$؛ بدون اجرا.', fixture: 'formats/postgres-dump.sql.txt' },
  { id: 'sql-mssql', group: 'database', titleFa: 'اسکریپت T-SQL (SSMS «Generate Scripts»)', extensions: ['.sql'], status: 'supported', detailFa: 'GO، [براکت]، N-string، UTF-16؛ بدون اجرا. جایگزین عملی برای .bak.', fixture: 'formats/mssql-script.sql.txt' },
  { id: 'iif', group: 'accounting', titleFa: 'QuickBooks IIF', extensions: ['.iif'], status: 'supported', detailFa: 'TRNS/SPL به سند تراز تبدیل می‌شود (مثبت = بدهکار). مبلغ به ارز منبع است.', fixture: 'formats/quickbooks.iif' },
  { id: 'ofx', group: 'accounting', titleFa: 'صورت‌حساب بانکی OFX / QBO / QFX', extensions: ['.ofx', '.qbo', '.qfx'], status: 'supported', detailFa: 'تراکنش‌ها با مبلغ علامت‌دار؛ به «صورت‌حساب بانک» نگاشت می‌شود.', fixture: 'formats/bank.ofx' },
  { id: 'zip', group: 'other', titleFa: 'ZIP و رها کردن پوشه / چند فایل', extensions: ['.zip'], status: 'supported', detailFa: 'هر فایل با همین خوانندگان خوانده می‌شود؛ ZIP تودرتو و مسیرهای ناامن رد می‌شود. سقف ۵۰ فایل و ۲۰۰ مگابایت باز.', fixture: 'hostile/zip-slip.zip' },
  { id: 'xero', group: 'product', titleFa: 'Xero — صورت‌حساب بانکی CSV', extensions: ['.csv'], status: 'heuristic', detailFa: 'نگاشت از سربرگ‌های مستند؛ با خروجی واقعی Xero آزمایش نشده.' },
  { id: 'odoo', group: 'product', titleFa: 'Odoo — ردیف‌های سند (Journal Items)', extensions: ['.csv', '.xlsx'], status: 'heuristic', detailFa: 'نگاشت حدسی؛ مبلغ‌ها به ارز شرکت‌اند و باید تأیید شوند.' },
  { id: 'erpnext', group: 'product', titleFa: 'ERPNext — GL Entry', extensions: ['.csv', '.xlsx'], status: 'heuristic', detailFa: 'نگاشت حدسی؛ مبلغ‌ها به ارز شرکت‌اند و باید تأیید شوند.' },
  { id: 'sage', group: 'product', titleFa: 'Sage', extensions: ['.csv'], status: 'unsupported', detailFa: 'سربرگ‌های خروجی Sage تأیید نشد؛ فقط به‌عنوان CSV عمومی با نگاشت دستی/حافظهٔ نگاشت.' },
  { id: 'iran-products', group: 'product', titleFa: 'سپیدار، همکاران سیستم، راهکاران، محک', extensions: ['.xlsx', '.xls', '.csv'], status: 'unsupported', detailFa: 'سربرگ‌های تأییدشدهٔ خروجی این محصولات در دست نیست، پس پروفایل ثبت نشده است. خروجی اکسل/CSV را بفرستید: نگاشت پیشنهادی را تأیید کنید و سامانه آن را برای سازمان شما به خاطر می‌سپارد.' },
  { id: 'access', group: 'database', titleFa: 'Microsoft Access (.mdb / .accdb)', extensions: ['.mdb', '.accdb'], status: 'guide', detailFa: 'تشخیص داده می‌شود؛ راهنمای خروجی اکسل/CSV نمایش داده می‌شود.', fixture: 'formats/stub-access.mdb' },
  { id: 'mssql-backup', group: 'database', titleFa: 'پشتیبان SQL Server (.bak / .mdf)', extensions: ['.bak', '.mdf', '.ldf'], status: 'guide', detailFa: 'نیازمند سندباکس جدا (طراحی در docs/plan.md)؛ فعلاً راهنما: Generate Scripts به .sql.', fixture: 'formats/stub-sqlserver.bak.bin' },
  { id: 'pg-custom', group: 'database', titleFa: 'پشتیبان باینری PostgreSQL (pg_dump -Fc)', extensions: ['.dump', '.backup'], status: 'guide', detailFa: 'با pg_restore -f به متن تبدیل کنید.', fixture: 'formats/stub-pgdump-custom.dump' },
  { id: 'iran-system', group: 'text', titleFa: 'متن با رمزگذاری Iran System', extensions: ['.txt', '.csv'], status: 'guide', detailFa: 'جدول تأییدشده‌ای نداریم و رمزگشایی اشتباه نام‌ها را خراب می‌کند؛ با راهنمای خروجی UTF-8 رد می‌شود.', fixture: 'formats/iran-system-like.csv' },
  { id: 'pdf-text', group: 'other', titleFa: 'PDF متنی', extensions: ['.pdf'], status: 'partial', detailFa: 'جدول از لایهٔ متن بدون هیچ مدل هوش مصنوعی خوانده می‌شود. فقط با فایل ساختگی آزمایش شده؛ ستون‌بندی PDF واقعی بانک یا نرم‌افزار باید در بازبینی کنترل شود.', fixture: 'formats/journal-text.pdf' },
  { id: 'pdf-scan', group: 'other', titleFa: 'PDF اسکن‌شده و عکس (OCR)', extensions: ['.pdf', '.png', '.jpg', '.webp'], status: 'partial', detailFa: 'با نقش vision در config/models.yaml خوانده می‌شود، تا ۳۰ صفحه، فقط صفحه‌های JPEG داخل PDF. تصویر قابل ماسک نیست و با data_collection: deny به مدل می‌رود. هرگز خودکار ثبت نمی‌شود: سرور بدون ساخت صفحهٔ بازبینی برای همان انتخاب، ثبت را رد می‌کند. دقت OCR فارسی با مدل زنده اندازه‌گیری نشده است. داخل ZIP پشتیبانی نمی‌شود.', fixture: 'formats/scanned.pdf' },
  { id: 'mt940', group: 'accounting', titleFa: 'SWIFT MT940 / CAMT.053', extensions: ['.sta', '.xml'], status: 'unsupported', detailFa: 'پشتیبانی نمی‌شود.' },
  { id: 'sync', group: 'other', titleFa: 'همگام‌سازی پیوسته با نرم‌افزار دیگر', extensions: [], status: 'unsupported', detailFa: 'ادعا نمی‌شود: ورود یک‌بارهٔ فایل است و با یک دسته قابل بازگردانی (undo) است.' },
];

const STATUS_FA: Record<SupportStatus, string> = {
  supported: '✅ پشتیبانی کامل',
  partial: '🟡 با محدودیت',
  heuristic: '🟠 حدسی (تأییدنشده)',
  guide: '🧭 فقط راهنما',
  unsupported: '⛔ پشتیبانی نمی‌شود',
};

const REQUIRED_SAMPLES = ['سپیدار', 'همکاران سیستم', 'راهکاران', 'محک'].map((product) => ({
  product,
  files: 'خروجی اکسل یا CSV: سرفصل حساب‌ها، تراز آزمایشی، دفتر روزنامه با چند سند، مانده‌های افتتاحیه، اشخاص، کالا و موجودی',
}));

export function renderSupportMarkdown(): string {
  const lines = [
    '# فرمت‌های پشتیبانی‌شدهٔ ورود داده',
    '',
    '> این فایل از `modules/data_import/support-matrix.ts` تولید می‌شود؛ دستی ویرایش نکنید.',
    '> تولید دوباره: `cd output_apps/enterprise_hub && npx ts-node -e "require(\'fs\').writeFileSync(\'../../docs/IMPORT_SUPPORT.md\', require(\'./modules/data_import/support-matrix\').renderSupportMarkdown())"`',
    '',
    'قالب فایل از روی **محتوا** تشخیص داده می‌شود، نه پسوند. هیچ دامپ متنی (MySQL، PostgreSQL، T-SQL) اجرا نمی‌شود.',
    '**همگام‌سازی پیوسته وجود ندارد**؛ هر ورود یک‌باره است و با یک دسته قابل بازگردانی (undo) است.',
    '',
    '| قالب | پسوندها | وضعیت | توضیح | فایل نمونهٔ آزمون |',
    '|---|---|---|---|---|',
    ...SUPPORT_MATRIX.map(
      (r) =>
        `| ${r.titleFa} | ${r.extensions.map((e) => `\`${e}\``).join(' ') || '—'} | ${STATUS_FA[r.status]} | ${r.detailFa} | ${r.fixture ? `\`${r.fixture}\`` : '—'} |`,
    ),
    '',
    '## فایل‌های نمونه‌ای که برای پروفایل نرم‌افزارهای ایرانی لازم است',
    '',
    'هیچ پروفایلی برای سپیدار، همکاران سیستم، راهکاران یا محک ادعا نمی‌شود، چون خروجی واقعی آن‌ها را نداریم. برای ساخت هر پروفایل این خروجی‌ها از یک نسخهٔ واقعی لازم است (داده می‌تواند آزمایشی یا ناشناس‌شده باشد):',
    '',
    '| نرم‌افزار | فایل‌های لازم |',
    '|---|---|',
    ...REQUIRED_SAMPLES.map((s) => `| ${s.product} | ${s.files} |`),
    '',
    'همراه هر فایل، نسخهٔ نرم‌افزار و مسیر منوی خروجی را هم بنویسید. برای OCR نیز چند عکس و PDF اسکن‌شدهٔ واقعی فارسی لازم است تا دقت اندازه‌گیری شود.',
    '',
  ];
  return lines.join('\n');
}
