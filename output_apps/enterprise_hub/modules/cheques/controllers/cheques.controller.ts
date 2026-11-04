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
  ChequeDetailResponseDto,
  ChequeResponseDto,
  CreateChequeDto,
  DueChequesResponseDto,
  PartialPaymentDto,
  QueryChequesDto,
  QueryDueChequesDto,
  TransitionChequeDto,
  VerifySayadDto,
} from '../dto/cheque.dto';
import { ChequesService } from '../services/cheques.service';

/**
 * Cheque register. Routing and validation only; the tenant comes solely from the
 * verified JWT claim (`requireTenantId`) and never from body, query or headers.
 */
@ApiTags('Cheques - چک دریافتی و پرداختی')
@ModuleAccess(AccessModule.CHEQUES)
@Controller('enterprise-hub/cheques')
export class ChequesController {
  constructor(private readonly chequesService: ChequesService) {}

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
