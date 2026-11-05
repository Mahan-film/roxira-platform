import { Controller, Get, HttpStatus, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { ReportExportService } from '../../accounting/services/report-export.service';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { GrossProfitReportQueryDto } from '../dto/gross-profit-report.dto';
import { GrossProfitReportService } from '../services/gross-profit-report.service';

/** Gross profit report of the JWT tenant: JSON, or an XLSX/PDF download with `format`. Read policy of invoicing. */
@ApiTags('Invoicing - گزارش سود ناخالص')
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/invoicing/reports/gross-profit')
export class GrossProfitReportController {
  constructor(
    private readonly profit: GrossProfitReportService,
    private readonly exporter: ReportExportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'گزارش سود ناخالص به تفکیک فاکتور، کالا یا مشتری (JSON، یا فایل با format)' })
  @ApiResponse({ status: HttpStatus.OK })
  async report(
    @Req() request: AuthenticatedRequest,
    @Query() query: GrossProfitReportQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const { json, table } = await this.profit.build(requireTenantId(request), query);
    if (!query.format) {
      return json;
    }
    return this.exporter.download(await this.exporter.render(table, query.format, `gross-profit-by-${query.groupBy}`), response);
  }
}