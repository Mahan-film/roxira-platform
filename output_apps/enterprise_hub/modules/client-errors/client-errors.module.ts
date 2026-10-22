import { Module } from '@nestjs/common';
import { ClientErrorsController } from './controllers/client-errors.controller';
import { ClientErrorAlertSender } from './services/client-error-alert.sender';
import { ClientErrorsService } from './services/client-errors.service';

/** دریافت خطاهای مرورگر: لاگ ساختاریافته + هشدار محدودشده. بدون جدول پایگاه‌داده. */
@Module({
  controllers: [ClientErrorsController],
  providers: [ClientErrorsService, ClientErrorAlertSender],
})
export class ClientErrorsModule {}
