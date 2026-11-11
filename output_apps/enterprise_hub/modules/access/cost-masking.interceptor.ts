import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AccessRequest } from './access-context';
import { CostMaskingService } from './services/cost-masking.service';

/**
 * Intercepts HTTP responses and automatically scrubs sensitive purchase cost and
 * valuation fields if the caller does not have cost visibility entitlement (#738 / T76).
 */
@Injectable()
export class CostMaskingInterceptor implements NestInterceptor {
  private readonly costMasking: CostMaskingService;

  constructor(@Optional() costMasking?: CostMaskingService) {
    this.costMasking = costMasking ?? new CostMaskingService();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AccessRequest>();

    return next.handle().pipe(
      map((data) => {
        // Only enforce field masking when an access context is bound to the request
        if (!request || !request.access) {
          return data;
        }

        // Scope cost masking to inventory, sales/invoicing, parties, and purchasing where item costs live.
        // Accounting, budget, cost centres and HR responses are never masked.
        const url = request.originalUrl || request.url || '';
        const isCostArea =
          !url ||
          url.includes('/inventory') ||
          url.includes('/sales') ||
          url.includes('/invoicing') ||
          url.includes('/parties') ||
          url.includes('/purchase');
        if (!isCostArea) {
          return data;
        }

        const canView = this.costMasking.canViewCost(request.access);
        return this.costMasking.maskCostFields(data, canView);
      }),
    );
  }
}
