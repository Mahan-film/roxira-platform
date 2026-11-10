import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { HrModule } from '../hr/hr.module';
import { StatutoryService } from '../hr/statutory/statutory.service';
import { CountryPackRegistry } from './country-pack.registry';
import { createIranPack } from './ir/ir.pack';

export const DEFAULT_COUNTRY = 'IR';

/**
 * Builds the registry with the production packs. The test pack is never registered here. Nothing in
 * the product reads the registry yet: callers switch over one module at a time (see the ADR).
 */
@Module({
  imports: [CalendarModule, HrModule],
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
  ],
  exports: [CountryPackRegistry],
})
export class CountryPacksModule {}
