import { Module } from '@nestjs/common';
import { McpModule } from '../../mcp/mcp.module';
import { redisClientProvider } from '../auth/providers/redis.provider';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { AssistantController } from './controllers/assistant.controller';
import { AssistantLlmService } from './services/assistant-llm.service';
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
  imports: [McpModule, InvoicingModule, InventoryModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantToolsService,
    AssistantLlmService,
    AssistantRateLimiterService,
    redisClientProvider,
  ],
})
export class AssistantModule {}
