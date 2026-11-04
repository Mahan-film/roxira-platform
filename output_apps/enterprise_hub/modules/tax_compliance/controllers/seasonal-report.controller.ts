import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { QuerySeasonalReportDto } from '../dto/query-seasonal-report.dto';
import {
  SeasonalPurchaseRow,
  SeasonalReportService,
  SeasonalTransactionRow,
  SeasonalVatReport,
} from '../reports/seasonal-report.service';

/**
 * گزارش‌های فصلی (ارزش افزوده و فهرست معاملات) از صورتحساب‌های مستأجر.
 * شناسه مستأجر فقط از claim تأییدشده JWT خوانده می‌شود.
 */
@ApiTags('Tax Compliance - گزارش‌های فصلی')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/reports')
export class SeasonalReportController {
  constructor(private readonly reports: SeasonalReportService) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  @Get('vat-seasonal')
  @ApiOperation({ summary: 'گزارش فصلی مالیات بر ارزش افزوده (فروش) در فصل شمسی' })
  vat(
    @Req() request: AuthenticatedRequest,
    @Query() query: QuerySeasonalReportDto,
  ): Promise<SeasonalVatReport> {
    return this.reports.vatReport(this.tenantIdOf(request), query.year, query.quarter);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('vat-seasonal.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'خروجی CSV خلاصه فصلی ارزش افزوده' })
  vatCsv(@Req() request: AuthenticatedRequest, @Query() query: QuerySeasonalReportDto): Promise<string> {
    return this.reports.vatCsv(this.tenantIdOf(request), query.year, query.quarter);
  }

  @Get('seasonal-transactions')
  @ApiOperation({ summary: 'فهرست فروش فصلی (معاملات فصلی) به تفکیک صورتحساب' })
  transactions(
    @Req() request: AuthenticatedRequest,
    @Query() query: QuerySeasonalReportDto,
  ): Promise<{
    period: SeasonalVatReport['period'];
    rows: SeasonalTransactionRow[];
    purchaseRows: SeasonalPurchaseRow[];
    notes: string[];
  }> {
    return this.reports.transactions(this.tenantIdOf(request), query.year, query.quarter);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('seasonal-transactions.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'خروجی CSV فهرست فروش فصلی' })
  transactionsCsv(
    @Req() request: AuthenticatedRequest,
    @Query() query: QuerySeasonalReportDto,
  ): Promise<string> {
    return this.reports.transactionsCsv(this.tenantIdOf(request), query.year, query.quarter);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('seasonal-purchases.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'خروجی CSV فهرست خرید فصلی و مالیات ورودی' })
  purchasesCsv(@Req() request: AuthenticatedRequest, @Query() query: QuerySeasonalReportDto): Promise<string> {
    return this.reports.purchasesCsv(this.tenantIdOf(request), query.year, query.quarter);
  }
}
