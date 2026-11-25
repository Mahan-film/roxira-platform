import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CalendarModule } from '../calendar/calendar.module';
import { HrModule } from '../hr/hr.module';
import { StatutoryService } from '../hr/statutory/statutory.service';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CURRENT_COUNTRY_PACK } from './country-pack.context';
import { CountryPackInterceptor } from './country-pack.interceptor';
import { CountryPackRegistry } from './country-pack.registry';
import { CountryPackResolver } from './country-pack.resolver';
import { DatevExtfService } from './de/datev/datev-extf.service';
import { createIranPack } from './ir/ir.pack';
import { createMalaysiaPack } from './my/my.pack';
import { RailSettlementService } from './payment_rails/rail-settlement.service';

export const DEFAULT_COUNTRY = 'IR';

/**
 * Country Packs Module.
 *
 * Builds the registry with the production packs, wires the CLS and per-request resolver,
 * and provides access to country-scoped localisation, statutory, tax and calendar adapters.
 * The test pack is never registered here.
 */
// @Global() exports only the country-pack registry/resolver/interceptor/context token (never HrModule internals),
// allowing HrModule and TaxComplianceModule to inject CountryPackRegistry without circular module imports.
@Global()
@Module({
  imports: [CalendarModule, HrModule, TenantsModule, PostingRulesModule],
  providers: [
    {
      provide: CountryPackRegistry,
      inject: [StatutoryService],
      useFactory: (statutory: StatutoryService): CountryPackRegistry => {
        const registry = new CountryPackRegistry(DEFAULT_COUNTRY);
        registry.register(createIranPack({ statutory }));
        registry.register(createMalaysiaPack());
        return registry;
      },
    },
    CountryPackResolver,
    CountryPackInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: CountryPackInterceptor,
    },
    DatevExtfService,
    {
      provide: CURRENT_COUNTRY_PACK,
      inject: [CountryPackResolver],
      useFactory: (resolver: CountryPackResolver) =>
        new Proxy({} as any, {
          get(_target, prop) {
            const pack = resolver.currentPack();
            const val = (pack as any)?.[prop];
            return typeof val === 'function' ? val.bind(pack) : val;
          },
        }),
    },
    RailSettlementService,
  ],
  exports: [
    CountryPackRegistry,
    CountryPackResolver,
    CountryPackInterceptor,
    DatevExtfService,
    CURRENT_COUNTRY_PACK,
    RailSettlementService,
  ],
})
export class CountryPacksModule {}
