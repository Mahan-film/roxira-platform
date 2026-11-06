import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { AlsoAllowModule, ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  ChangeSalesQuotationStatusDto,
  ConvertQuotationDto,
  CreateSalesOrderDto,
  CreateSalesQuotationDto,
  QuerySalesOrderDto,
  QuerySalesQuotationDto,
  SalesOrderListResponseDto,
  SalesOrderResponseDto,
  SalesQuotationListResponseDto,
  SalesQuotationResponseDto,
  UpdateSalesOrderDto,
  UpdateSalesQuotationDto,
} from '../dto/sales.dto';
import { SalesService } from '../services/sales.service';

/**
 * Sales cycle (چرخه فروش): quotations and sales orders. Gated by the INVOICING module; reads are
 * also open through ACCOUNTING, so an accountant with accounting:read can read the documents. The
 * tenant comes only from the verified JWT claim. No posting happens here: orders are documents,
 * and VAT is posted by the invoice.
 */
@ApiTags('Sales - فروش')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  // ------------------------------------------------------------------ quotations

  @Get('quotations')
  @ApiOperation({ summary: 'فهرست پیش‌فاکتورها' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesQuotationListResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  listQuotations(
    @Req() request: AuthenticatedRequest,
    @Query() query: QuerySalesQuotationDto,
  ): Promise<SalesQuotationListResponseDto> {
    return this.sales.listQuotations(requireTenantId(request), query);
  }

  @Get('quotations/:id')
  @ApiOperation({ summary: 'یک پیش‌فاکتور با خطوط' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesQuotationResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  getQuotation(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesQuotationResponseDto> {
    return this.sales.getQuotation(requireTenantId(request), id);
  }

  @Post('quotations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت پیش‌فاکتور (DRAFT) با کالاهای موجود' })
  @ApiResponse({ status: HttpStatus.CREATED, type: SalesQuotationResponseDto })
  createQuotation(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSalesQuotationDto,
  ): Promise<SalesQuotationResponseDto> {
    return this.sales.createQuotation(requireTenantId(request), dto, this.userIdOf(request));
  }

  @Put('quotations/:id')
  @ApiOperation({ summary: 'ویرایش پیش‌فاکتور فقط در حالت DRAFT (خطوط جایگزین می‌شوند)' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesQuotationResponseDto })
  updateQuotation(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSalesQuotationDto,
  ): Promise<SalesQuotationResponseDto> {
    return this.sales.updateQuotation(requireTenantId(request), id, dto);
  }

  @Post('quotations/:id/status')
  @ApiOperation({ summary: 'تغییر وضعیت پیش‌فاکتور (DRAFT→SENT→ACCEPTED/REJECTED)' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesQuotationResponseDto })
  changeQuotationStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeSalesQuotationStatusDto,
  ): Promise<SalesQuotationResponseDto> {
    return this.sales.changeQuotationStatus(requireTenantId(request), id, dto);
  }

  @Post('quotations/:id/convert')
  @ApiOperation({ summary: 'تبدیل پیش‌فاکتور (SENT/ACCEPTED) به سفارش فروش DRAFT' })
  @ApiResponse({ status: HttpStatus.CREATED, type: SalesOrderResponseDto })
  convertQuotation(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConvertQuotationDto,
  ): Promise<SalesOrderResponseDto> {
    return this.sales.convertQuotation(requireTenantId(request), id, dto, this.userIdOf(request));
  }

  // ------------------------------------------------------------------ orders

  @Get('orders')
  @ApiOperation({ summary: 'فهرست سفارش‌های فروش' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesOrderListResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  listOrders(
    @Req() request: AuthenticatedRequest,
    @Query() query: QuerySalesOrderDto,
  ): Promise<SalesOrderListResponseDto> {
    return this.sales.listOrders(requireTenantId(request), query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'یک سفارش فروش با خطوط' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesOrderResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  getOrder(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<SalesOrderResponseDto> {
    return this.sales.getOrder(requireTenantId(request), id);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت سفارش فروش مستقیم (DRAFT)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: SalesOrderResponseDto })
  createOrder(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSalesOrderDto,
  ): Promise<SalesOrderResponseDto> {
    return this.sales.createOrder(requireTenantId(request), dto, this.userIdOf(request));
  }

  @Put('orders/:id')
  @ApiOperation({ summary: 'ویرایش سفارش فروش فقط در حالت DRAFT (خطوط جایگزین می‌شوند)' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesOrderResponseDto })
  updateOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSalesOrderDto,
  ): Promise<SalesOrderResponseDto> {
    return this.sales.updateOrder(requireTenantId(request), id, dto);
  }

  @Post('orders/:id/confirm')
  @ApiOperation({ summary: 'تأیید سفارش فروش (DRAFT→CONFIRMED)' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesOrderResponseDto })
  confirmOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesOrderResponseDto> {
    return this.sales.confirmOrder(requireTenantId(request), id);
  }

  @Post('orders/:id/cancel')
  @ApiOperation({ summary: 'لغو سفارش (فقط وقتی هیچ خطی تحویل نشده)' })
  @ApiResponse({ status: HttpStatus.OK, type: SalesOrderResponseDto })
  cancelOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesOrderResponseDto> {
    return this.sales.cancelOrder(requireTenantId(request), id);
  }
}
