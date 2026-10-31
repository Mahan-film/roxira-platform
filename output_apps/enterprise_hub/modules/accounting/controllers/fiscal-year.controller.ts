import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  ApplyChartTemplateResponseDto,
  ChartTemplateResponseDto,
  CloseFiscalYearDto,
  CloseResultDto,
  CreateFiscalYearDto,
  FiscalYearResponseDto,
  ReopenFiscalYearDto,
} from '../dto/fiscal-year.dto';
import { ChartTemplateService } from '../services/chart-template.service';
import { FiscalYearService } from '../services/fiscal-year.service';

/** Chart templates and fiscal years of the JWT tenant. Routing and validation only. */
@ApiTags('Accounting - سرفصل و سال مالی')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting')
export class FiscalYearController {
  constructor(
    private readonly fiscalYears: FiscalYearService,
    private readonly templates: ChartTemplateService,
  ) {}

  private actorOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @Get('chart-templates')
  @ApiOperation({ summary: 'قالب‌های سرفصل استاندارد ایران' })
  @ApiResponse({ status: HttpStatus.OK, type: [ChartTemplateResponseDto] })
  listTemplates(): ChartTemplateResponseDto[] {
    return this.templates.list();
  }

  @Post('chart-templates/:key/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'افزودن قالب سرفصل به حساب‌های شرکت' })
  @ApiResponse({ status: HttpStatus.OK, type: ApplyChartTemplateResponseDto })
  applyTemplate(
    @Req() request: AuthenticatedRequest,
    @Param('key') key: string,
  ): Promise<ApplyChartTemplateResponseDto> {
    return this.templates.apply(requireTenantId(request), key);
  }

  @Get('fiscal-years')
  @ApiOperation({ summary: 'فهرست سال‌های مالی' })
  @ApiResponse({ status: HttpStatus.OK, type: [FiscalYearResponseDto] })
  list(@Req() request: AuthenticatedRequest): Promise<FiscalYearResponseDto[]> {
    return this.fiscalYears.list(requireTenantId(request));
  }

  @Post('fiscal-years')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تعریف سال مالی' })
  @ApiResponse({ status: HttpStatus.CREATED, type: FiscalYearResponseDto })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.fiscalYears.create(requireTenantId(request), dto);
  }

  @RequireAction(AccessAction.APPROVE)
  @Post('fiscal-years/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بستن سال مالی: اسناد اختتامیه و افتتاحیه سال بعد' })
  @ApiResponse({ status: HttpStatus.OK, type: CloseResultDto })
  close(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseFiscalYearDto,
  ): Promise<CloseResultDto> {
    return this.fiscalYears.close(requireTenantId(request), this.actorOf(request), id, dto);
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('fiscal-years/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بازگشایی سال مالی با برگشت اسناد بستن' })
  @ApiResponse({ status: HttpStatus.OK, type: FiscalYearResponseDto })
  reopen(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReopenFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.fiscalYears.reopen(requireTenantId(request), this.actorOf(request), id, dto);
  }
}
