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
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import {
  requireTenantAdmin,
  requireTenantId,
} from '../../tenants/tenant-context';
import { CreateStockItemDto } from '../dto/create-stock-item.dto';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { FifoBatchResponseDto } from '../dto/fifo-batch-response.dto';
import { FifoValuationResponseDto } from '../dto/inventory-valuation.dto';
import { QueryStockItemDto } from '../dto/query-stock-item.dto';
import { StockItemResponseDto } from '../dto/stock-item-response.dto';
import {
  InboundStockDto,
  OutboundStockDto,
} from '../dto/stock-movement.dto';
import { StockMovementResultDto } from '../dto/stock-movement-result.dto';
import { UpdateStockItemDto } from '../dto/update-stock-item.dto';
import { WarehouseResponseDto } from '../dto/warehouse-response.dto';
import { WarehouseStockResponseDto } from '../dto/warehouse-stock-response.dto';
import { InventoryService } from '../services/inventory.service';

/**
 * کنترلر انبارداری سازمانی چند‌انباره و قیمت‌گذاری FIFO.
 *
 * فقط مسیریابی، اعتبارسنجی DTO و تبدیل نوع پارامترها انجام می‌شود؛ هیچ منطق
 * کسب‌وکار یا دسترسی مستقیم به پایگاه‌داده در این لایه وجود ندارد
 * (Rule #3 - AGENTS.md).
 *
 * شناسه مستأجر «تنها» از claim تأییدشده JWT خوانده می‌شود (`requireTenantId`)
 * و دسترسی مدیریتی با `requireTenantAdmin` بررسی می‌شود؛ هرگز از بدنه/کوئری/هدر
 * درخواست (Rule #4 - AGENTS.md). احراز هویت از طریق گارد سراسری JwtAuthGuard
 * اعمال می‌شود.
 */
@ApiTags('Inventory - انبارداری و FIFO')
@ApiBearerAuth()
@Controller('enterprise-hub/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** استخراج شناسه مستأجر و بررسی دسترسی مدیریتی از کاربر تأییدشده. */
  private tenantIdOf(request: AuthenticatedRequest): string {
    requireTenantAdmin(request);
    return requireTenantId(request);
  }

  // ---------------------------------------------------------------------------
  // انبارها
  // ---------------------------------------------------------------------------

  @Post('warehouses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد انبار جدید' })
  @ApiResponse({ status: HttpStatus.CREATED, type: WarehouseResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'نام انبار تکراری است' })
  async createWarehouse(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    return this.inventoryService.createWarehouse(this.tenantIdOf(request), dto);
  }

  @Get('warehouses')
  @ApiOperation({ summary: 'فهرست انبارهای سازمانی' })
  @ApiResponse({ status: HttpStatus.OK, type: [WarehouseResponseDto] })
  async listWarehouses(
    @Req() request: AuthenticatedRequest,
  ): Promise<WarehouseResponseDto[]> {
    return this.inventoryService.listWarehouses(this.tenantIdOf(request));
  }

  @Get('warehouses/:id/stock')
  @ApiOperation({ summary: 'استعلام موجودی یک انبار به تفکیک کالا' })
  @ApiResponse({ status: HttpStatus.OK, type: WarehouseStockResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'انبار یافت نشد' })
  async getWarehouseStock(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WarehouseStockResponseDto> {
    return this.inventoryService.getWarehouseStock(
      this.tenantIdOf(request),
      id,
    );
  }

  // ---------------------------------------------------------------------------
  // کالاها
  // ---------------------------------------------------------------------------

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'افزودن کالای جدید به فهرست انبار' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockItemResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'شناسه کالا تکراری است' })
  async createStockItem(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateStockItemDto,
  ): Promise<StockItemResponseDto> {
    return this.inventoryService.createStockItem(this.tenantIdOf(request), dto);
  }

  @Get('items')
  @ApiOperation({ summary: 'فهرست کالاهای انبار همراه با هشدار کسری' })
  @ApiResponse({ status: HttpStatus.OK })
  async listStockItems(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryStockItemDto,
  ) {
    return this.inventoryService.listStockItems(this.tenantIdOf(request), query);
  }

  @Get('items/:id')
  @ApiOperation({ summary: 'دریافت یک کالا بر اساس شناسه' })
  @ApiResponse({ status: HttpStatus.OK, type: StockItemResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یافت نشد' })
  async getStockItem(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StockItemResponseDto> {
    return this.inventoryService.getStockItem(this.tenantIdOf(request), id);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'ویرایش کالای موجود (نام، بارکد، آستانه کسری)' })
  @ApiResponse({ status: HttpStatus.OK, type: StockItemResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یافت نشد' })
  async updateStockItem(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockItemDto,
  ): Promise<StockItemResponseDto> {
    return this.inventoryService.updateStockItem(
      this.tenantIdOf(request),
      id,
      dto,
    );
  }

  @Get('items/:sku/batches')
  @ApiOperation({ summary: 'لایه‌های FIFO باز یک کالا به‌ترتیب قدیمی‌ترین' })
  @ApiResponse({ status: HttpStatus.OK, type: [FifoBatchResponseDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یافت نشد' })
  async getStockItemBatches(
    @Req() request: AuthenticatedRequest,
    @Param('sku') sku: string,
  ): Promise<FifoBatchResponseDto[]> {
    return this.inventoryService.getStockItemBatches(
      this.tenantIdOf(request),
      sku,
    );
  }

  // ---------------------------------------------------------------------------
  // گردش کالا
  // ---------------------------------------------------------------------------

  @Post('movements/inbound')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ورود کالا به انبار و ایجاد لایه FIFO جدید',
    description:
      'افزایش موجودی کالا و ثبت دسته جدید با بهای خرید مشخص، به‌صورت اتمیک در یک Transaction.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockMovementResultDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یا انبار یافت نشد' })
  async receiveStock(
    @Req() request: AuthenticatedRequest,
    @Body() dto: InboundStockDto,
  ): Promise<StockMovementResultDto> {
    return this.inventoryService.receiveStock(this.tenantIdOf(request), dto);
  }

  @Post('movements/outbound')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'خروج کالا از انبار با قیمت‌گذاری FIFO',
    description:
      'مصرف قدیمی‌ترین دسته‌ها به‌ترتیب ورود و محاسبه بهای تمام‌شده، به‌صورت اتمیک در یک Transaction.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockMovementResultDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'موجودی کافی نیست' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یافت نشد' })
  async issueStock(
    @Req() request: AuthenticatedRequest,
    @Body() dto: OutboundStockDto,
  ): Promise<StockMovementResultDto> {
    return this.inventoryService.issueStock(this.tenantIdOf(request), dto);
  }

  // ---------------------------------------------------------------------------
  // گزارش ارزش موجودی
  // ---------------------------------------------------------------------------

  @Get('valuation')
  @ApiOperation({ summary: 'گزارش ارزش موجودی انبارها بر پایه FIFO' })
  @ApiResponse({ status: HttpStatus.OK, type: FifoValuationResponseDto })
  async getFifoValuation(
    @Req() request: AuthenticatedRequest,
  ): Promise<FifoValuationResponseDto> {
    return this.inventoryService.getFifoValuation(this.tenantIdOf(request));
  }
}
