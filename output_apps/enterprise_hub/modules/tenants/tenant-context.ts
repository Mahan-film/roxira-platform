import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';

/**
 * استخراج اجباری شناسه مستأجر از کاربر احراز‌هویت‌شده روی Request. مقدار را AccessGuard
 * پس از تطبیق با عضویت واقعی در پایگاه داده بازنویسی کرده است.
 *
 * Fail-closed: اگر کاربر به هیچ سازمانی متصل نباشد، دسترسی ممنوع می‌شود. هرگز
 * به شناسه کاربر (`sub`) بازنمی‌گردیم و شناسه مستأجر را هرگز از بدنه، کوئری یا
 * هدر درخواست نمی‌خوانیم (Rule #4 - AGENTS.md).
 */
export function requireTenantId(request: AuthenticatedRequest): string {
  const tenantId = request.user?.tenantId;
  if (!tenantId) {
    throw new ForbiddenException('حساب شما به هیچ سازمانی متصل نیست.');
  }
  return tenantId;
}
