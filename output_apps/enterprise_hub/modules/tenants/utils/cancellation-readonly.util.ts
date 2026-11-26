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
  if (!params.status) {
    throw new ForbiddenException('وضعیت سازمان مشخص نیست؛ دسترسی مسدود شد.');
  }

  if (params.status === TenantStatus.PURGED) {
    throw new ForbiddenException('سازمان پاکسازی شده و دسترسی به آن مسدود است.');
  }

  if (params.status === TenantStatus.CANCELLED_READONLY) {
    if (!isSafeReadMethod(params.method) && !params.allowDuringCancellation) {
      let deleteDate = 'retention expiry';
      if (params.deleteAfter) {
        const d = new Date(params.deleteAfter);
        deleteDate = !isNaN(d.getTime()) ? d.toISOString() : 'retention expiry';
      }
      throw new ForbiddenException(
        `سازمان در وضعیت «فقط خواندنی به دلیل لغو اشتراک» قرار دارد (تا تاریخ ${deleteDate}). امکان ثبت یا تغییر داده‌ها وجود ندارد؛ استخراج کامل داده‌ها در دسترس است.`,
      );
    }
  }
}
