import { SetMetadata } from '@nestjs/common';

/** کلید متادیتا برای مسیرهای عمومی (بدون نیاز به توکن). */
export const IS_PUBLIC_KEY = 'roxira:isPublic';

/**
 * مسیر را از گارد سراسری JWT مستثنی می‌کند. فقط برای مسیرهای واقعاً
 * عمومی (ورود، سلامت سرویس، محتوای عمومی) استفاده شود.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
