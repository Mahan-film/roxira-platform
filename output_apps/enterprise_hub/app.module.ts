import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as fs from 'fs';
import * as path from 'path';
import {
  GLOBAL_GUARD_PROVIDERS,
  globalThrottlerModule,
} from './security/global-guards';
import { DamagesModule } from './modules/damages/damages.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CrmModule } from './modules/crm/crm.module';
import { DataImportModule } from './modules/data_import/data-import.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ReportBuilderModule } from './modules/report_builder/report-builder.module';
import { TenantPolicyModule } from './modules/tenants/policy/policy.module';
import { TaxComplianceModule } from './modules/tax_compliance/tax-compliance.module';
import { HrModule } from './modules/hr/hr.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { HealthModule } from './modules/health/health.module';
import { RadarModule } from './modules/radar/radar.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { ClientErrorsModule } from './modules/client-errors/client-errors.module';
import { BankingModule } from './modules/banking/banking.module';
import { ChequesModule } from './modules/cheques/cheques.module';
import { TreasuryModule } from './modules/treasury/treasury.module';
import { McpModule } from './mcp/mcp.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { InvoiceCaptureModule } from './modules/invoice_capture/invoice-capture.module';
import { PublicApiModule } from './modules/public_api/public-api.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { PostingRulesModule } from './modules/posting_rules/posting-rules.module';
import { SalesModule } from './modules/sales/sales.module';
import { SalesDeliveryModule } from './modules/sales/delivery/sales-delivery.module';
import { SalesReturnModule } from './modules/sales/returns/sales-return.module';
import { ContractingModule } from './modules/contracting/contracting.module';

const ENV_FILES = [path.resolve('/opt/roxira_platform/.env'), path.resolve(process.cwd(), '.env')].filter(
  (file) => {
    try {
      fs.accessSync(file, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  },
);

@Module({
  providers: GLOBAL_GUARD_PROVIDERS,
  imports: [
    globalThrottlerModule,
    ConfigModule.forRoot({
      isGlobal: true,
      // In production the container runs non-root and gets its env from compose `env_file`;
      // the host .env is root-only (600), so only load files that are actually readable.
      envFilePath: ENV_FILES,
      ignoreEnvFile: ENV_FILES.length === 0,
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
    AccessModule,
    AuthModule,
    TenantsModule,
    TenantPolicyModule,
    ApprovalsModule,
    ReportBuilderModule,
    InventoryModule,
    CrmModule,
    DataImportModule,
    TaxComplianceModule,
    HrModule,
    CurrencyModule,
    HealthModule,
    RadarModule,
    InquiriesModule,
    ClientErrorsModule,
    BankingModule,
    ChequesModule,
    TreasuryModule,
    McpModule,
    AssistantModule,
    InvoiceCaptureModule,
    PublicApiModule,
    CalendarModule,
    PostingRulesModule,
    SalesModule,
    SalesDeliveryModule,
    SalesReturnModule,
    ContractingModule,
  ],
})
export class AppModule {}
