import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { RequestWithCountryPack } from '../country_packs/country-pack.context';
import { CountryPackResolver } from '../country_packs/country-pack.resolver';
import { FeatureFlagsService } from './feature-flags.service';
import { REQUIRE_FLAG_KEY, RequiredFlag } from './require-flag.constants';

/**
 * Evaluates the flag named by `@RequireFlag` with the tenant id from the authenticated
 * user (never from the request body or headers) and the tenant's country pack.
 * Guards run before the CountryPackInterceptor, so the pack is resolved here when absent.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService,
    private readonly packs: CountryPackResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredFlag | undefined>(
      REQUIRE_FLAG_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & RequestWithCountryPack>();
    const tenantId = request.user?.tenantId ?? null;
    let countryPack = request.countryPack?.country ?? null;
    if (!countryPack) {
      try {
        const pack = tenantId
          ? await this.packs.resolveForTenant(tenantId)
          : this.packs.resolve(null);
        countryPack = pack.country;
      } catch {
        countryPack = null;
      }
    }

    const enabled = await this.flags.isEnabled(
      required.flag,
      { tenantId, countryPack },
      { failOpen: required.failOpen },
    );
    if (!enabled) throw new NotFoundException('Feature not available');
    return true;
  }
}
