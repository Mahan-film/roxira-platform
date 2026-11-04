import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  AllocateAdvanceDto,
  AllocationReportRowDto,
  CreateTreasuryDocumentDto,
  OpenInvoiceResponseDto,
  QueryAllocationsDto,
  QueryTreasuryDocumentsDto,
  SetToleranceDto,
  TreasuryDocumentDetailResponseDto,
  TreasuryDocumentResponseDto,
} from '../dto/treasury.dto';
import { TreasuryDocKind } from '../enums/treasury.enum';
import { TreasuryService } from '../services/treasury.service';

/**
 * Receipts and payments with invoice allocation. Gated by the banking module permissions (the
 * accountant role); the tenant comes only from the verified JWT claim.
 */
@ApiTags('Treasury - دریافت و پرداخت')
@ModuleAccess(AccessModule.BANKING)
@Controller('enterprise-hub/treasury')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Get('documents')
  @ApiOperation({ summary: 'فهرست اسناد دریافت و پرداخت' })
  @ApiResponse({ status: HttpStatus.OK, type: [TreasuryDocumentResponseDto] })
  list(@Req() request: AuthenticatedRequest, @Query() query: QueryTreasuryDocumentsDto): Promise<TreasuryDocumentResponseDto[]> {
    return this.treasuryService.listDocuments(requireTenantId(request), query);
  }

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'ثبت سند دریافت یا پرداخت با تخصیص به صورتحساب‌ها (سند حسابداری خودکار)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: TreasuryDocumentDetailResponseDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateTreasuryDocumentDto): Promise<TreasuryDocumentDetailResponseDto> {
    return this.treasuryService.createDocument(requireTenantId(request), dto);
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'جزئیات سند با روش‌های پرداخت و تخصیص‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: TreasuryDocumentDetailResponseDto })
  get(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<TreasuryDocumentDetailResponseDto> {
    return this.treasuryService.getDocument(requireTenantId(request), id);
  }

  @Post('documents/:id/allocations')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'تخصیص بعدی پیش‌دریافت/پیش‌پرداخت به صورتحساب‌ها' })
  @ApiResponse({ status: HttpStatus.CREATED, type: TreasuryDocumentDetailResponseDto })
  allocate(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AllocateAdvanceDto,
  ): Promise<TreasuryDocumentDetailResponseDto> {
    return this.treasuryService.allocateAdvance(requireTenantId(request), id, dto);
  }

  @Get('open-invoices')
  @ApiOperation({ summary: 'مانده قابل تخصیص صورتحساب‌های انتخابی (ردیف‌های جدول تخصیص)' })
  @ApiResponse({ status: HttpStatus.OK, type: [OpenInvoiceResponseDto] })
  openInvoices(
    @Req() request: AuthenticatedRequest,
    @Query('kind', new ParseEnumPipe(TreasuryDocKind)) kind: TreasuryDocKind,
    @Query('ids') ids: string,
  ): Promise<OpenInvoiceResponseDto[]> {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    return this.treasuryService.openInvoices(requireTenantId(request), kind, list);
  }

  @Get('allocations')
  @ApiOperation({ summary: 'تخصیص‌های واقعی دریافت/پرداخت به صورتحساب‌ها (برای سنی بدهی و صورت‌حساب طرف‌حساب)' })
  @ApiResponse({ status: HttpStatus.OK, type: [AllocationReportRowDto] })
  allocations(@Req() request: AuthenticatedRequest, @Query() query: QueryAllocationsDto): Promise<AllocationReportRowDto[]> {
    return this.treasuryService.listAllocations(requireTenantId(request), query);
  }

  @Get('settings')
  @ApiOperation({ summary: 'تنظیمات خزانه (سقف تخفیف)' })
  settings(@Req() request: AuthenticatedRequest): Promise<{ writeoffTolerance: number | string }> {
    return this.treasuryService.getTolerance(requireTenantId(request));
  }

  @Put('settings')
  @RequireAction(AccessAction.ADMIN)
  @ApiOperation({ summary: 'تعیین سقف تخفیف هر صورتحساب' })
  setSettings(@Req() request: AuthenticatedRequest, @Body() dto: SetToleranceDto): Promise<{ writeoffTolerance: number | string }> {
    return this.treasuryService.setTolerance(requireTenantId(request), dto.writeoffTolerance);
  }
}
