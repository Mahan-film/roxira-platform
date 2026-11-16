import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { ALLOW_DURING_CANCELLATION_KEY } from '../decorators/allow-during-cancellation.decorator';
import { TenantStatus } from '../enums/tenant-status.enum';
import { TenantsRepository } from '../repositories/tenants.repository';

@Injectable()
export class CancelledReadonlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantsRepo: TenantsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    // Public routes are always allowed
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    // Routes explicitly marked as permitted during cancellation (e.g. data export)
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_DURING_CANCELLATION_KEY,
        targets,
      )
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const method = String(request.method || '').toUpperCase();

    // Safe read methods are always permitted in cancelled_readonly state
    const isSafeRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

    const tenantId = request.user?.tenantId || request.access?.tenantId;
    if (!tenantId) {
      return true;
    }

    const tenant = await this.tenantsRepo.findById(tenantId);
    if (!tenant) {
      return true;
    }

    if (tenant.status === TenantStatus.CANCELLED_READONLY) {
      if (!isSafeRead) {
        const deleteDate = tenant.deleteAfter
          ? new Date(tenant.deleteAfter).toISOString()
          : 'retention expiry';
        throw new ForbiddenException(
          `سازمان در وضعیت «فقط خواندنی به دلیل لغو اشتراک» قرار دارد (تا تاریخ ${deleteDate}). امکان ثبت یا تغییر داده‌ها وجود ندارد؛ استخراج کامل داده‌ها در دسترس است.`,
        );
      }
    }

    if (tenant.status === TenantStatus.PURGED) {
      throw new ForbiddenException('سازمان پاکسازی شده و دسترسی به آن مسدود است.');
    }

    return true;
  }
}
