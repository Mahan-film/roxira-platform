import { Controller, Get, HttpStatus, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { ReportExportService } from '../../accounting/services/report-export.service';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { PurchasesReportQueryDto } from '../dto/purchases-report.dto';
import { PurchasesReportService } from '../services/purchases-report.service';

/** Purchases report of the JWT tenant: JSON, or an XLSX/PDF download with `format`. Read policy of invoicing. */
@ApiTags('Invoicing - گزارش خرید')
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/invoicing/reports/purchases')
export class PurchasesReportController {
  constructor(
    private readonly purchases: PurchasesReportService,
    private readonly exporter: ReportExportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'گزارش خرید به تفکیک کالا یا تأمین‌کننده (JSON، یا فایل با format)' })
  @ApiResponse({ status: HttpStatus.OK })
  async report(
    @Req() request: AuthenticatedRequest,
    @Query() query: PurchasesReportQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const { json, table } = await this.purchases.build(requireTenantId(request), query);
    if (!query.format) {
      return json;
    }
    return this.exporter.download(await this.exporter.render(table, query.format, `purchases-by-${query.groupBy}`), response);
  }
}