import { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../modules/auth/guards/roles.guard';
import { ProxyAwareThrottlerGuard } from './proxy-aware-throttler.guard';

/** پیش‌فرض سراسری: ۱۰۰ درخواست در دقیقه برای هر IP (مسیرهای Auth سخت‌گیرانه‌تر). */
export const GLOBAL_THROTTLE = { ttl: 60_000, limit: 100 } as const;

/** ماژول Throttler سراسری. */
export const globalThrottlerModule = ThrottlerModule.forRoot([
  { name: 'default', ...GLOBAL_THROTTLE },
]);

/**
 * گاردهای سراسری؛ ترتیب مهم است: Throttler → JWT → Roles.
 * (JwtService باید توسط ماژول میزبان در دسترس باشد: AuthModule آن را export می‌کند.)
 */
export const GLOBAL_GUARD_PROVIDERS: Provider[] = [
  { provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];
