import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../auth/decorators/public.decorator';
import { TelegramUpdateDto } from '../dto/receipt-bot.dto';
import { ReceiptBotService } from '../services/receipt-bot.service';

@ApiTags('Integrations - وب‌هوک بات دریافت رسید')
@Controller('api/integrations/receipt-bot')
export class ReceiptBotWebhookController {
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

    if (expectedSecret && secretHeader !== expectedSecret) {
      throw new UnauthorizedException('کلید امنیتی وب‌هوک نامعتبر است.');
    }

    const outcome = await this.service.handleTelegramUpdate(update);
    return { ok: true, status: outcome.status, message: outcome.message };
  }
}
