import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../../auth/decorators/public.decorator';
import { WooCommerceOrderWebhookDto } from '../dto/woocommerce-order.dto';
import { WooCommerceSyncService } from '../services/woocommerce-sync.service';
import { verifyHmacSignature } from '../utils/woocommerce-crypto.util';

@ApiTags('Integrations - WooCommerce Webhook')
@Public()
@Controller('api/integrations/woocommerce')
export class WooCommerceWebhookController {
  constructor(private readonly syncService: WooCommerceSyncService) {}

  @Post('webhook/:tenantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'وب‌هوک دریافت سفارش‌ها و تغییرات از فروشگاه ووکامرس' })
  async handleWebhook(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Headers('x-wc-webhook-signature') signature: string | undefined,
    @Headers('x-wc-webhook-topic') topic: string | undefined,
    @Body() body: any,
    @Req() req: Request,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing X-WC-Webhook-Signature header');
    }

    const secret = await this.syncService.getWebhookSecret(tenantId);
    if (!secret) {
      throw new UnauthorizedException('WooCommerce integration not configured for tenant');
    }

    // Verify HMAC signature
    const rawPayload = (req as any).rawBody || (typeof body === 'string' ? body : JSON.stringify(body));
    const isValid = verifyHmacSignature(rawPayload, signature, secret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Handle order event
    const normalizedTopic = (topic || '').toLowerCase();
    if (
      normalizedTopic.includes('order') ||
      body?.id !== undefined ||
      body?.line_items !== undefined
    ) {
      const orderDto = body as WooCommerceOrderWebhookDto;
      if (!orderDto.id || !orderDto.total) {
        throw new BadRequestException('Invalid WooCommerce order payload');
      }

      const result = await this.syncService.importOrder(tenantId, orderDto);
      return {
        status: 'ok',
        ...result,
      };
    }

    return { status: 'ignored', topic: normalizedTopic };
  }
}
