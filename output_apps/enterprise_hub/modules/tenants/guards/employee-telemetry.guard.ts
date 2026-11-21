import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { TenantsService } from '../services/tenants.service';

export const EMPLOYEE_TELEMETRY_DISABLED_CODE = 'EMPLOYEE_TELEMETRY_DISABLED';

/**
 * T265 (R26): Works-council safe guard (BetrVG §87(1)6).
 *
 * Apply with `@UseGuards(JwtAuthGuard, EmployeeTelemetryGuard)` on any
 * per-user activity dashboard or individual AI usage analytics endpoint.
 * Fails closed if the tenant context or tenant record is missing.
 */
@Injectable()
export class EmployeeTelemetryGuard implements CanActivate {
  constructor(private readonly tenantsService: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: { tenantId?: string | null };
    }>();
    const tenantId = req?.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        code: EMPLOYEE_TELEMETRY_DISABLED_CODE,
        message: 'Tenant context is required to access employee telemetry endpoints.',
      });
    }

    const tenant = await this.tenantsService.findMyTenant(tenantId);
    if (!tenant) {
      throw new ForbiddenException({
        code: EMPLOYEE_TELEMETRY_DISABLED_CODE,
        message: 'Tenant not found; failing closed on employee telemetry access.',
      });
    }

    if (tenant.noEmployeeTelemetry) {
      throw new ForbiddenException({
        code: EMPLOYEE_TELEMETRY_DISABLED_CODE,
        message:
          'Per-user activity dashboards and individual AI usage analytics are disabled for this tenant (no-employee-telemetry mode).',
      });
    }

    return true;
  }
}
