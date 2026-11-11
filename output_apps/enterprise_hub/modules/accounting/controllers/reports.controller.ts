import { BadRequestException, Body, Controller, Get, HttpStatus, Param, Put, Query, Req, Res, StreamableFile, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  CostCentreTrialBalanceQueryDto,
  EXPORTABLE_REPORTS,
  ExportableReport,
  ExportReportQueryDto,
  LedgerQueryDto,
  ReportPeriodDto,
  SubsidiaryQueryDto,
  TrialBalanceQueryDto,
} from '../dto/report.dto';
import { BudgetVsActualQueryDto, SetAccountBudgetDto } from '../dto/budget-report.dto';
import { ConsolidatedReportQueryDto } from '../dto/consolidated-report.dto';
import { CostCentreReportService } from '../services/cost-centre-report.service';
import { FinancialReportsService, moneyJson } from '../services/financial-reports.service';
import { ReportExportService } from '../services/report-export.service';
import { BudgetVsActualService } from '../services/budget-vs-actual.service';
import { ConsolidatedReportService } from '../services/consolidated-report.service';

/** Accounting reports of the JWT tenant. Amounts follow the ledger's exact JSON money rule. */
@ApiTags('Accounting - گزارش‌ها و صورت‌های مالی')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting/reports')
export class ReportsController {
  constructor(
    private readonly reports: FinancialReportsService,
    private readonly exporter: ReportExportService,
    private readonly costCentres: CostCentreReportService,
    private readonly budgetService: BudgetVsActualService,
    private readonly consolidatedService: ConsolidatedReportService,
  ) {}

  @Get('trial-balance')
  @ApiOperation({ summary: 'تراز آزمایشی ۲، ۴، ۶، ۸ و ۱۰ ستونی' })
  @ApiResponse({ status: HttpStatus.OK })
  async trialBalance(@Req() request: AuthenticatedRequest, @Query() query: TrialBalanceQueryDto) {
    return moneyJson(await this.reports.trialBalance(requireTenantId(request), query));
  }

  @Get('trial-balance-by-cost-centre')
  @ApiOperation({ summary: 'تراز آزمایشی به تفکیک مرکز هزینه' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'مرکز هزینه یافت نشد' })
  async trialBalanceByCostCentre(@Req() request: AuthenticatedRequest, @Query() query: CostCentreTrialBalanceQueryDto) {
    return moneyJson(await this.costCentres.trialBalance(requireTenantId(request), query));
  }

  @Get('subsidiary')
  @ApiOperation({ summary: 'تراز تفصیلی به تفکیک طرف حساب' })
  @ApiResponse({ status: HttpStatus.OK })
  async subsidiary(@Req() request: AuthenticatedRequest, @Query() query: SubsidiaryQueryDto) {
    return moneyJson(await this.reports.subsidiary(requireTenantId(request), query));
  }

  @Get('ledger')
  @ApiOperation({ summary: 'دفتر کل، معین و تفصیلی یک حساب' })
  @ApiResponse({ status: HttpStatus.OK })
  async ledger(@Req() request: AuthenticatedRequest, @Query() query: LedgerQueryDto) {
    return moneyJson(await this.reports.accountLedger(requireTenantId(request), query));
  }

  @Get('balance-sheet')
  @ApiOperation({ summary: 'صورت وضعیت مالی' })
  @ApiResponse({ status: HttpStatus.OK })
  async balanceSheet(@Req() request: AuthenticatedRequest, @Query() query: ReportPeriodDto) {
    return moneyJson(await this.reports.balanceSheet(requireTenantId(request), query));
  }

  @Get('income-statement')
  @ApiOperation({ summary: 'صورت سود و زیان' })
  @ApiResponse({ status: HttpStatus.OK })
  async incomeStatement(@Req() request: AuthenticatedRequest, @Query() query: ReportPeriodDto) {
    return moneyJson(await this.reports.incomeStatement(requireTenantId(request), query));
  }

  @Get('cash-flow')
  @ApiOperation({ summary: 'صورت جریان‌های نقدی' })
  @ApiResponse({ status: HttpStatus.OK })
  async cashFlow(@Req() request: AuthenticatedRequest, @Query() query: ReportPeriodDto) {
    return moneyJson(await this.reports.cashFlow(requireTenantId(request), query));
  }

  @Get('equity-changes')
  @ApiOperation({ summary: 'صورت تغییرات در حقوق مالکانه' })
  @ApiResponse({ status: HttpStatus.OK })
  async equityChanges(@Req() request: AuthenticatedRequest, @Query() query: ReportPeriodDto) {
    return moneyJson(await this.reports.equityChanges(requireTenantId(request), query));
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'داشبورد مدیریتی: نقد، بانک، مطالبات، بدهی، فروش، مالیات، موجودی' })
  @ApiResponse({ status: HttpStatus.OK })
  async dashboard(@Req() request: AuthenticatedRequest, @Query() query: ReportPeriodDto) {
    return moneyJson(await this.reports.dashboard(requireTenantId(request), query));
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('export/:report')
  @ApiOperation({ summary: 'خروجی Excel یا PDF هر گزارش' })
  @ApiResponse({ status: HttpStatus.OK, description: 'XLSX or PDF file' })
  async export(
    @Req() request: AuthenticatedRequest,
    @Param('report') report: string,
    @Query() query: ExportReportQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    if (!EXPORTABLE_REPORTS.includes(report as ExportableReport)) {
      throw new BadRequestException(`گزارش ${report} خروجی ندارد.`);
    }
    const file = await this.exporter.export(requireTenantId(request), report as ExportableReport, query);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.body);
  }

  @Get('budget-vs-actual')
  @ApiOperation({ summary: 'گزارش بودجه در برابر عملکرد' })
  @ApiResponse({ status: HttpStatus.OK })
  async budgetVsActual(
    @Req() request: AuthenticatedRequest,
    @Query() query: BudgetVsActualQueryDto,
  ) {
    return moneyJson(await this.budgetService.getBudgetVsActual(requireTenantId(request), query));
  }

  @Put('budgets')
  @RequireAction(AccessAction.ADMIN)
  @ApiOperation({ summary: 'ثبت و تنظیم سقف بودجه حساب' })
  @ApiResponse({ status: HttpStatus.OK })
  async setBudget(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SetAccountBudgetDto,
  ) {
    return this.budgetService.setBudget(requireTenantId(request), dto);
  }

  @Get('consolidated')
  @ApiOperation({ summary: 'گزارش تجمیعی چند شرکت (هلدینگ)' })
  @ApiResponse({ status: HttpStatus.OK })
  async consolidated(
    @Req() request: AuthenticatedRequest,
    @Query() query: ConsolidatedReportQueryDto,
  ) {
    const userId = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('کاربر احراز هویت نشده است.');
    }
    return moneyJson(await this.consolidatedService.getConsolidatedReport(userId, query));
  }
}
