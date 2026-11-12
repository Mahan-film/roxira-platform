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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Request } from 'express';
import { Public } from '../../../auth/decorators/public.decorator';
import { WooCommerceOrderWebhookDto } from '../dto/woocommerce-order.dto';
import { WooCommerceSyncService } from '../services/woocommerce-sync.service';
import { verifyHmacSignature } from '../utils/woocommerce-crypto.util';

@ApiTags('Integrations - WooCommerce Webhook')
@Public()
@Controller('enterprise-hub/integrations/woocommerce')
export class WooCommerceWebhookController {
  constructor(private readonly syncService: WooCommerceSyncService) {}

  @Post('webhook/:tenantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'وب‌هوک دریافت سفارش‌ها و تغییرات از فروشگاه ووکامرس' })
  async handleWebhook(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Headers('x-wc-webhook-signature') signature: string | undefined,
    @Headers('x-wc-webhook-topic') topic: string | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing X-WC-Webhook-Signature header');
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new UnauthorizedException('Missing raw request body for HMAC verification');
    }

    const secret = await this.syncService.getWebhookSecret(tenantId);
    if (!secret) {
      throw new UnauthorizedException('WooCommerce integration not configured for tenant');
    }

    const isValid = verifyHmacSignature(rawBody, signature, secret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const normalizedTopic = (topic || '').trim().toLowerCase();
    const isOrderTopic = normalizedTopic
      ? normalizedTopic.startsWith('order.')
      : body?.id !== undefined && Array.isArray(body?.line_items);

    if (!isOrderTopic) {
      return { status: 'ignored', topic: normalizedTopic };
    }

    const dto = plainToInstance(WooCommerceOrderWebhookDto, body);
    const errors = await validate(dto, {
      whitelist: false,
      forbidNonWhitelisted: false,
    });
    if (errors.length > 0) {
      const messages = errors.flatMap((e) => Object.values(e.constraints || {}));
      throw new BadRequestException(
        messages.length > 0
          ? messages
          : 'Invalid WooCommerce order payload: id, total, and line_items array are required',
      );
    }

    const result = await this.syncService.importOrder(tenantId, dto);
    return {
      status: 'ok',
      ...result,
    };
  }
}
