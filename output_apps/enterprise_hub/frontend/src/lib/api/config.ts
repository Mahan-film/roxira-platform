/**
 * پیکربندی متمرکز اتصال به Backend NestJS (Enterprise App Layer).
 *
 * برای پرهیز از مشکلات CORS، فراخوانی‌های سمت مرورگر از طریق مسیر
 * نسبی `API_PROXY_BASE_PATH` انجام می‌شود که توسط `next.config.ts`
 * (rewrites) به‌صورت سرور-به-سرور به آدرس واقعی NestJS
 * (`NEST_API_ORIGIN`) هدایت می‌گردد. بنابراین در زمان build نیازی به
 * دسترسی به بک‌اند نیست و فقط در زمان اجرای واقعی درخواست، پروکسی
 * فعال می‌شود.
 */

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر Damages در NestJS (VersioningType.URI, defaultVersion: '1') */
export const DAMAGES_RESOURCE_PATH = "enterprise-hub/damages";

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر Smart Invoicing در NestJS */
export const INVOICING_RESOURCE_PATH = "enterprise-hub/invoicing";

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر Accounting (دفتر کل دوطرفه) در NestJS */
export const ACCOUNTING_RESOURCE_PATH = "enterprise-hub/accounting";

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر Inventory (انبارداری و FIFO) در NestJS */
export const INVENTORY_RESOURCE_PATH = "enterprise-hub/inventory";

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر CRM (مدیریت مشتریان و پایپ‌لاین) در NestJS */
export const CRM_RESOURCE_PATH = "enterprise-hub/crm";

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر Auth (احراز هویت پیامکی) در NestJS */
export const AUTH_RESOURCE_PATH = "auth";

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر Tax Compliance (سامانه مودیان) در NestJS */
export const TAX_COMPLIANCE_RESOURCE_PATH = "enterprise-hub/tax-compliance";

/** مسیر پایه‌ی نسخه‌بندی‌شده کنترلر HR (منابع انسانی و حقوق و دستمزد) در NestJS */
export const HR_RESOURCE_PATH = "enterprise-hub/hr";

/** مسیر پایه‌ی کنترلر Radar (رادار فناوری و ازدحام ایجنت‌ها) در NestJS */
export const RADAR_RESOURCE_PATH = "enterprise-hub/radar";

/** مسیر نسبی سمت مرورگر که توسط rewrite در next.config.ts پروکسی می‌شود */
export const API_PROXY_BASE_PATH = "/api/backend";

/**
 * مسیر پایه‌ی موتور قاضی هوشمند (AI Core Layer — FastAPI/Python).
 * این روتر با پیشوند `/api/v1/apps/judge` در `run_unified_server.py`
 * بارگذاری می‌شود و در production روی سرویس `roxira_app_prod:8000` اجرا
 * می‌گردد.
 */
export const JUDGE_RESOURCE_PATH = "api/v1/apps/judge";

/**
 * مسیر هم‌مبدأ سمت مرورگر برای موتور قاضی هوشمند که توسط rewrite در
 * `next.config.ts` به‌صورت سرور-به-سرور به `JUDGE_API_ORIGIN` پروکسی
 * می‌شود (پرهیز از CORS و عدم افشای آدرس واقعی سرویس پایتون).
 */
export const JUDGE_API_PROXY_BASE_PATH = "/api/judge";
