import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { Public } from '../../auth/decorators/public.decorator';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  ConfigurePaymentGatewayDto,
  PaymentGatewayConfigResponseDto,
} from '../dto/configure-payment-gateway.dto';
import {
  CreatePaymentLinkDto,
  PaymentCallbackQueryDto,
  PaymentCallbackResultDto,
  PaymentLinkResponseDto,
} from '../dto/payment-link-response.dto';
import { InvoicePaymentLinkService } from '../services/invoice-payment-link.service';

@ApiTags('Invoicing - پرداخت آنلاین صورتحساب')
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/invoicing')
export class InvoicePaymentLinkController {
  constructor(private readonly paymentLinkService: InvoicePaymentLinkService) {}

  private tenantIdOf(req: AuthenticatedRequest): string {
    return requireTenantId(req);
  }

  @Post('payment-gateway/config')
  @ApiBearerAuth()
  @RequireAction(AccessAction.APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پیکربندی کلید درگاه پرداخت مستأجر (رمزگذاری‌شده در مبدأ)' })
  @ApiResponse({ status: 200, type: PaymentGatewayConfigResponseDto })
  async configureGateway(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfigurePaymentGatewayDto,
  ): Promise<PaymentGatewayConfigResponseDto> {
    const tenantId = this.tenantIdOf(req);
    return this.paymentLinkService.configureGateway(tenantId, dto);
  }

  @Get('payment-gateway/config')
  @ApiBearerAuth()
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'استعلام تنظیمات درگاه پرداخت (کلید ماسک‌شده بدون افشای سکرت)' })
  @ApiResponse({ status: 200, type: PaymentGatewayConfigResponseDto })
  async getGatewayConfig(
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentGatewayConfigResponseDto> {
    const tenantId = this.tenantIdOf(req);
    return this.paymentLinkService.getGatewayConfig(tenantId);
  }

  @Post('invoices/:id/payment-link')
  @ApiBearerAuth()
  @RequireAction(AccessAction.CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد و ارسال لینک پرداخت آنلاین برای فاکتور فروش صادرشده' })
  @ApiResponse({ status: 201, type: PaymentLinkResponseDto })
  async createPaymentLink(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) invoiceId: string,
    @Body() dto: CreatePaymentLinkDto,
  ): Promise<PaymentLinkResponseDto> {
    const tenantId = this.tenantIdOf(req);
    const host = req.get ? req.get('host') : undefined;
    const protocol = req.protocol || 'http';
    const baseUrl = host ? `${protocol}://${host}` : undefined;
    return this.paymentLinkService.createPaymentLink(tenantId, invoiceId, dto, baseUrl);
  }

  @Get('payment-links/callback')
  @Public()
  @ApiOperation({ summary: 'کال‌بک بازگشت کاربر از درگاه پرداخت به سامانه' })
  @ApiResponse({ status: 200, type: PaymentCallbackResultDto })
  async callbackGet(
    @Query() query: PaymentCallbackQueryDto,
  ): Promise<PaymentCallbackResultDto> {
    return this.paymentLinkService.handleCallback(query);
  }

  @Post('payment-links/callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'وبهوک و کال‌بک سرور-به-سرور درگاه پرداخت' })
  @ApiResponse({ status: 200, type: PaymentCallbackResultDto })
  async callbackPost(
    @Body() body: PaymentCallbackQueryDto,
  ): Promise<PaymentCallbackResultDto> {
    return this.paymentLinkService.handleCallback(body);
  }
}
