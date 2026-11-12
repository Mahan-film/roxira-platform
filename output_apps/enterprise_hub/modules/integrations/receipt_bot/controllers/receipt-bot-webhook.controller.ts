import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  ValidationPipe,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../auth/decorators/public.decorator';
import { TelegramUpdateDto } from '../dto/receipt-bot.dto';
import { ReceiptBotService } from '../services/receipt-bot.service';

/**
 * Telegram/Bale send many fields we do not model (is_bot, language_code, entities, ...), and the
 * global pipe in main.ts uses forbidNonWhitelisted, which would 400 every real update. The body
 * parameter is typed `unknown` (metatype Object), so the global pipe skips it; this route-level
 * pipe validates against TelegramUpdateDto, strips unknown fields and does not reject them.
 */
export const TELEGRAM_UPDATE_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  expectedType: TelegramUpdateDto,
});

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
  @ApiBody({ type: TelegramUpdateDto })
  @ApiOperation({ summary: 'وب‌هوک دریافت رویدادها و تصاویر از ربات تلگرام یا بله' })
  async handleWebhook(
    @Body(TELEGRAM_UPDATE_PIPE) rawUpdate: unknown,
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

    const update = rawUpdate as TelegramUpdateDto;
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
