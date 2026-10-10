import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIP } from 'net';

/**
 * ThrottlerGuard که IP واقعی کلاینت را پشت nginx/Cloudflare تشخیص می‌دهد.
 *
 * - به‌صورت پیش‌فرض از `req.ip` استفاده می‌شود (با `trust proxy` در main.ts،
 *   یعنی X-Forwarded-For فقط از پروکسی‌های مورداعتماد پذیرفته می‌شود).
 * - اگر `TRUST_CF_CONNECTING_IP=1` باشد (فقط وقتی origin پشت Cloudflare/nginx
 *   است و مستقیم در دسترس نیست)، هدر `CF-Connecting-IP` ترجیح داده می‌شود.
 *   پیش‌فرض خاموش است چون هدر از کلاینت قابل جعل است.
 */
@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return resolveClientIp(req);
  }
}

export function resolveClientIp(req: Record<string, unknown>): string {
  if (process.env.TRUST_CF_CONNECTING_IP === '1') {
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const raw = headers['cf-connecting-ip'];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && isIP(value)) {
      return value;
    }
  }
  const ip = req.ip;
  return typeof ip === 'string' && ip ? ip : 'unknown';
}
