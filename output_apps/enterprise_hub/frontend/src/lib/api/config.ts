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

/** مسیر نسبی سمت مرورگر که توسط rewrite در next.config.ts پروکسی می‌شود */
export const API_PROXY_BASE_PATH = "/api/backend";
