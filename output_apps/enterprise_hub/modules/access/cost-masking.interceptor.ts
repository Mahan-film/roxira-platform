import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  Optional,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AccessRequest } from './access-context';
import { CostMaskingService, isPurchasingPath, isValuationPath } from './services/cost-masking.service';

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

        // Strip URI version prefix (e.g. /v1/enterprise-hub/... -> /enterprise-hub/...)
        const unversioned = pathname.replace(/^\/v\d+/, '');

        // Skip explicitly exempt routes (ledger accounting, audit logs, auth session endpoints)
        if (this.exemptPrefixes.some((p) => unversioned === p || unversioned.startsWith(`${p}/`))) {
          return data;
        }

        // Evaluate field visibility for current access context or user role (fail-closed)
        const roleOrCtx = request.access ?? request.user?.tenantRole ?? request.user?.role;
        const canView = this.costMasking.canViewCost(roleOrCtx);
        if (canView) {
          return data;
        }

        const isPurchasing = isPurchasingPath(pathname);
        const isValuation = isValuationPath(unversioned);

        // Fail-closed on raw/file outputs (StreamableFile, Buffer, streams, string bodies such as CSV) on cost
        // routes. undefined / null / numbers / booleans (void handlers, DELETE 204) pass through untouched.
        if (
          (isPurchasing || isValuation) &&
          (data instanceof StreamableFile ||
            typeof data === 'string' ||
            (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) ||
            typeof (data as any)?.pipe === 'function')
        ) {
          throw new ForbiddenException(
            'مشاهده فایل یا خروجی گزارش حاوی قیمت‌های خرید و بهای تمام‌شده برای این نقش مجاز نیست.',
          );
        }

        return this.costMasking.maskCostFields(data, false, undefined, isPurchasing, isValuation);
      }),
    );
  }
}
