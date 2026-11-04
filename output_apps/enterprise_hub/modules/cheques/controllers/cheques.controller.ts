import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  BouncedChequesResponseDto,
  ChequeDetailResponseDto,
  ChequeReconApplyDto,
  ChequeReconApplyResponseDto,
  ChequeReconItemDto,
  ChequeReconMatchDto,
  ChequeReconResponseDto,
  ChequeResponseDto,
  CreateChequeDto,
  DueChequesResponseDto,
  PartialPaymentDto,
  QueryBouncedChequesDto,
  QueryChequeReconDto,
  QueryChequesDto,
  QueryDueChequesDto,
  TransitionChequeDto,
  VerifySayadDto,
} from '../dto/cheque.dto';
import { ChequeReconService } from '../services/cheque-recon.service';
import { ChequesService } from '../services/cheques.service';

/**
 * Cheque register. Routing and validation only; the tenant comes solely from the
 * verified JWT claim (`requireTenantId`) and never from body, query or headers.
 */
@ApiTags('Cheques - چک دریافتی و پرداختی')
@ModuleAccess(AccessModule.CHEQUES)
@Controller('enterprise-hub/cheques')
export class ChequesController {
  constructor(
    private readonly chequesService: ChequesService,
    private readonly reconService: ChequeReconService,
  ) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  private actorOf(request: AuthenticatedRequest): string {
    return request.user?.sub ?? 'unknown';
  }

  @Get()
  @ApiOperation({ summary: 'فهرست چک‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: [ChequeResponseDto] })
  list(@Req() request: AuthenticatedRequest, @Query() query: QueryChequesDto): Promise<ChequeResponseDto[]> {
    return this.chequesService.list(this.tenantIdOf(request), query);
  }

  // Declared before `:id` so "due" is not parsed as an id.
  @Get('due')
  @ApiOperation({ summary: 'چک‌های سررسید نزدیک و معوق' })
  @ApiResponse({ status: HttpStatus.OK, type: DueChequesResponseDto })
  due(@Req() request: AuthenticatedRequest, @Query() query: QueryDueChequesDto): Promise<DueChequesResponseDto> {
    return this.chequesService.listDue(this.tenantIdOf(request), query);
  }

  @Get('bounced')
  @ApiOperation({ summary: 'چک‌های برگشتی با سن‌بندی (۰-۳۰، ۳۱-۶۰، ۶۱-۹۰، بیش از ۹۰ روز)' })
  @ApiResponse({ status: HttpStatus.OK, type: BouncedChequesResponseDto })
  bounced(@Req() request: AuthenticatedRequest, @Query() query: QueryBouncedChequesDto): Promise<BouncedChequesResponseDto> {
    return this.chequesService.bouncedReport(this.tenantIdOf(request), query);
  }

  // Reads bank statement and book lines: needs the banking module's permission, not only cheques.
  @ModuleAccess(AccessModule.BANKING)
  @Get('reconciliation')
  @ApiOperation({ summary: 'وصول‌های چک و سطرهای صورتحساب بانک مطابق (پیشنهاد تطبیق)' })
  @ApiResponse({ status: HttpStatus.OK, type: ChequeReconResponseDto })
  reconciliation(@Req() request: AuthenticatedRequest, @Query() query: QueryChequeReconDto): Promise<ChequeReconResponseDto> {
    return this.reconService.suggest(this.tenantIdOf(request), query);
  }

  @ModuleAccess(AccessModule.BANKING)
  @RequireAction(AccessAction.POST)
  @Post('reconciliation/match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأیید تطبیق یک وصول چک با یک سطر صورتحساب' })
  @ApiResponse({ status: HttpStatus.OK, type: ChequeReconItemDto })
  reconMatch(@Req() request: AuthenticatedRequest, @Body() dto: ChequeReconMatchDto): Promise<ChequeReconItemDto> {
    return this.reconService.match(this.tenantIdOf(request), dto);
  }

  @ModuleAccess(AccessModule.BANKING)
  @RequireAction(AccessAction.POST)
  @Post('reconciliation/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اعمال همهٔ پیشنهادهای بی‌ابهام (یک وصول ↔ یک سطر)' })
  @ApiResponse({ status: HttpStatus.OK, type: ChequeReconApplyResponseDto })
  reconApply(@Req() request: AuthenticatedRequest, @Body() dto: ChequeReconApplyDto): Promise<ChequeReconApplyResponseDto> {
    return this.reconService.applyUnambiguous(this.tenantIdOf(request), dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت چک دریافتی یا صادرشده (با سند حسابداری)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ChequeResponseDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateChequeDto): Promise<ChequeResponseDto> {
    return this.chequesService.create(this.tenantIdOf(request), dto, this.actorOf(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'جزئیات چک و تاریخچه وضعیت' })
  @ApiResponse({ status: HttpStatus.OK, type: ChequeDetailResponseDto })
  get(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<ChequeDetailResponseDto> {
    return this.chequesService.get(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.POST)
  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تغییر وضعیت چک؛ سند حسابداری همان وضعیت ثبت می‌شود' })
  @ApiResponse({ status: HttpStatus.OK, type: ChequeDetailResponseDto })
  transition(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionChequeDto,
  ): Promise<ChequeDetailResponseDto> {
    return this.chequesService.transition(this.tenantIdOf(request), id, dto);
  }

  @RequireAction(AccessAction.POST)
  @Post(':id/partial-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پرداخت بخشی از وجه چک؛ سند وصول/پرداخت همان مبلغ ثبت می‌شود' })
  @ApiResponse({ status: HttpStatus.OK, type: ChequeDetailResponseDto })
  partialPayment(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PartialPaymentDto,
  ): Promise<ChequeDetailResponseDto> {
    return this.chequesService.partialPayment(this.tenantIdOf(request), id, dto);
  }

  @RequireAction(AccessAction.POST)
  @Post(':id/sayad-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت دستی تأیید صیاد (کاربر و زمان ذخیره می‌شود؛ بدون فراخوانی صیاد)' })
  @ApiResponse({ status: HttpStatus.OK, type: ChequeDetailResponseDto })
  verifySayad(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifySayadDto,
  ): Promise<ChequeDetailResponseDto> {
    return this.chequesService.verifySayad(this.tenantIdOf(request), id, this.actorOf(request), dto);
  }
}
