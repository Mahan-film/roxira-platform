import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as path from 'path';
import { DamagesModule } from './modules/damages/damages.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AuthModule } from './modules/auth/auth.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CrmModule } from './modules/crm/crm.module';
import { TaxComplianceModule } from './modules/tax_compliance/tax-compliance.module';
import { HrModule } from './modules/hr/hr.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { HealthModule } from './modules/health/health.module';
import { RadarModule } from './modules/radar/radar.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve('/opt/roxira_platform/.env'), path.resolve(process.cwd(), '.env')],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DATABASE_HOST', '127.0.0.1'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get<string>('DATABASE_USER', 'enterprise_admin'),
        password: config.getOrThrow<string>('DATABASE_PASSWORD'),
        database: config.get<string>('DATABASE_NAME', 'enterprise_db'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    DamagesModule,
    InvoicingModule,
    AccountingModule,
    AuthModule,
    InventoryModule,
    CrmModule,
    TaxComplianceModule,
    HrModule,
    CurrencyModule,
    HealthModule,
    RadarModule,
  ],
})
export class AppModule {}
