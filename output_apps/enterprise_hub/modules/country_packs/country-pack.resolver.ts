import { Injectable } from '@nestjs/common';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CountryPackCls } from './country-pack.context';
import { CountryPackRegistry } from './country-pack.registry';
import { CountryPack } from './country-pack.types';

/**
 * Service to resolve the active CountryPack by country code, for a tenant, or from the active CLS context.
 * Services ask this resolver or the pack directly, and never branch on country codes (R4 Decision 2).
 */
@Injectable()
export class CountryPackResolver {
  constructor(
    private readonly registry: CountryPackRegistry,
    private readonly tenantsRepository: TenantsRepository,
  ) {}

  /** Resolves pack by ISO alpha-2 country code; missing or null resolves to default (IR). */
  resolve(countryCode?: string | null): CountryPack {
    return this.registry.resolve(countryCode);
  }

  /**
   * Resolves the country pack belonging to `tenantId` by inspecting the tenant's organisation record.
   * `TenantsRepository.findById` runs inside `TenantScope` when `TenantScope` is provided by `TenantsModule`.
   * If the tenant does not exist or has no country_code, falls back to the default pack.
   */
  async resolveForTenant(tenantId: string): Promise<CountryPack> {
    const tenant = await this.tenantsRepository.findById(tenantId);
    return this.registry.resolve(tenant?.countryCode);
  }

  /**
   * Returns the current pack from the async context (CLS), falling back to the platform default pack.
   */
  currentPack(): CountryPack {
    return CountryPackCls.current() ?? this.registry.resolve(null);
  }

  /** Raw registry access. */
  getRegistry(): CountryPackRegistry {
    return this.registry;
  }
}
