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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
 */
@ApiTags('Inventory - انبارداری و FIFO')
@Controller('enterprise-hub/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ---------------------------------------------------------------------------
  // انبارها
  // ---------------------------------------------------------------------------

  @Post('warehouses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد انبار جدید' })
  @ApiResponse({ status: HttpStatus.CREATED, type: WarehouseResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'نام انبار تکراری است' })
  async createWarehouse(
    @Body() dto: CreateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    return this.inventoryService.createWarehouse(dto);
  }

  @Get('warehouses')
  @ApiOperation({ summary: 'فهرست انبارهای سازمانی' })
  @ApiResponse({ status: HttpStatus.OK, type: [WarehouseResponseDto] })
  async listWarehouses(): Promise<WarehouseResponseDto[]> {
    return this.inventoryService.listWarehouses();
  }

  @Get('warehouses/:id/stock')
  @ApiOperation({ summary: 'استعلام موجودی یک انبار به تفکیک کالا' })
  @ApiResponse({ status: HttpStatus.OK, type: WarehouseStockResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'انبار یافت نشد' })
  async getWarehouseStock(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WarehouseStockResponseDto> {
    return this.inventoryService.getWarehouseStock(id);
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
    @Body() dto: CreateStockItemDto,
  ): Promise<StockItemResponseDto> {
    return this.inventoryService.createStockItem(dto);
  }

  @Get('items')
  @ApiOperation({ summary: 'فهرست کالاهای انبار همراه با هشدار کسری' })
  @ApiResponse({ status: HttpStatus.OK })
  async listStockItems(@Query() query: QueryStockItemDto) {
    return this.inventoryService.listStockItems(query);
  }

  @Get('items/:id')
  @ApiOperation({ summary: 'دریافت یک کالا بر اساس شناسه' })
  @ApiResponse({ status: HttpStatus.OK, type: StockItemResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یافت نشد' })
  async getStockItem(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StockItemResponseDto> {
    return this.inventoryService.getStockItem(id);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'ویرایش کالای موجود (نام، بارکد، آستانه کسری)' })
  @ApiResponse({ status: HttpStatus.OK, type: StockItemResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یافت نشد' })
  async updateStockItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockItemDto,
  ): Promise<StockItemResponseDto> {
    return this.inventoryService.updateStockItem(id, dto);
  }

  @Get('items/:sku/batches')
  @ApiOperation({ summary: 'لایه‌های FIFO باز یک کالا به‌ترتیب قدیمی‌ترین' })
  @ApiResponse({ status: HttpStatus.OK, type: [FifoBatchResponseDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'کالا یافت نشد' })
  async getStockItemBatches(
    @Param('sku') sku: string,
  ): Promise<FifoBatchResponseDto[]> {
    return this.inventoryService.getStockItemBatches(sku);
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
    @Body() dto: InboundStockDto,
  ): Promise<StockMovementResultDto> {
    return this.inventoryService.receiveStock(dto);
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
    @Body() dto: OutboundStockDto,
  ): Promise<StockMovementResultDto> {
    return this.inventoryService.issueStock(dto);
  }

  // ---------------------------------------------------------------------------
  // گزارش ارزش موجودی
  // ---------------------------------------------------------------------------

  @Get('valuation')
  @ApiOperation({ summary: 'گزارش ارزش موجودی انبارها بر پایه FIFO' })
  @ApiResponse({ status: HttpStatus.OK, type: FifoValuationResponseDto })
  async getFifoValuation(): Promise<FifoValuationResponseDto> {
    return this.inventoryService.getFifoValuation();
  }
}
