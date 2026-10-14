import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import {
  requireTenantAdmin,
  requireTenantId,
} from '../../tenants/tenant-context';
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
import { QueryEmployeeDto, QueryPayslipDto } from '../dto/query-hr.dto';
import { UpdateEmployeeDto } from '../dto/update-employee.dto';
import { HrService } from '../services/hr.service';

/**
 * کنترلر منابع انسانی و حقوق و دستمزد.
 * فقط مسیریابی و اعتبارسنجی HTTP؛ هیچ منطق کسب‌وکار یا دسترسی مستقیم به
 * پایگاه‌داده در این لایه وجود ندارد (Rule #3 — AGENTS.md).
 *
 * شناسه مستأجر «تنها» از claim تأییدشده JWT خوانده می‌شود (`requireTenantId`)
 * و دسترسی مدیریتی با `requireTenantAdmin` بررسی می‌شود؛ هرگز از بدنه/کوئری/هدر
 * درخواست (Rule #4 - AGENTS.md). تمام فراخوانی‌های سرویس با همان شناسه مستأجر
 * انجام می‌شود تا سند خودکار حقوق نیز در دفتر همان سازمان ثبت گردد.
 */
@ApiTags('HR - منابع انسانی و حقوق و دستمزد')
@Controller('enterprise-hub/hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  /** استخراج شناسه مستأجر و بررسی دسترسی مدیریتی از کاربر تأییدشده. */
  private tenantIdOf(request: AuthenticatedRequest): string {
    requireTenantAdmin(request);
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
    @Query('employeeId', new ParseIntPipe({ optional: true }))
    employeeId?: number,
  ): Promise<ContractResponseDto[]> {
    return this.hrService.listContracts(this.tenantIdOf(request), employeeId);
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

  // ---------------------------------------------------------------------------
  // محاسبه حقوق و فیش حقوقی
  // ---------------------------------------------------------------------------

  @Post('payroll/calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'پیش‌محاسبه حقوق (حقوق پایه، بن خواربار، حق مسکن، بیمه ۷٪ و مالیات)',
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
  // آمار
  // ---------------------------------------------------------------------------

  @Get('stats')
  @ApiOperation({ summary: 'آمار تحلیلی پرسنل و هزینه حقوق و دستمزد' })
  @ApiResponse({ status: HttpStatus.OK, type: HrStatsResponseDto })
  async getStats(
    @Req() request: AuthenticatedRequest,
  ): Promise<HrStatsResponseDto> {
    return this.hrService.getStats(this.tenantIdOf(request));
  }
}