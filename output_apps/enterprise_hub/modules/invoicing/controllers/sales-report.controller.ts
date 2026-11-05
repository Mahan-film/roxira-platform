import { Controller, Get, HttpStatus, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { ReportExportService } from '../../accounting/services/report-export.service';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { SalesReportQueryDto } from '../dto/sales-report.dto';
import { SalesReportService } from '../services/sales-report.service';

/** Sales report of the JWT tenant: JSON, or an XLSX/PDF download with `format`. Read policy of invoicing. */
@ApiTags('Invoicing - گزارش فروش')
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/invoicing/reports/sales')
export class SalesReportController {
  constructor(
    private readonly sales: SalesReportService,
    private readonly exporter: ReportExportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'گزارش فروش به تفکیک کالا یا مشتری (JSON، یا فایل با format)' })
  @ApiResponse({ status: HttpStatus.OK })
  async report(
    @Req() request: AuthenticatedRequest,
    @Query() query: SalesReportQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const { json, table } = await this.sales.build(requireTenantId(request), query);
    if (!query.format) {
      return json;
    }
    return this.exporter.download(await this.exporter.render(table, query.format, `sales-by-${query.groupBy}`), response);
  }
}
