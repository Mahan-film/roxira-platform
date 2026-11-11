import { Module, forwardRef } from '@nestjs/common';
import { CurrencyController } from './controllers/currency.controller';
import { CurrencyService } from './services/currency.service';
import { FxRevaluationService } from './services/fx-revaluation.service';
import { PostingRulesModule } from '../posting_rules/posting-rules.module';

/**
 * ماژول لایه چندارزی (Multi-Currency Layer).
 *
 * سرویس CurrencyService به‌عنوان یک قابلیت مشترک به ماژول‌های Invoicing و
 * Accounting صادر می‌شود تا محاسبات فاکتور و دفتر کل چندارزی شوند.
 * از طریق PostingRulesModule اسناد تسعیر ارز پایان دوره را به طور متوازن ثبت می‌کند.
 */
@Module({
  imports: [forwardRef(() => PostingRulesModule)],
  controllers: [CurrencyController],
  providers: [CurrencyService, FxRevaluationService],
  exports: [CurrencyService, FxRevaluationService],
})
export class CurrencyModule {}
