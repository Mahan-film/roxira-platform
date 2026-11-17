import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { ClientErrorsModule } from '../client-errors/client-errors.module';
import { OpsErrorsController } from './controllers/ops-errors.controller';
import { OPS_ERROR_ALERTS_QUEUE } from './constants/ops-errors.constants';
import { OpsErrorFilter } from './ops-error.filter';
import { OpsErrorAlertsProcessor } from './processors/ops-error-alerts.processor';
import { OpsErrorEventsRepository } from './repositories/ops-error-events.repository';
import { OpsErrorAlertService } from './services/ops-error-alert.service';
import { OpsErrorCaptureService } from './services/ops-error-capture.service';
import { OpsErrorSchedulerService } from './services/ops-error-scheduler.service';
import { OpsErrorsQueryService } from './services/ops-errors-query.service';

/**
 * Error capture without a new container (T199): a global exception filter stores scrubbed 5xx events
 * in ops_error_events, a BullMQ worker alerts Telegram and sends a daily digest, and a platform-admin
 * endpoint lists them.
 */
@Module({
  imports: [BullModule.registerQueue({ name: OPS_ERROR_ALERTS_QUEUE }), AuthModule, ClientErrorsModule],
  controllers: [OpsErrorsController],
  providers: [
    OpsErrorEventsRepository,
    OpsErrorCaptureService,
    OpsErrorAlertService,
    OpsErrorSchedulerService,
    OpsErrorAlertsProcessor,
    OpsErrorsQueryService,
    { provide: APP_FILTER, useClass: OpsErrorFilter },
  ],
})
export class OpsErrorsModule {}
