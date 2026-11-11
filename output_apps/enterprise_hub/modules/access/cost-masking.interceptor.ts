import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AccessRequest } from './access-context';
import { CostMaskingService } from './services/cost-masking.service';

/**
 * Intercepts HTTP responses and automatically scrubs sensitive purchase cost and
 * valuation fields across authenticated routes if the caller does not have cost visibility entitlement (#738 / T76).
 */
@Injectable()
export class CostMaskingInterceptor implements NestInterceptor {
  private readonly costMasking: CostMaskingService;

  /** Explicitly exempt route path prefixes where raw financial ledger entries or auth sessions operate */
  private readonly exemptPrefixes = [
    '/enterprise-hub/accounting',
    '/enterprise-hub/period-locks',
    '/enterprise-hub/audit',
    '/enterprise-hub/auth',
  ];

  constructor(@Optional() costMasking?: CostMaskingService) {
    this.costMasking = costMasking ?? new CostMaskingService();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AccessRequest>();

    return next.handle().pipe(
      map((data) => {
        // Only enforce field masking when a user is authenticated
        if (!request || (!request.user && !request.access)) {
          return data;
        }

        // Parse pathname, stripping query parameters and hash fragments to prevent spoofing bypasses
        const rawUrl = request.originalUrl || request.url || '';
        const pathname = rawUrl.split('?')[0].split('#')[0];
        // Skip explicitly exempt routes (ledger accounting, audit logs, auth session endpoints)
        if (this.exemptPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
          return data;
        }

        // Evaluate field visibility for current access context or user role (fail-closed)
        const roleOrCtx = request.access ?? request.user?.tenantRole ?? request.user?.role;
        const canView = this.costMasking.canViewCost(roleOrCtx);
        if (canView) {
          return data;
        }

        return this.costMasking.maskCostFields(data, false);
      }),
    );
  }
}
