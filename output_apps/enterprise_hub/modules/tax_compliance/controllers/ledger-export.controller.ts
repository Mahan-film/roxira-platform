import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { QueryElectronicBooksDto, QueryElectronicBooksPresetsDto } from '../dto/query-electronic-books.dto';
import { QueryLedgerExportDto } from '../dto/query-ledger-export.dto';
import { QuerySeasonalReportDto } from '../dto/query-seasonal-report.dto';
import { ELECTRONIC_BOOKS_LAYOUT_STATUS } from '../reports/electronic-books.constants';
import { ElectronicBooksPresetsResponse, LedgerExportService } from '../reports/ledger-export.service';

/**
 * خروجی‌های دفتر روزنامه، دفتر کل، و سامانه دفاتر تجاری الکترونیکی سازمان امور مالیاتی.
 * ساختار ستون‌های خروجی با docs/tax/official/electronic-books-template.xlsx منطبق است و
 * برچسب X-Layout-Status تا زمان تأیید بارگذاری واقعی روی درگاه، unverified برگردانده می‌شود.
 */
@ApiTags('Tax Compliance - دفاتر تجاری و دفاتر قانونی')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/reports')
export class LedgerExportController {
  constructor(private readonly exports: LedgerExportService) {}

  @RequireAction(AccessAction.READ)
  @Get('electronic-books/presets')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', ELECTRONIC_BOOKS_LAYOUT_STATUS)
  @ApiOperation({ summary: 'فهرست دوره‌های پیش‌فرض و تاریخچه آخرین خروجی دفاتر تجاری الکترونیکی' })
  electronicBooksPresets(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryElectronicBooksPresetsDto,
  ): Promise<ElectronicBooksPresetsResponse> {
    return this.exports.getElectronicBooksPresets(requireTenantId(request), query.year);
  }

  @RequireAction(AccessAction.READ)
  @Get('electronic-books/preview')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', ELECTRONIC_BOOKS_LAYOUT_STATUS)
  @ApiOperation({ summary: 'پیش‌نمایش خلاصه، قالب پیشنهادی، هشدارهای تکرار و تفاوت گرد کردن دفاتر تجاری' })
  async electronicBooksPreview(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryElectronicBooksDto,
  ) {
    const meta = await this.exports.getTurnoverData(requireTenantId(request), query);
    return {
      headers: [...meta.headers],
      rowCount: meta.rows.length,
      recommendedFormat: meta.rows.length > 1000 ? 'csv' : 'xlsx',
      unit: meta.unit,
      voucherScope: meta.voucherScope,
      monthlyAggregate: meta.monthlyAggregate,
      roundingDifference: meta.roundingDifference.toString(),
      alreadyExported: meta.alreadyExported,
      lastExportedEndDate: meta.lastExportedEndDate,
      warnings: meta.warnings,
      bounds: meta.bounds,
      sampleRows: meta.rows.slice(0, 20),
    };
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('electronic-books')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', ELECTRONIC_BOOKS_LAYOUT_STATUS)
  @ApiOperation({ summary: 'خروجی خودکار دفاتر تجاری (XLSX تا ۱٬۰۰۰ ردیف، CSV برای بیشتر از ۱٬۰۰۰ ردیف)' })
  async electronicBooksAuto(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryElectronicBooksDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile | string> {
    const file = await this.exports.electronicBooksAuto(requireTenantId(request), query);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('X-Electronic-Books-Format', file.format);
    response.setHeader('X-Electronic-Books-Unit', file.meta.unit);
    response.setHeader('X-Electronic-Books-Already-Exported', String(file.meta.alreadyExported));
    response.setHeader('X-Electronic-Books-Rounding-Diff', file.meta.roundingDifference.toString());
    return typeof file.data === 'string' ? file.data : new StreamableFile(file.data);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('electronic-books.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', ELECTRONIC_BOOKS_LAYOUT_STATUS)
  @ApiOperation({ summary: 'خروجی اکسل (XLSX) رسمی سامانه دفاتر تجاری الکترونیکی' })
  async electronicBooksXlsx(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryElectronicBooksDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    const tenantId = requireTenantId(request);
    const buffer = await this.exports.electronicBooksXlsx(tenantId, query);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="electronic-books-${query.year}.xlsx"`,
    );
    return new StreamableFile(buffer);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('commercial-books.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', ELECTRONIC_BOOKS_LAYOUT_STATUS)
  @ApiOperation({ summary: 'خروجی اکسل (XLSX) رسمی سامانه دفاتر تجاری الکترونیکی (نام مستعار)' })
  commercialBooksXlsx(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryElectronicBooksDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    return this.electronicBooksXlsx(request, query, response);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('electronic-books.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', ELECTRONIC_BOOKS_LAYOUT_STATUS)
  @ApiOperation({ summary: 'خروجی CSV (با BOM) رسمی سامانه دفاتر تجاری الکترونیکی' })
  async electronicBooksCsv(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryElectronicBooksDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<string> {
    const tenantId = requireTenantId(request);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="electronic-books-${query.year}.csv"`,
    );
    return this.exports.electronicBooksCsv(tenantId, query);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('commercial-books.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', ELECTRONIC_BOOKS_LAYOUT_STATUS)
  @ApiOperation({ summary: 'خروجی CSV (با BOM) رسمی سامانه دفاتر تجاری الکترونیکی (نام مستعار)' })
  commercialBooksCsv(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryElectronicBooksDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<string> {
    return this.electronicBooksCsv(request, query, response);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('journal.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', 'unverified')
  @ApiOperation({ summary: 'خروجی CSV دفتر روزنامه (قالب داخلی)' })
  journal(@Req() request: AuthenticatedRequest, @Query() query: QuerySeasonalReportDto): Promise<string> {
    return this.exports.journalCsv(requireTenantId(request), query.year, query.quarter);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('ledger.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', 'unverified')
  @ApiOperation({ summary: 'خروجی CSV دفتر کل با مانده جاری (قالب داخلی)' })
  ledger(@Req() request: AuthenticatedRequest, @Query() query: QueryLedgerExportDto): Promise<string> {
    return this.exports.ledgerCsv(requireTenantId(request), query.year, query.quarter, query.accountCode);
  }
}
