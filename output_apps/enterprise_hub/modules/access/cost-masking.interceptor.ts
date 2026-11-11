import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
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
  constructor(private readonly costMasking: CostMaskingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AccessRequest>();

    return next.handle().pipe(
      map((data) => {
        // Only enforce field masking when an access context is bound to the request
        if (!request || !request.access) {
          return data;
        }

        const canView = this.costMasking.canViewCost(request.access);
        return this.costMasking.maskCostFields(data, canView);
      }),
    );
  }
}
