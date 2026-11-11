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
import { QueryElectronicBooksDto } from '../dto/query-electronic-books.dto';
import { QueryLedgerExportDto } from '../dto/query-ledger-export.dto';
import { QuerySeasonalReportDto } from '../dto/query-seasonal-report.dto';
import { LedgerExportService } from '../reports/ledger-export.service';

/**
 * خروجی‌های دفتر روزنامه، دفتر کل، و سامانه دفاتر تجاری الکترونیکی سازمان امور مالیاتی.
 * خروجی الکترونیکی دفاتر مطابق با قالب رسمی docs/tax/official/electronic-books-template.xlsx
 * با برچسب X-Layout-Status: official ارائه می‌شود.
 */
@ApiTags('Tax Compliance - دفاتر تجاری و دفاتر قانونی')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/reports')
export class LedgerExportController {
  constructor(private readonly exports: LedgerExportService) {}

  @RequireAction(AccessAction.EXPORT)
  @Get('electronic-books.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', 'official')
  @ApiOperation({ summary: 'خروجی اکسل (XLSX) رسمی سامانه دفاتر تجاری الکترونیکی (قالب رسمی سازمان امور مالیاتی)' })
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
  @Header('X-Layout-Status', 'official')
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
  @Header('X-Layout-Status', 'official')
  @ApiOperation({ summary: 'خروجی CSV (با BOM) رسمی سامانه دفاتر تجاری الکترونیکی (قالب رسمی سازمان امور مالیاتی)' })
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
  @Header('X-Layout-Status', 'official')
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
