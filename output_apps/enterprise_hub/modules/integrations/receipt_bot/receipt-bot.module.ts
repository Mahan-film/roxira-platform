import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { InvoiceCaptureModule } from '../../invoice_capture/invoice-capture.module';
import { ReceiptBotController } from './controllers/receipt-bot.controller';
import { ReceiptBotWebhookController } from './controllers/receipt-bot-webhook.controller';
import { ReceiptBotLinkCodeEntity } from './entities/receipt-bot-link-code.entity';
import { ReceiptBotUserLinkEntity } from './entities/receipt-bot-user-link.entity';
import { ReceiptBotRepository } from './repositories/receipt-bot.repository';
import { ReceiptBotService } from './services/receipt-bot.service';
import { ReceiptBotRateLimiter } from './utils/receipt-bot-rate-limiter';

/**
 * Receipt Bot (Telegram/Bale) integration (Task T87 / WAVE 8):
 * Allows users to link Telegram/Bale to their account with a one-time code and
 * ingest photo receipts directly into `modules/invoice_capture` as drafts.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ReceiptBotLinkCodeEntity, ReceiptBotUserLinkEntity]),
    InvoiceCaptureModule,
  ],
  controllers: [ReceiptBotController, ReceiptBotWebhookController],
  providers: [
    ReceiptBotService,
    ReceiptBotRepository,
    {
      provide: ReceiptBotRateLimiter,
      useFactory: () => new ReceiptBotRateLimiter(),
    },
    TenantScope,
  ],
  exports: [ReceiptBotService],
})
export class ReceiptBotModule {}
