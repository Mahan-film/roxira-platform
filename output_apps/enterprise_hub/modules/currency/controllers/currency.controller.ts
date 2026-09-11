import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ExchangeRatesResponseDto,
  SupportedCurrenciesResponseDto,
} from '../dto/currency-response.dto';
import { CurrencyService } from '../services/currency.service';

/**
 * کنترلر لایه چندارزی (Multi-Currency Layer).
 *
 * فقط مسیریابی HTTP؛ تمام منطق تبدیل و نرخ در CurrencyService است
 * (Rule #3 — AGENTS.md). این قرارداد پیش از مصرف در فرانت‌اند roxira.net
 * از طریق Swagger تولید و مستند شده است (Rule #4 — Contract-First).
 */
@ApiTags('Currency - نرخ ارز و تسویه بین‌المللی')
@Controller('enterprise-hub/currency')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

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
}
