import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PartiesModule } from '../parties/parties.module';
import { SalesController } from './controllers/sales.controller';
import { SalesOrderLineEntity, SalesOrderEntity } from './entities/sales-order.entity';
import { SalesQuotationLineEntity, SalesQuotationEntity } from './entities/sales-quotation.entity';
import { SalesRepository } from './repositories/sales.repository';
import { SalesAvailabilityService } from './services/sales-availability.service';
import { SalesService } from './services/sales.service';

/**
 * Sales cycle, first slice: quotations and sales orders. Imports PartiesModule to check the
 * customer (`PartiesService.getByCode`) and uses TenantScope like parties, so nothing is read or
 * written outside the tenant's `app.tenant_id`. No imports from invoicing or inventory: item and
 * warehouse existence are checked with scoped queries, keeping the dependency graph acyclic.
 */
@Module({
  imports: [
    PartiesModule,
    TypeOrmModule.forFeature([
      SalesQuotationEntity,
      SalesQuotationLineEntity,
      SalesOrderEntity,
      SalesOrderLineEntity,
    ]),
  ],
  controllers: [SalesController],
  providers: [SalesService, SalesRepository, SalesAvailabilityService, TenantScope],
  exports: [SalesService, SalesAvailabilityService],
})
export class SalesModule {}
