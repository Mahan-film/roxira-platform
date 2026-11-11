import { Module } from '@nestjs/common';
import { CurrencyController } from './controllers/currency.controller';
import { CurrencyService } from './services/currency.service';
import { FxRevaluationService } from './services/fx-revaluation.service';

/**
 * ماژول لایه چندارزی (Multi-Currency Layer).
 *
 * سرویس CurrencyService به‌عنوان یک قابلیت مشترک به ماژول‌های Invoicing و
 * Accounting صادر می‌شود تا محاسبات فاکتور و دفتر کل چندارزی شوند.
 * ثبت اسناد تسعیر ارز پایان دوره از طریق PostingRulesService به صورت تنبل و بدون وابستگی چرخه‌ای انجام می‌شود.
 */
@Module({
  imports: [],
  controllers: [CurrencyController],
  providers: [CurrencyService, FxRevaluationService],
  exports: [CurrencyService, FxRevaluationService],
})
export class CurrencyModule {}
