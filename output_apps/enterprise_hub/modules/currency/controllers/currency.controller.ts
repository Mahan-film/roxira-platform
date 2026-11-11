import { Public } from '../../auth/decorators/public.decorator';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ExchangeRatesResponseDto,
  SupportedCurrenciesResponseDto,
} from '../dto/currency-response.dto';
import { RevalueBalancesDto } from '../dto/revaluation.dto';
import { CurrencyService } from '../services/currency.service';
import { ForeignAccountBalance, FxRevaluationService } from '../services/fx-revaluation.service';

/**
 * کنترلر لایه چندارزی (Multi-Currency Layer).
 *
 * فقط مسیریابی HTTP؛ تمام منطق تبدیل و نرخ در CurrencyService و FxRevaluationService است
 * (Rule #3 — AGENTS.md). این قرارداد پیش از مصرف در فرانت‌اند roxira.net
 * از طریق Swagger تولید و مستند شده است (Rule #4 — Contract-First).
 */
@ApiTags('Currency - نرخ ارز و تسویه بین‌المللی')
@Public()
@Controller('enterprise-hub/currency')
export class CurrencyController {
  constructor(
    private readonly currencyService: CurrencyService,
    private readonly fxRevaluationService: FxRevaluationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'فهرست ارزهای پشتیبانی‌شده و ارز پایه' })
  @ApiResponse({ status: 200, type: SupportedCurrenciesResponseDto })
  listSupported(): SupportedCurrenciesResponseDto {
    return this.currencyService.listSupported();
  }

  @Get('rates')
  @ApiOperation({
    summary: 'نرخ تبدیل ارزها نسبت به ارز پایه (USD)',
    description:
      'نرخ‌های مرجع بین‌المللی USD/EUR/AED/IRR که در محاسبات فاکتور و دفتر کل به کار می‌روند.',
  })
  @ApiResponse({ status: 200, type: ExchangeRatesResponseDto })
  getRates(): ExchangeRatesResponseDto {
    return this.currencyService.getRates();
  }

  @Post('revaluation')
  @ApiOperation({
    summary: 'ثبت سند تسعیر ارز پایان دوره برای حساب‌های ارزی',
    description: 'محاسبه مابه‌التفاوت تسعیر ارز و صدور سند حسابداری متوازن از طریق موتور قواعد ثبت.',
  })
  async revalueMonthEnd(@Body() dto: RevalueBalancesDto) {
    const balances: ForeignAccountBalance[] = dto.balances.map((b) => ({
      accountCode: b.accountCode,
      accountName: b.accountName,
      currency: b.currency,
      foreignAmountMinor: BigInt(b.foreignAmountMinor),
      bookValueRialMinor: BigInt(b.bookValueRialMinor),
      isLiability: b.isLiability,
    }));
    return this.fxRevaluationService.postMonthEndRevaluation(dto.tenantId, {
      period: dto.period,
      date: dto.date,
      balances,
    });
  }
}
