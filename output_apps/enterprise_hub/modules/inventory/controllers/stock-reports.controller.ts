import { Controller, Get, HttpStatus, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReportExportService } from '../../accounting/services/report-export.service';
import { AccessModule } from '../../access/catalogue';
import { AlsoAllowModule, ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CardexQueryDto, StockBalanceQueryDto } from '../dto/stock-report.dto';
import { StockReportService } from '../services/stock-report.service';

/** Stock reports of the JWT tenant: JSON, or an XLSX/PDF download with `format`. Read policy of inventory. */
@ApiTags('Inventory - گزارش انبار')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/reports')
export class StockReportsController {
  constructor(
    private readonly reports: StockReportService,
    private readonly exporter: ReportExportService,
  ) {}

  @Get('cardex')
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  @ApiOperation({ summary: 'کاردکس یک کالا (JSON، یا فایل با format)' })
  @ApiResponse({ status: HttpStatus.OK })
  async cardex(
    @Req() request: AuthenticatedRequest,
    @Query() query: CardexQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const { json, table } = await this.reports.cardexReport(requireTenantId(request), query);
    if (!query.format) {
      return json;
    }
    return this.exporter.download(await this.exporter.render(table, query.format, `cardex-${query.sku}`), response);
  }

  @Get('stock-balance')
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  @ApiOperation({ summary: 'موجودی کالا یا کالاهای زیر نقطه سفارش (JSON، یا فایل با format)' })
  @ApiResponse({ status: HttpStatus.OK })
  async stockBalance(
    @Req() request: AuthenticatedRequest,
    @Query() query: StockBalanceQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const { json, table } = await this.reports.stockBalanceReport(requireTenantId(request), query);
    if (!query.format) {
      return json;
    }
    const name = query.view === 'reorder' ? 'reorder-alerts' : 'stock-balance';
    return this.exporter.download(await this.exporter.render(table, query.format, name), response);
  }
}
