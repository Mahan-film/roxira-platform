import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  ConvertPurchaseRequestDto,
  CreateGoodsReceiptDto,
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  GoodsReceiptResponseDto,
  PurchaseOrderResponseDto,
  PurchaseRequestResponseDto,
  PurchaseSettingsResponseDto,
  QueryPurchaseOrdersDto,
  QueryPurchaseReceiptsDto,
  UpdatePurchaseSettingsDto,
} from './purchase.dto';
import { PurchaseCycleService } from './purchase-cycle.service';

/** Purchase cycle: requests, orders, goods receipts and the tenant tolerances. */
@ApiTags('Inventory - چرخه خرید')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/purchasing')
export class PurchaseController {
  constructor(private readonly purchases: PurchaseCycleService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  // ---------------------------------------------------------------- requests

  @Get('requests')
  @ApiOperation({ summary: 'فهرست درخواست‌های خرید' })
  listRequests(@Req() request: AuthenticatedRequest): Promise<PurchaseRequestResponseDto[]> {
    return this.purchases.listRequests(requireTenantId(request));
  }

  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت درخواست خرید (OPEN)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PurchaseRequestResponseDto })
  createRequest(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePurchaseRequestDto,
  ): Promise<PurchaseRequestResponseDto> {
    return this.purchases.createRequest(requireTenantId(request), this.userIdOf(request), dto);
  }

  @Post('requests/:id/convert')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تبدیل درخواست به سفارش پیش‌نویس',
    description: 'برای هر SKU باید قیمت واحد ارسال شود؛ درخواست ORDERED می‌شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: PurchaseOrderResponseDto })
  convertRequest(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertPurchaseRequestDto,
  ): Promise<PurchaseOrderResponseDto> {
    return this.purchases.convertRequest(requireTenantId(request), this.userIdOf(request), id, dto);
  }

  @Post('requests/:id/cancel')
  @ApiOperation({ summary: 'لغو درخواست خرید باز' })
  @ApiResponse({ status: HttpStatus.OK, type: PurchaseRequestResponseDto })
  cancelRequest(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseRequestResponseDto> {
    return this.purchases.cancelRequest(requireTenantId(request), this.userIdOf(request), id);
  }

  // ------------------------------------------------------------------ orders

  @Get('orders')
  @ApiOperation({ summary: 'فهرست سفارش‌های خرید' })
  listOrders(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryPurchaseOrdersDto,
  ): Promise<PurchaseOrderResponseDto[]> {
    return this.purchases.listOrders(requireTenantId(request), query.status);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت سفارش خرید (DRAFT)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PurchaseOrderResponseDto })
  createOrder(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderResponseDto> {
    return this.purchases.createOrder(requireTenantId(request), this.userIdOf(request), dto);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'یک سفارش خرید با خطوط' })
  @ApiResponse({ status: HttpStatus.OK, type: PurchaseOrderResponseDto })
  getOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrderResponseDto> {
    return this.purchases.getOrder(requireTenantId(request), id);
  }

  @RequireAction(AccessAction.APPROVE)
  @Post('orders/:id/approve')
  @ApiOperation({ summary: 'تأیید سفارش خرید (DRAFT → APPROVED)' })
  @ApiResponse({ status: HttpStatus.OK, type: PurchaseOrderResponseDto })
  approveOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrderResponseDto> {
    return this.purchases.approveOrder(requireTenantId(request), this.userIdOf(request), id);
  }

  @Post('orders/:id/cancel')
  @ApiOperation({ summary: 'لغو سفارش پیش از هر رسید' })
  @ApiResponse({ status: HttpStatus.OK, type: PurchaseOrderResponseDto })
  cancelOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrderResponseDto> {
    return this.purchases.cancelOrder(requireTenantId(request), this.userIdOf(request), id);
  }

  @Post('orders/:id/close')
  @ApiOperation({ summary: 'بستن سفارش نیمه‌دریافت‌شده (PARTIALLY_RECEIVED → CLOSED)' })
  @ApiResponse({ status: HttpStatus.OK, type: PurchaseOrderResponseDto })
  closeOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrderResponseDto> {
    return this.purchases.closeOrder(requireTenantId(request), this.userIdOf(request), id);
  }

  @RequireAction(AccessAction.POST)
  @Post('orders/:id/receipts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'رسید کالا برای یک سفارش تأییدشده',
    description: 'موجودی FIFO و سند INVENTORY/GRNI در یک تراکنش ثبت می‌شوند؛ کلید تکرار همان رسید را برمی‌گرداند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: GoodsReceiptResponseDto })
  createReceipt(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGoodsReceiptDto,
  ): Promise<GoodsReceiptResponseDto> {
    return this.purchases.createReceipt(requireTenantId(request), this.userIdOf(request), id, dto);
  }

  // ---------------------------------------------------------------- receipts

  @Get('receipts')
  @ApiOperation({ summary: 'فهرست رسیدهای کالا (اختیاری برای یک سفارش)' })
  listReceipts(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryPurchaseReceiptsDto,
  ): Promise<GoodsReceiptResponseDto[]> {
    return this.purchases.listReceipts(requireTenantId(request), query.orderId);
  }

  @Get('receipts/:id')
  @ApiOperation({ summary: 'یک رسید کالا با خطوط' })
  @ApiResponse({ status: HttpStatus.OK, type: GoodsReceiptResponseDto })
  getReceipt(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GoodsReceiptResponseDto> {
    return this.purchases.getReceipt(requireTenantId(request), id);
  }

  // ---------------------------------------------------------------- settings

  @Get('settings')
  @ApiOperation({ summary: 'تنظیمات تحمل چرخه خرید' })
  @ApiResponse({ status: HttpStatus.OK, type: PurchaseSettingsResponseDto })
  getSettings(@Req() request: AuthenticatedRequest): Promise<PurchaseSettingsResponseDto> {
    return this.purchases.getSettings(requireTenantId(request));
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('settings')
  @ApiOperation({ summary: 'به‌روزرسانی تنظیمات تحمل چرخه خرید' })
  @ApiResponse({ status: HttpStatus.OK, type: PurchaseSettingsResponseDto })
  updateSettings(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePurchaseSettingsDto,
  ): Promise<PurchaseSettingsResponseDto> {
    return this.purchases.updateSettings(requireTenantId(request), dto);
  }
}