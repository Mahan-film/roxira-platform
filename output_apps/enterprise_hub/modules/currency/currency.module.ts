import { Module } from '@nestjs/common';
import { CurrencyController } from './controllers/currency.controller';
import { CurrencyService } from './services/currency.service';

/**
 * ماژول لایه چندارزی (Multi-Currency Layer).
 *
 * سرویس CurrencyService به‌عنوان یک قابلیت مشترک به ماژول‌های Invoicing و
 * Accounting صادر می‌شود تا محاسبات فاکتور و دفتر کل چندارزی شوند.
 * هیچ import چرخه‌ای با سایر ماژول‌ها ندارد (Rule #1 — AGENTS.md).
 */
@Module({
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
