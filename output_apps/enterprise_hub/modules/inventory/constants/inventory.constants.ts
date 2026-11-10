import { BadRequestException } from '@nestjs/common';

/**
 * ثابت‌های ماژول انبارداری سازمانی و قیمت‌گذاری FIFO.
 */
export const INVENTORY_RESOURCE = 'enterprise-hub/inventory';

/** دقت گرد کردن مبالغ ریالی (۲ رقم اعشار). */
export const MONEY_SCALE = 2;

/** دقت گرد کردن مقادیر فیزیکی کالا. */
export const QUANTITY_SCALE = 2;

/** یک واحد کامل در صدم؛ 10n ** BigInt(QUANTITY_SCALE) */
export const QUANTITY_UNIT = 100n;

/** حداکثر تعداد دسته (batch) که یک خروج FIFO می‌تواند مصرف کند. */
export const MAX_FIFO_LAYERS = 500;

/**
 * کنترل دقت اعشار مقادیر کالا: مقادیر با اعشار بیشتر از scale (پیش‌فرض ۲ رقم)
 * به‌جای گرد شدن بی‌صدا، با خطای BadRequestException رد می‌شوند (#500).
 */
export function assertValidQuantityScale(
  quantity: number,
  scale: number = QUANTITY_SCALE,
  fieldName = 'مقدار کالا',
): void {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new BadRequestException(`${fieldName} باید عددی غیرمنفی باشد.`);
  }
  const factor = 10 ** scale;
  const scaled = quantity * factor;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    throw new BadRequestException(
      `${fieldName} حداکثر ${scale} رقم اعشار مجاز است و گرد نمی‌شود.`,
    );
  }
}
