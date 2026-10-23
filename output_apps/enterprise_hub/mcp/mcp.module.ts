import { Module } from '@nestjs/common';
import { AccountingModule } from '../modules/accounting/accounting.module';
import { CrmModule } from '../modules/crm/crm.module';
import { DataImportModule } from '../modules/data_import/data-import.module';
import { HrModule } from '../modules/hr/hr.module';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { McpController } from './mcp.controller';
import { McpHttpHandler } from './mcp-http.handler';
import { McpToolsService } from './mcp-tools.service';

/**
 * ماژول MCP (Model Context Protocol) روی ماژول‌های سازمانی.
 *
 * ابزارهای MCP از سرویس‌های موجود CRM، منابع انسانی، انبار، حسابداری و ورود
 * داده استفاده می‌کنند (بدون هیچ دسترسی مستقیم به پایگاه‌داده). احراز هویت با
 * گارد سراسری `JwtAuthGuard` انجام می‌شود و مرز مستأجر تنها از پیلود JWT می‌آید.
 * این ماژول هیچ ماژول دیگری را import نمی‌کند که به آن وابسته باشد؛ بنابراین
 * چرخه‌ای ایجاد نمی‌شود (Rule #1 - AGENTS.md).
 */
@Module({
  imports: [
    CrmModule,
    HrModule,
    InventoryModule,
    AccountingModule,
    DataImportModule,
  ],
  controllers: [McpController],
  providers: [McpToolsService, McpHttpHandler],
  exports: [McpToolsService],
})
export class McpModule {}
