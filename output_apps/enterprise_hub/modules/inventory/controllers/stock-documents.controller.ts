import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  CreateAdjustmentDto,
  CreateDeliveryDto,
  CreateReceiptDto,
  CreateTransferDto,
  QueryStockDocumentDto,
  StockDocumentResponseDto,
} from '../dto/stock-document.dto';
import { StockDocumentsService } from '../services/stock-documents.service';

/** Stock documents (transfers now; receipts, deliveries and adjustments share the same register). */
@ApiTags('Inventory - اسناد انبار')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/documents')
export class StockDocumentsController {
  constructor(private readonly documents: StockDocumentsService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @Get()
  @ApiOperation({ summary: 'فهرست اسناد انبار' })
  list(@Req() request: AuthenticatedRequest, @Query() query: QueryStockDocumentDto) {
    return this.documents.list(requireTenantId(request), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'یک سند انبار با خطوط' })
  @ApiResponse({ status: HttpStatus.OK, type: StockDocumentResponseDto })
  get(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<StockDocumentResponseDto> {
    return this.documents.get(requireTenantId(request), id);
  }

  @RequireAction(AccessAction.POST)
  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'انتقال کالا بین دو انبار',
    description: 'لایه‌های FIFO با همان بها و تاریخ به انبار مقصد منتقل می‌شوند؛ کل سند اتمیک است.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockDocumentResponseDto })
  createTransfer(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateTransferDto,
  ): Promise<StockDocumentResponseDto> {
    return this.documents.createTransfer(requireTenantId(request), this.userIdOf(request), dto);
  }

  @Post('receipts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'رسید خرید کالا به انبار',
    description: 'برای هر سطر یک لایهٔ FIFO تازه با بهای واحدِ اعلام‌شده ساخته می‌شود؛ سند حسابداری ندارد.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockDocumentResponseDto })
  createReceipt(@Req() request: AuthenticatedRequest, @Body() dto: CreateReceiptDto): Promise<StockDocumentResponseDto> {
    return this.documents.createReceipt(requireTenantId(request), this.userIdOf(request), dto);
  }

  @Post('deliveries')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'حوالهٔ خروج فروش از انبار (بهای FIFO)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockDocumentResponseDto })
  createDelivery(@Req() request: AuthenticatedRequest, @Body() dto: CreateDeliveryDto): Promise<StockDocumentResponseDto> {
    return this.documents.createDelivery(requireTenantId(request), this.userIdOf(request), dto);
  }

  @RequireAction(AccessAction.POST)
  @Post('adjustments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تعدیل موجودی (انبارگردانی)',
    description: 'مقدار مثبت لایهٔ جدید می‌سازد، مقدار منفی با بهای FIFO کسر می‌شود و یک سند حسابداری ثبت می‌شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockDocumentResponseDto })
  createAdjustment(@Req() request: AuthenticatedRequest, @Body() dto: CreateAdjustmentDto): Promise<StockDocumentResponseDto> {
    return this.documents.createAdjustment(requireTenantId(request), this.userIdOf(request), dto);
  }
}
