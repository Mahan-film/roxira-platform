import { ForbiddenException } from '@nestjs/common';
import { TenantStatus } from '../enums/tenant-status.enum';

export function isSafeReadMethod(method: string): boolean {
  const upper = String(method || '').toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}

/**
 * Shared read-only and purge enforcement rule used by both AccessGuard and CancelledReadonlyGuard.
 */
export function assertTenantCancellationAccess(params: {
  status: TenantStatus | string | null | undefined;
  deleteAfter?: Date | string | null;
  method: string;
  allowDuringCancellation?: boolean;
}): void {
  if (params.status === TenantStatus.PURGED) {
    throw new ForbiddenException('سازمان پاکسازی شده و دسترسی به آن مسدود است.');
  }

  if (params.status === TenantStatus.CANCELLED_READONLY) {
    if (!isSafeReadMethod(params.method) && !params.allowDuringCancellation) {
      const deleteDate = params.deleteAfter
        ? new Date(params.deleteAfter).toISOString()
        : 'retention expiry';
      throw new ForbiddenException(
        `سازمان در وضعیت «فقط خواندنی به دلیل لغو اشتراک» قرار دارد (تا تاریخ ${deleteDate}). امکان ثبت یا تغییر داده‌ها وجود ندارد؛ استخراج کامل داده‌ها در دسترس است.`,
      );
    }
  }
}
