import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AccessRequest } from '../../access/access-context';
import { redactSensitiveFields } from '../../access/policy-evaluator';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import {
  requireTenantId,
} from '../../tenants/tenant-context';
import { ContractAllowanceDto, ReplaceAllowancesDto } from '../dto/contract-allowance.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import {
  ContractResponseDto,
  EmployeeResponseDto,
  HrStatsResponseDto,
  PaginatedEmployeeResponseDto,
  PaginatedPayslipResponseDto,
  PayrollCalculationResponseDto,
  PayslipResponseDto,
} from '../dto/hr-response.dto';
import {
  CalculatePayrollDto,
  IssuePayslipDto,
} from '../dto/payroll.dto';
import {
  CreatePayrollRunDto,
  InsuranceListQueryDto,
  InsuranceListResponseDto,
  PayrollRatesResponseDto,
  PayrollRunResponseDto,
  WageTaxFilesQueryDto,
  WageTaxFilesResponseDto,
  PayrollReconciliationResponseDto,
} from '../dto/payroll-run.dto';
import { QueryEmployeeDto, QueryPayslipDto } from '../dto/query-hr.dto';
import { PreviewSettlementDto, SettlementPreviewDto } from '../dto/settlement.dto';
import { UpdateEmployeeDto } from '../dto/update-employee.dto';
import {
  AttendanceResponseDto,
  QueryAttendanceDto,
  RecordAttendanceDto,
} from '../dto/attendance.dto';
import {
  CreateLeaveDto,
  LeaveResponseDto,
  QueryLeaveDto,
  ReviewLeaveDto,
} from '../dto/leave.dto';
import {
  CreateStaffLoanDto,
  QueryStaffLoanDto,
  StaffLoanResponseDto,
} from '../dto/staff-loan.dto';
import { HrService } from '../services/hr.service';
import { PayrollRunService } from '../services/payroll-run.service';

/**
 * کنترلر منابع انسانی و حقوق و دستمزد.
 * فقط مسیریابی و اعتبارسنجی HTTP؛ هیچ منطق کسب‌وکار یا دسترسی مستقیم به
 * پایگاه‌داده در این لایه وجود ندارد (Rule #3 — AGENTS.md).
 *
 * شناسه مستأجر «تنها» از claim تأییدشده JWT خوانده می‌شود (`requireTenantId`)
 * و دسترسی بر اساس نقش با AccessGuard بررسی می‌شود؛ هرگز از بدنه/کوئری/هدر
 * درخواست (Rule #4 - AGENTS.md). تمام فراخوانی‌های سرویس با همان شناسه مستأجر
 * انجام می‌شود تا سند خودکار حقوق نیز در دفتر همان سازمان ثبت گردد.
 */
/** Optional numeric id from a query string: empty -> undefined; Persian/Arabic digits accepted. */
export function parseOptionalId(raw?: string): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const ascii = String(raw)
    .trim()
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (ascii === '' || ascii === 'undefined' || ascii === 'null') {
    return undefined;
  }
  if (!/^\d+$/.test(ascii)) {
    throw new BadRequestException('شناسه کارمند باید عدد باشد.');
  }
  return Number(ascii);
}

@ApiTags('HR - منابع انسانی و حقوق و دستمزد')
@ModuleAccess(AccessModule.HR)
@Controller('enterprise-hub/hr')
export class HrController {
  constructor(
    private readonly hrService: HrService,
    private readonly payrollRunService: PayrollRunService,
  ) {}

  /** استخراج شناسه مستأجر و بررسی دسترسی مدیریتی از کاربر تأییدشده. */
  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  // ---------------------------------------------------------------------------
  // پرسنل
  // ---------------------------------------------------------------------------

  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت پرسنل جدید' })
  @ApiResponse({ status: HttpStatus.CREATED, type: EmployeeResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'کد ملی یا کد پرسنلی تکراری' })
  async createEmployee(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.hrService.createEmployee(this.tenantIdOf(request), dto);
  }

  @Get('employees')
  @ApiOperation({ summary: 'فهرست صفحه‌بندی‌شده پرسنل' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedEmployeeResponseDto })
  async listEmployees(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryEmployeeDto,
  ): Promise<PaginatedEmployeeResponseDto> {
    return this.hrService.listEmployees(this.tenantIdOf(request), query);
  }

