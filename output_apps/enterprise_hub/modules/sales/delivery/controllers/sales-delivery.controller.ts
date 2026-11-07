import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../../access/catalogue';
import { AlsoAllowModule, ModuleAccess, RequireAction } from '../../../access/decorators';
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
import {
  CreateInvoiceFromDeliveryDto,
  InvoiceFromDeliveryResponseDto,
  OrderInvoicingResponseDto,
} from '../dto/sales-invoice-from-delivery.dto';
import { SalesDeliveryService } from '../services/sales-delivery.service';
import { SalesInvoiceFromDeliveryService } from '../services/sales-invoice-from-delivery.service';

/**
 * Delivery notes (حواله تحویل) of confirmed sales orders (#536 T1): partial delivery with FIFO
 * stock out, the SALES_DELIVERY stock document and the COGS voucher, all in one transaction; and
 * invoicing from delivered lines (#563 T1 slice 4), where the invoice books revenue and VAT only
 * because the delivery already posted the COGS. Gated by the INVOICING module like the rest of
 * the sales cycle; reads are also open through ACCOUNTING. The tenant comes only from the
 * verified JWT claim.
 */
@ApiTags('Sales - فروش')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/sales')
export class SalesDeliveryController {
  constructor(
    private readonly deliveries: SalesDeliveryService,
    private readonly invoicesFromDeliveries: SalesInvoiceFromDeliveryService,
  ) {}

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

  @RequireAction(AccessAction.CREATE)
  @Post('invoices/from-deliveries')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'صدور صورتحساب از سطرهای حواله‌های تحویل',
    description:
      'یک صورتحساب از سطرهای چند حوالهٔ یک مشتری، در یک تراکنش با قفل سطرهای حواله؛ درصدها و مالیات از پارامترهای قانونی همان تاریخ و بدون جابه‌جایی دوبارهٔ انبار یا بهای تمام‌شده (حواله قبلاً ثبت کرده است). تکرار با همان کلید ایدمپوتنسی همان صورتحساب را برمی‌گرداند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: InvoiceFromDeliveryResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'سطرهای حوالهٔ دو مشتری مختلف یا ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'مقدار بیش از باقی‌ماندهٔ قابل صورتحساب' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سطر حواله متعلق به سازمان دیگری است یا وجود ندارد' })
  createInvoiceFromDelivery(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateInvoiceFromDeliveryDto,
  ): Promise<InvoiceFromDeliveryResponseDto> {
    return this.invoicesFromDeliveries.createFromDeliveries(requireTenantId(request), dto);
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

  @Get('orders/:id/invoicing')
  @ApiOperation({ summary: 'وضعیت صورتحساب سفارش سطر‌به‌سطر (سفارش‌شده، تحویل‌شده، صورتحساب‌شده، باقی‌مانده)' })
  @ApiResponse({ status: HttpStatus.OK, type: OrderInvoicingResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  getOrderInvoicing(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrderInvoicingResponseDto> {
    return this.invoicesFromDeliveries.getOrderInvoicing(requireTenantId(request), id);
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
