import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../auth/decorators/public.decorator';
import { TelegramUpdateDto } from '../dto/receipt-bot.dto';
import { ReceiptBotService } from '../services/receipt-bot.service';

@ApiTags('Integrations - وب‌هوک بات دریافت رسید')
@Controller('api/integrations/receipt-bot')
export class ReceiptBotWebhookController {
  private readonly logger = new Logger(ReceiptBotWebhookController.name);
  private warnedMissingSecret = false;

  constructor(
    private readonly service: ReceiptBotService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'وب‌هوک دریافت رویدادها و تصاویر از ربات تلگرام یا بله' })
  async handleWebhook(
    @Body() update: TelegramUpdateDto,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ): Promise<{ ok: boolean; status?: string; message?: string }> {
    const expectedSecret =
      this.config.get<string>('RECEIPT_BOT_WEBHOOK_SECRET') ??
      process.env.RECEIPT_BOT_WEBHOOK_SECRET;

    // Fail closed: without a configured secret nobody can be authenticated.
    if (!expectedSecret) {
      if (!this.warnedMissingSecret) {
        this.warnedMissingSecret = true;
        this.logger.error('RECEIPT_BOT_WEBHOOK_SECRET is not set; rejecting all receipt-bot webhook calls');
      }
      throw new ServiceUnavailableException('وب‌هوک بات دریافت رسید پیکربندی نشده است.');
    }
    if (!secretMatches(secretHeader, expectedSecret)) {
      throw new UnauthorizedException('کلید امنیتی وب‌هوک نامعتبر است.');
    }

    const outcome = await this.service.handleTelegramUpdate(update);
    return { ok: true, status: outcome.status, message: outcome.message };
  }
}

/** Constant-time comparison; unequal lengths are rejected without leaking via timing of the compare. */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
