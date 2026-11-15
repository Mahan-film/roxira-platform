import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { HrModule } from '../hr/hr.module';
import { StatutoryService } from '../hr/statutory/statutory.service';
import { TenantsModule } from '../tenants/tenants.module';
import { CURRENT_COUNTRY_PACK } from './country-pack.context';
import { CountryPackInterceptor } from './country-pack.interceptor';
import { CountryPackRegistry } from './country-pack.registry';
import { CountryPackResolver } from './country-pack.resolver';
import { createIranPack } from './ir/ir.pack';

export const DEFAULT_COUNTRY = 'IR';

/**
 * Country Packs Module.
 *
 * Builds the registry with the production packs, wires the CLS and per-request resolver,
 * and provides access to country-scoped localisation, statutory, tax and calendar adapters.
 */
@Module({
  imports: [CalendarModule, HrModule, TenantsModule],
  providers: [
    {
      provide: CountryPackRegistry,
      inject: [StatutoryService],
      useFactory: (statutory: StatutoryService): CountryPackRegistry => {
        const registry = new CountryPackRegistry(DEFAULT_COUNTRY);
        registry.register(createIranPack({ statutory }));
        return registry;
      },
    },
    CountryPackResolver,
    CountryPackInterceptor,
    {
      provide: CURRENT_COUNTRY_PACK,
      inject: [CountryPackResolver],
      useFactory: (resolver: CountryPackResolver) => resolver.currentPack(),
    },
  ],
  exports: [
    CountryPackRegistry,
    CountryPackResolver,
    CountryPackInterceptor,
    CURRENT_COUNTRY_PACK,
  ],
})
export class CountryPacksModule {}
