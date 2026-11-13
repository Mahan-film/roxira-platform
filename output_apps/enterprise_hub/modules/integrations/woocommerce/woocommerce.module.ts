import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { CurrencyModule } from '../../currency/currency.module';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { TenantsModule } from '../../tenants/tenants.module';
import { WooCommerceConfigController } from './controllers/woocommerce-config.controller';
import { WooCommerceWebhookController } from './controllers/woocommerce-webhook.controller';
import { WooCommerceConfigEntity } from './entities/woocommerce-config.entity';
import { WooCommerceSyncLogEntity } from './entities/woocommerce-sync-log.entity';
import { WooCommerceRepository } from './repositories/woocommerce.repository';
import { WooCommerceSyncService } from './services/woocommerce-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WooCommerceConfigEntity,
      WooCommerceSyncLogEntity,
    ]),
    CurrencyModule,
    InvoicingModule,
    TenantsModule,
  ],
  controllers: [
    WooCommerceConfigController,
    WooCommerceWebhookController,
  ],
  providers: [
    WooCommerceRepository,
    WooCommerceSyncService,
    TenantScope,
  ],
  exports: [
    WooCommerceSyncService,
    WooCommerceRepository,
  ],
})
export class WooCommerceModule {}
