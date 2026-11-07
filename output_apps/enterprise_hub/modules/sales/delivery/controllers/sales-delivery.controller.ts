import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../../access/catalogue';
import { AlsoAllowModule, ModuleAccess } from '../../../access/decorators';
import { AuthenticatedRequest } from '../../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../../tenants/tenant-context';
import {
  BackorderListResponseDto,
  CreateSalesDeliveryDto,
  OrderFulfilmentResponseDto,
  QueryBackordersDto,
  QuerySalesDeliveryDto,
  SalesDeliveryListResponseDto,
  SalesDeliveryResponseDto,
} from '../dto/sales-delivery.dto';
import { SalesDeliveryService } from '../services/sales-delivery.service';

/**
 * Delivery notes (حواله تحویل) of confirmed sales orders (#536 T1): partial delivery with FIFO
 * stock out, the SALES_DELIVERY stock document and the COGS voucher, all in one transaction.
 * Gated by the INVOICING module like the rest of the sales cycle; reads are also open through
 * ACCOUNTING. The tenant comes only from the verified JWT claim.
 */
@ApiTags('Sales - فروش')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/sales')
export class SalesDeliveryController {
  constructor(private readonly deliveries: SalesDeliveryService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @Post('orders/:id/deliveries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت حواله تحویل (کسر FIFO انبار + سند انبار + سند بهای تمام‌شده)' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesDeliveryResponseDto })
  createDelivery(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSalesDeliveryDto,
  ): Promise<SalesDeliveryResponseDto> {
    return this.deliveries.createDelivery(requireTenantId(request), id, dto, this.userIdOf(request));
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'فهرست حواله‌های تحویل' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesDeliveryListResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  listDeliveries(
    @Req() request: AuthenticatedRequest,
    @Query() query: QuerySalesDeliveryDto,
  ): Promise<SalesDeliveryListResponseDto> {
    return this.deliveries.listDeliveries(requireTenantId(request), query);
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'یک حواله تحویل با خطوط' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesDeliveryResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  getDelivery(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesDeliveryResponseDto> {
    return this.deliveries.getDelivery(requireTenantId(request), id);
  }

  @Get('orders/:id/fulfilment')
  @ApiOperation({ summary: 'وضعیت تحویل سفارش سطر‌به‌سطر (سفارش‌شده، تحویل‌شده، بازمانده)' })
  @ApiResponse({ status: HttpStatus.OK, type: OrderFulfilmentResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  getFulfilment(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrderFulfilmentResponseDto> {
    return this.deliveries.getFulfilment(requireTenantId(request), id);
  }

  @Get('backorders')
  @ApiOperation({ summary: 'خطوط باز سفارش‌های تأییدشده با مقدار بازمانده' })
  @ApiResponse({ status: HttpStatus.OK, type: BackorderListResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  listBackorders(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryBackordersDto,
  ): Promise<BackorderListResponseDto> {
    return this.deliveries.listBackorders(requireTenantId(request), query);
  }
}
