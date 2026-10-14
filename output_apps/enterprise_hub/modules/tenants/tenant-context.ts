import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { TenantRole } from './enums/tenant-role.enum';

/**
 * استخراج اجباری شناسه مستأجر از کاربر احراز‌هویت‌شده روی Request.
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

/**
 * الزام نقش «مالک سازمان» برای عملیات مدیریت اعضا.
 *
 * نقش سازمانی فقط از claim تأییدشده JWT خوانده می‌شود (`tenantRole`) و کاملاً
 * مستقل از `UserRole` سراسری است. کاربر بدون نقش OWNER با ۴۰۳ رد می‌شود.
 */
export function requireTenantOwner(request: AuthenticatedRequest): void {
  if (request.user?.tenantRole !== TenantRole.OWNER) {
    throw new ForbiddenException('فقط مالک سازمان مجاز است.');
  }
}

/**
 * الزام دسترسی مدیریتی درون سازمان برای مسیرهای سازمانی Wave 1.
 *
 * دسترسی زمانی مجاز است که کاربر یا اپراتور پلتفرم (`UserRole.ADMIN`) باشد یا
 * مالک سازمان (`TenantRole.OWNER`). نقش‌ها فقط از claim تأییدشده JWT خوانده
 * می‌شوند و در هر دو حالت scope مستأجر همچنان از `requireTenantId` می‌آید.
 */
export function requireTenantAdmin(request: AuthenticatedRequest): void {
  const isPlatformAdmin = request.user?.role === UserRole.ADMIN;
  const isTenantOwner = request.user?.tenantRole === TenantRole.OWNER;

  if (!isPlatformAdmin && !isTenantOwner) {
    throw new ForbiddenException('دسترسی مدیریتی سازمان لازم است.');
  }
}
