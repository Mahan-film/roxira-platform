import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { ChequesModule } from '../cheques/cheques.module';
import { HrModule } from '../hr/hr.module';
import { TaxComplianceModule } from '../tax_compliance/tax-compliance.module';
import { McpModule } from '../../mcp/mcp.module';
import { redisClientProvider } from '../auth/providers/redis.provider';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { TenantScope } from '../access/services/tenant-scope';
import { AssistantController } from './controllers/assistant.controller';
import { AssistantMemoryController } from './controllers/assistant-memory.controller';
import { AssistantMemoryRepository } from './memory/assistant-memory.repository';
import { AssistantMemoryService } from './memory/assistant-memory.service';
import { AssistantLlmService } from './services/assistant-llm.service';
import { AssistantMetricsService } from './metrics/assistant-metrics.service';
import { LedgerMetricSources } from './metrics/ledger-metric-sources';
import { METRIC_SOURCES } from './metrics/metric.types';
import { AssistantRateLimiterService } from './services/assistant-rate-limiter.service';
import { AssistantToolsService } from './services/assistant-tools.service';
import { AssistantService } from './services/assistant.service';

/**
 * ماژول دستیار هوشمند روی داده‌های خود سازمان (Business Suite فاز ۲).
 *
 * ابزارها از ابزارهای MCP موجود (#807) و سرویس‌های صورتحساب/انبار استفاده
 * می‌کنند؛ هیچ دسترسی مستقیم به پایگاه‌داده در این ماژول نیست و هیچ ماژولی
 * به این ماژول وابسته نیست (بدون چرخه - Rule #1).
 */
@Module({
  imports: [
    McpModule,
    InvoicingModule,
    InventoryModule,
    AccountingModule,
    ChequesModule,
    HrModule,
    TaxComplianceModule,
  ],
  controllers: [AssistantController, AssistantMemoryController],
  providers: [
    AssistantService,
    AssistantMemoryService,
    AssistantMemoryRepository,
    TenantScope,
    AssistantToolsService,
    AssistantLlmService,
    AssistantMetricsService,
    LedgerMetricSources,
    { provide: METRIC_SOURCES, useExisting: LedgerMetricSources },
    AssistantRateLimiterService,
    redisClientProvider,
  ],
})
export class AssistantModule {}
