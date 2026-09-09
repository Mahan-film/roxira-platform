export const DAMAGES_QUEUE_NAME = 'damages-calculation-queue';
export const DAMAGES_BULK_JOB_NAME = 'calculate-bulk-damages';

/** حداکثر تعداد آیتم قابل قبول در هر درخواست محاسبه دسته‌ای (Bulk) */
export const MAX_BULK_ITEMS = 500;

/** مرجع قانونی پیش‌فرض ثبت‌شده برای هر رکورد محاسبه */
export const LEGAL_BASIS_CPI =
  'ماده ۵۲۲ قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی (شاخص بانک مرکزی)';
export const LEGAL_BASIS_ANNUAL_RATE =
  'محاسبه توافقی بر مبنای نرخ سود سالانه قراردادی طرفین';
