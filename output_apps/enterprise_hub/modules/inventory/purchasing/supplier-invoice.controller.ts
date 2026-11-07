import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  AcceptSupplierInvoiceDto,
  CreateSupplierInvoiceDto,
  SupplierInvoiceResponseDto,
} from './supplier-invoice.dto';
import { SupplierInvoiceService } from './supplier-invoice.service';

/** Supplier invoices linked to receipts, with the 3-way match, review and posting. */
@ApiTags('Inventory - صورتحساب خرید')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVENTORY)
@Controller('enterprise-hub/inventory/purchasing')
export class SupplierInvoiceController {
  constructor(private readonly invoices: SupplierInvoiceService) {}

  private userIdOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @RequireAction(AccessAction.CREATE)
  @Post('orders/:orderId/invoices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ثبت صورتحساب خرید برای رسیدهای یک سفارش',
    description:
      'تطبیق سه‌طرفه با تحمل قیمت؛ در صورت اختلاف صورتحساب HELD می‌شود و هنوز سندی ثبت نمی‌شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: SupplierInvoiceResponseDto })
  createInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateSupplierInvoiceDto,
  ): Promise<SupplierInvoiceResponseDto> {
    return this.invoices.createInvoice(
      requireTenantId(request),
      this.userIdOf(request),
      orderId,
      dto,
    );
  }

  @Get('invoices')
  @ApiOperation({ summary: 'فهرست صورتحساب‌های خرید' })
  @ApiResponse({ status: HttpStatus.OK, type: [SupplierInvoiceResponseDto] })
  listInvoices(@Req() request: AuthenticatedRequest): Promise<SupplierInvoiceResponseDto[]> {
    return this.invoices.listInvoices(requireTenantId(request));
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'یک صورتحساب خرید با سطرهای تطبیق' })
  @ApiResponse({ status: HttpStatus.OK, type: SupplierInvoiceResponseDto })
  getInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierInvoiceResponseDto> {
    return this.invoices.getInvoice(requireTenantId(request), id);
  }

  @RequireAction(AccessAction.APPROVE)
  @Post('invoices/:id/accept')
  @ApiOperation({
    summary: 'پذیرش اختلاف صورتحساب معلق (HELD → MATCHED)',
    description: 'تأییدکننده باید با ثبت‌کننده متفاوت باشد؛ مبالغ تغییر نمی‌کنند.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: SupplierInvoiceResponseDto })
  acceptInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptSupplierInvoiceDto,
  ): Promise<SupplierInvoiceResponseDto> {
    return this.invoices.acceptInvoice(
      requireTenantId(request),
      this.userIdOf(request),
      id,
      dto,
    );
  }

  @RequireAction(AccessAction.POST)
  @Post('invoices/:id/post')
  @ApiOperation({
    summary: 'ثبت سند حسابداری صورتحساب تطبیق‌شده',
    description: 'سند GRNI / تفاوت بهای خرید / مالیات خرید / حساب پرداختنی؛ ثبت دوباره همان سند را برمی‌گرداند.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: SupplierInvoiceResponseDto })
  postInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierInvoiceResponseDto> {
    return this.invoices.postInvoice(requireTenantId(request), id);
  }
}