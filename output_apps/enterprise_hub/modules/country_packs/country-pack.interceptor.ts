import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { CountryPackCls, RequestWithCountryPack } from './country-pack.context';
import { CountryPackResolver } from './country-pack.resolver';
import { CountryPack } from './country-pack.types';

/**
 * Intercepts incoming HTTP requests, resolves the organisation's CountryPack, attaches
 * it to the Request object, and scopes the downstream request execution inside `CountryPackCls`.
 *
 * Execution order: NestJS runs Guards (including `JwtAuthGuard`, which sets `request.user.tenantId`)
 * before Interceptors, and `TenantsRepository.findById` executes inside `TenantScope`.
 */
@Injectable()
export class CountryPackInterceptor implements NestInterceptor {
  constructor(private readonly resolver: CountryPackResolver) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & RequestWithCountryPack>();

    const tenantId = request?.user?.tenantId;
    let pack: CountryPack;
    if (tenantId) {
      pack = await this.resolver.resolveForTenant(tenantId);
    } else {
      pack = this.resolver.resolve(null);
    }

    if (request) {
      request.countryPack = pack;
    }

    return new Observable((subscriber) => {
      CountryPackCls.run(pack, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
