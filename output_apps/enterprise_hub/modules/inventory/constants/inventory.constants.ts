/**
 * ثابت‌های ماژول انبارداری سازمانی و قیمت‌گذاری FIFO.
 */
export const INVENTORY_RESOURCE = 'enterprise-hub/inventory';

/** دقت گرد کردن مبالغ ریالی (۲ رقم اعشار). */
export const MONEY_SCALE = 2;

/** دقت گرد کردن مقادیر فیزیکی کالا. */
export const QUANTITY_SCALE = 2;

/** حداکثر تعداد دسته (batch) که یک خروج FIFO می‌تواند مصرف کند. */
export const MAX_FIFO_LAYERS = 500;
