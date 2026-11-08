import { Controller, Get, Header, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { ExportVatReturnDto } from '../dto/export-vat-return.dto';
import { QuerySeasonalReportDto } from '../dto/query-seasonal-report.dto';
import {
  QueryTaxInspectorPackageDto,
  TaxInspectorPackageView,
} from '../dto/tax-inspector-report.dto';
import {
  QueryQuarterlyTaxComparisonDto,
  QuarterlyTaxComparisonView,
} from '../dto/quarterly-tax-comparison.dto';
import {
  QueryYearEndRolloverDto,
  YearEndTaxRolloverView,
} from '../dto/year-end-tax-rollover.dto';
import { renderVatReturn } from '../reports/vat-return-export';
import { VatReturn, VatReturnService } from '../reports/vat-return.service';
import {
  SeasonalPurchaseRow,
  SeasonalReportService,
  SeasonalTransactionRow,
  SeasonalVatReport,
} from '../reports/seasonal-report.service';
import { TaxInspectorService } from '../reports/tax-inspector.service';
import { QuarterlyTaxComparisonService } from '../reports/quarterly-tax-comparison.service';
import { YearEndTaxRolloverService } from '../reports/year-end-tax-rollover.service';

/**
 * گزارش‌های فصلی (ارزش افزوده و فهرست معاملات) از صورتحساب‌های مستأجر.
 * شناسه مستأجر فقط از claim تأییدشده JWT خوانده می‌شود.
 */
@ApiTags('Tax Compliance - گزارش‌های فصلی')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/reports')
export class SeasonalReportController {
  constructor(
    private readonly reports: SeasonalReportService,
    private readonly vatReturns: VatReturnService,
    private readonly taxInspector: TaxInspectorService,
    private readonly taxComparison: QuarterlyTaxComparisonService,
    private readonly yearEndService: YearEndTaxRolloverService,
  ) {}

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

  @Get('vat-return')
  @ApiOperation({ summary: 'پیش‌نویس اظهارنامه ارزش افزوده فصل، تطبیق‌شده با دفتر کل' })
  vatReturn(@Req() request: AuthenticatedRequest, @Query() query: QuerySeasonalReportDto): Promise<VatReturn> {
    return this.vatReturns.vatReturn(this.tenantIdOf(request), query.year, query.quarter);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('vat-return/export')
  @ApiOperation({ summary: 'خروجی XLSX یا PDF پیش‌نویس اظهارنامه ارزش افزوده' })
  async vatReturnExport(
    @Req() request: AuthenticatedRequest,
    @Query() query: ExportVatReturnDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    const report = await this.vatReturns.vatReturn(this.tenantIdOf(request), query.year, query.quarter);
    const file = await renderVatReturn(report, query.format ?? 'xlsx');
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.body);
  }

  @Get('tax-inspector-package')
  @ApiOperation({ summary: 'بسته ممیز مالیاتی: خلاصه پرونده مالیاتی، تطبیق فروش و دفاتر، و بررسی سلامت اسناد' })
  taxInspectorPackage(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryTaxInspectorPackageDto,
  ): Promise<TaxInspectorPackageView> {
    return this.taxInspector.generatePackage(this.tenantIdOf(request), query.year);
  }

  @Get('quarterly-tax-comparison')
  @ApiOperation({ summary: 'گزارش مقایسه‌ای فصلی مالیات: تحلیل روندهای چهار فصل، مغایرت‌ها و مالیات عملکرد' })
  quarterlyComparison(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryQuarterlyTaxComparisonDto,
  ): Promise<QuarterlyTaxComparisonView> {
    return this.taxComparison.generateComparison(this.tenantIdOf(request), query.year);
  }

  @Get('year-end-tax-rollover')
  @ApiOperation({ summary: 'تطبیق مالیاتی پایان سال و چک‌لیست آمادگی بستن سال مالی' })
  yearEndRollover(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryYearEndRolloverDto,
  ): Promise<YearEndTaxRolloverView> {
    return this.yearEndService.assessRollover(this.tenantIdOf(request), query);
  }
}
