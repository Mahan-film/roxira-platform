import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { QueryLedgerExportDto } from '../dto/query-ledger-export.dto';
import { QuerySeasonalReportDto } from '../dto/query-seasonal-report.dto';
import { LedgerExportService } from '../reports/ledger-export.service';

/**
 * خروجی CSV دفتر روزنامه و دفتر کل برای فصل شمسی. قالب ستون‌ها تأییدنشده (unverified) است و
 * قالب رسمی سازمان امور مالیاتی نیست: docs/tax/LEDGER_EXPORT_LAYOUT.md.
 */
@ApiTags('Tax Compliance - دفتر روزنامه و دفتر کل')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/reports')
export class LedgerExportController {
  constructor(private readonly exports: LedgerExportService) {}

  @RequireAction(AccessAction.EXPORT)
  @Get('journal.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', 'unverified')
  @ApiOperation({ summary: 'خروجی CSV دفتر روزنامه (قالب unverified)' })
  journal(@Req() request: AuthenticatedRequest, @Query() query: QuerySeasonalReportDto): Promise<string> {
    return this.exports.journalCsv(requireTenantId(request), query.year, query.quarter);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('ledger.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Layout-Status', 'unverified')
  @ApiOperation({ summary: 'خروجی CSV دفتر کل با مانده جاری (قالب unverified)' })
  ledger(@Req() request: AuthenticatedRequest, @Query() query: QueryLedgerExportDto): Promise<string> {
    return this.exports.ledgerCsv(requireTenantId(request), query.year, query.quarter, query.accountCode);
  }
}
