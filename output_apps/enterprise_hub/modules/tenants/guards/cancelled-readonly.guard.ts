import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { ALLOW_DURING_CANCELLATION_KEY } from '../decorators/allow-during-cancellation.decorator';
import { TenantsRepository } from '../repositories/tenants.repository';
import { assertTenantCancellationAccess } from '../utils/cancellation-readonly.util';

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

    const allowDuringCancellation = Boolean(
      this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_DURING_CANCELLATION_KEY,
        targets,
      ),
    );

    const request = context.switchToHttp().getRequest();
    const method = String(request.method || '').toUpperCase();

    const tenantId = request.user?.tenantId || request.access?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('شناسه سازمان در درخواست مشخص نیست.');
    }

    const tenant = await this.tenantsRepo.findById(tenantId);
    if (!tenant) {
      throw new ForbiddenException('سازمان مورد نظر یافت نشد.');
    }

    assertTenantCancellationAccess({
      status: tenant.status,
      deleteAfter: tenant.deleteAfter,
      method,
      allowDuringCancellation,
    });

    return true;
  }
}