  @Get('employees/:id')
  @ApiOperation({ summary: 'دریافت پرونده کارمند' })
  @ApiResponse({ status: HttpStatus.OK, type: EmployeeResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کارمند یافت نشد' })
  async getEmployee(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmployeeResponseDto> {
    return this.hrService.findOneEmployee(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.READ)
  @Post('employees/:id/settlement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پیش‌نمایش سنوات و تسویه مرخصی هنگام پایان خدمت (بدون ثبت)' })
  @ApiResponse({ status: HttpStatus.OK, type: SettlementPreviewDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'قرارداد فعال یا پارامتر قانونی تعریف نشده' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کارمند یافت نشد' })
  async previewSettlement(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PreviewSettlementDto,
  ): Promise<SettlementPreviewDto> {
    return this.hrService.previewSettlement(this.tenantIdOf(request), id, dto);
  }

  @Patch('employees/:id')
  @ApiOperation({ summary: 'ویرایش پرونده کارمند' })
  @ApiResponse({ status: HttpStatus.OK, type: EmployeeResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'کد ملی یا کد پرسنلی تکراری' })
  async updateEmployee(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.hrService.updateEmployee(this.tenantIdOf(request), id, dto);
  }

  // ---------------------------------------------------------------------------
  // احکام و قراردادهای حقوقی
  // ---------------------------------------------------------------------------

  @Post('contracts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تعریف قرارداد/حکم حقوقی جدید' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ContractResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کارمند یافت نشد' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'شماره قرارداد تکراری' })
  async createContract(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateContractDto,
  ): Promise<ContractResponseDto> {
    return this.hrService.createContract(this.tenantIdOf(request), dto);
  }

  @Get('contracts')
  @ApiOperation({ summary: 'فهرست قراردادهای حقوقی (اختیاری بر اساس کارمند)' })
  @ApiResponse({ status: HttpStatus.OK, type: [ContractResponseDto] })
  async listContracts(
    @Req() request: AuthenticatedRequest,
    @Query('employeeId') employeeIdRaw?: string,
  ): Promise<ContractResponseDto[]> {
    // ParseIntPipe({ optional: true }) is not honoured by our NestJS version: GET /hr/contracts without a
    // filter returned 400 "numeric string is expected" (owner-reported banner on /app/hr, reproduced 2026-10-22).
    return this.hrService.listContracts(
      this.tenantIdOf(request),
      parseOptionalId(employeeIdRaw),
    );
  }

  @Get('contracts/:id')
  @ApiOperation({ summary: 'دریافت یک قرارداد حقوقی' })
  @ApiResponse({ status: HttpStatus.OK, type: ContractResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'قرارداد یافت نشد' })
  async getContract(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContractResponseDto> {
    return this.hrService.findOneContract(this.tenantIdOf(request), id);
  }

  @Get('contracts/:id/allowances')
  @ApiOperation({ summary: 'مزایای قرارداد' })
  @ApiResponse({ status: HttpStatus.OK, type: [ContractAllowanceDto] })
  async listAllowances(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContractAllowanceDto[]> {
    return this.hrService.listAllowances(this.tenantIdOf(request), id);
  }

  @Put('contracts/:id/allowances')
  @ApiOperation({ summary: 'جایگزینی مزایای قرارداد' })
  @ApiResponse({ status: HttpStatus.OK, type: [ContractAllowanceDto] })
  async replaceAllowances(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplaceAllowancesDto,
  ): Promise<ContractAllowanceDto[]> {
    return this.hrService.replaceAllowances(this.tenantIdOf(request), id, dto);
  }

  // ---------------------------------------------------------------------------
  // محاسبه حقوق و فیش حقوقی
  // ---------------------------------------------------------------------------

  @Post('payroll/calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'پیش‌محاسبه حقوق (حقوق پایه، بن خواربار، حق مسکن، بیمه و مالیات)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PayrollCalculationResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  async calculatePayroll(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CalculatePayrollDto,
  ): Promise<PayrollCalculationResponseDto> {
    return this.hrService.calculatePayroll(this.tenantIdOf(request), dto);
  }

  @Post('payslips')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'صدور فیش حقوقی و ثبت خودکار سند هزینه حقوق در دفتر روزنامه',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: PayslipResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'فیش این دوره قبلاً صادر شده' })
  async issuePayslip(
    @Req() request: AuthenticatedRequest,
    @Body() dto: IssuePayslipDto,
  ): Promise<PayslipResponseDto> {
    return this.hrService.issuePayslip(this.tenantIdOf(request), dto);
  }

  @Get('payslips')
  @ApiOperation({ summary: 'فهرست صفحه‌بندی‌شده فیش‌های حقوقی' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedPayslipResponseDto })
  async listPayslips(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryPayslipDto,
  ): Promise<PaginatedPayslipResponseDto> {
    return this.hrService.listPayslips(this.tenantIdOf(request), query);
  }

  @Get('payslips/:id')
  @ApiOperation({ summary: 'دریافت یک فیش حقوقی' })
  @ApiResponse({ status: HttpStatus.OK, type: PayslipResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'فیش یافت نشد' })
  async getPayslip(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PayslipResponseDto> {
    return this.hrService.findOnePayslip(this.tenantIdOf(request), id);
  }

  // ---------------------------------------------------------------------------
  // اجرای ماهانه حقوق، سند حسابداری و لیست بیمه
  // ---------------------------------------------------------------------------

  @Get('payroll-rates/:year')
  @ApiOperation({ summary: 'نرخ‌ها و مبالغ قانونی حقوق یک سال شمسی' })
  @ApiResponse({ status: HttpStatus.OK, type: PayrollRatesResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'سال تعریف نشده' })
  async getPayrollRates(
    @Req() request: AuthenticatedRequest,
    @Param('year', ParseIntPipe) year: number,
  ): Promise<PayrollRatesResponseDto> {
    return this.payrollRunService.getRates(this.tenantIdOf(request), year);
  }

  @Post('payroll-runs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'محاسبه یا محاسبه مجدد حقوق ماه (پیش‌نویس) برای همه پرسنل فعال',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PayrollRunResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'حقوق این ماه قبلاً ثبت شده' })
  async createPayrollRun(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePayrollRunDto,
  ): Promise<PayrollRunResponseDto> {
    return this.payrollRunService.createOrRecalculate(
      this.tenantIdOf(request),
      dto,
    );
  }

  @Get('payroll-runs')
  @ApiOperation({ summary: 'فهرست اجراهای ماهانه حقوق' })
  @ApiResponse({ status: HttpStatus.OK, type: [PayrollRunResponseDto] })
  async listPayrollRuns(
    @Req() request: AuthenticatedRequest,
  ): Promise<PayrollRunResponseDto[]> {
    return this.payrollRunService.listRuns(this.tenantIdOf(request));
  }

  @Get('payroll-runs/:id')
  @ApiOperation({ summary: 'جزئیات اجرای حقوق و فیش‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: PayrollRunResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'یافت نشد' })
  async getPayrollRun(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PayrollRunResponseDto> {
    return this.payrollRunService.findRun(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.POST)
  @Post('payroll-runs/:id/post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت سند حسابداری تراز اجرای حقوق و قفل آن' })
  @ApiResponse({ status: HttpStatus.OK, type: PayrollRunResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'قبلاً ثبت شده' })
  async postPayrollRun(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PayrollRunResponseDto> {
    return this.payrollRunService.postRun(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('payroll-runs/:id/insurance-list')
  @ApiOperation({
    summary: 'لیست بیمه تأمین اجتماعی (DSKKAR00 و DSKWOR00، CSV و DBF)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: InsuranceListResponseDto })
  async getInsuranceList(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: InsuranceListQueryDto,
  ): Promise<InsuranceListResponseDto> {
    return this.payrollRunService.insuranceList(
      this.tenantIdOf(request),
      id,
      query,
    );
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('payroll-runs/:id/wage-tax-files')
  @ApiOperation({
    summary: 'برگه کاری WP و WH (قالب بارگذاری سامانه مالیات حقوق نیست)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: WageTaxFilesResponseDto })
  async getWageTaxFiles(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: WageTaxFilesQueryDto,
  ): Promise<WageTaxFilesResponseDto> {
    return this.payrollRunService.wageTaxFiles(
      this.tenantIdOf(request),
      id,
      query,
    );
  }

  @Get('payroll-runs/:id/reconciliation')
  @ApiOperation({
    summary: 'کنترل تطبیق جمع فیش‌ها، جمع اجرا و سند حسابداری حقوق',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PayrollReconciliationResponseDto })
  async getPayrollReconciliation(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PayrollReconciliationResponseDto> {
    return this.payrollRunService.reconciliation(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('payroll-runs/:id/payslips-pdf')
  @ApiOperation({ summary: 'فیش حقوقی فارسی همه کارکنان یک اجرا (PDF، هر نفر یک صفحه)' })
  async getPayslipsPdf(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    const file = await this.payrollRunService.payslipsPdf(this.tenantIdOf(request), id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.body);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('payroll-runs/:id/payslips/:payslipId/pdf')
  @ApiOperation({ summary: 'فیش حقوقی فارسی یک کارمند (PDF)' })
  async getPayslipPdf(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('payslipId', ParseIntPipe) payslipId: number,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    const file = await this.payrollRunService.payslipsPdf(this.tenantIdOf(request), id, payslipId);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.body);
  }

  // ---------------------------------------------------------------------------
  // آمار
  // ---------------------------------------------------------------------------

  @Get('stats')
  @ApiOperation({ summary: 'آمار تحلیلی پرسنل و هزینه حقوق و دستمزد' })
  @ApiResponse({ status: HttpStatus.OK, type: HrStatsResponseDto })
  async getStats(
    @Req() request: AuthenticatedRequest,
  ): Promise<HrStatsResponseDto> {
    const stats = await this.hrService.getStats(this.tenantIdOf(request));
    // Headcount stays visible; salary totals only for roles with salary visibility (#584-3).
    const access = (request as AccessRequest).access;
    if (!access) return stats;
    return redactSensitiveFields(stats as unknown as Record<string, unknown>, access, {
      totalBaseSalary: 'salary',
      totalGrossPay: 'salary',
      totalNetPay: 'salary',
      totalDeductions: 'salary',
      averageNetPay: 'salary',
    }) as unknown as HrStatsResponseDto;
  }

  // ---------------------------------------------------------------------------
  // کارکرد و حضور و غیاب
  // ---------------------------------------------------------------------------

  @RequireAction(AccessAction.CREATE)
  @Post('attendance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت یا به‌روزرسانی کارکرد و حضور و غیاب ماهانه کارمند' })
  @ApiResponse({ status: HttpStatus.OK, type: AttendanceResponseDto })
  async recordAttendance(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RecordAttendanceDto,
  ): Promise<AttendanceResponseDto> {
    return this.hrService.recordAttendance(this.tenantIdOf(request), dto);
  }

  @RequireAction(AccessAction.READ)
  @Get('attendance')
  @ApiOperation({ summary: 'فهرست کارکرد و حضور و غیاب پرسنل' })
  @ApiResponse({ status: HttpStatus.OK, type: [AttendanceResponseDto] })
  async listAttendance(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryAttendanceDto,
  ): Promise<AttendanceResponseDto[]> {
    return this.hrService.listAttendances(this.tenantIdOf(request), query);
  }

  // ---------------------------------------------------------------------------
  // مرخصی‌ها
  // ---------------------------------------------------------------------------

  @RequireAction(AccessAction.CREATE)
  @Post('leaves')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت درخواست مرخصی' })
  @ApiResponse({ status: HttpStatus.CREATED, type: LeaveResponseDto })
  async requestLeave(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateLeaveDto,
  ): Promise<LeaveResponseDto> {
    return this.hrService.requestLeave(this.tenantIdOf(request), dto);
  }

  @RequireAction(AccessAction.APPROVE)
  @Patch('leaves/:id/review')
  @ApiOperation({ summary: 'بررسی و تأیید یا رد مرخصی' })
  @ApiResponse({ status: HttpStatus.OK, type: LeaveResponseDto })
  async reviewLeave(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewLeaveDto,
  ): Promise<LeaveResponseDto> {
    const reviewer = request.user?.sub ?? request.user?.phone;
    if (!reviewer) {
      throw new UnauthorizedException('شناسه کاربر تاییدکننده معتبر نیست.');
    }
    return this.hrService.reviewLeave(this.tenantIdOf(request), id, dto, reviewer);
  }

  @RequireAction(AccessAction.READ)
  @Get('leaves')
  @ApiOperation({ summary: 'فهرست مرخصی‌های ثبت‌شده' })
  @ApiResponse({ status: HttpStatus.OK, type: [LeaveResponseDto] })
  async listLeaves(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryLeaveDto,
  ): Promise<LeaveResponseDto[]> {
    return this.hrService.listLeaves(this.tenantIdOf(request), query);
  }

  // ---------------------------------------------------------------------------
  // وام‌های پرسنلی
  // ---------------------------------------------------------------------------

  @RequireAction(AccessAction.CREATE)
  @Post('loans')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تعریف وام یا مساعده پرسنلی' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StaffLoanResponseDto })
  async createStaffLoan(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateStaffLoanDto,
  ): Promise<StaffLoanResponseDto> {
    return this.hrService.createStaffLoan(this.tenantIdOf(request), dto);
  }

  @RequireAction(AccessAction.READ)
  @Get('loans')
  @ApiOperation({ summary: 'فهرست وام‌های پرسنلی' })
  @ApiResponse({ status: HttpStatus.OK, type: [StaffLoanResponseDto] })
  async listStaffLoans(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryStaffLoanDto,
  ): Promise<StaffLoanResponseDto[]> {
    return this.hrService.listStaffLoans(this.tenantIdOf(request), query);
  }
}