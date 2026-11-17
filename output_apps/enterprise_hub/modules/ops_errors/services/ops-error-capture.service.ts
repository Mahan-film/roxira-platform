import { Injectable, Logger } from '@nestjs/common';
import { OpsErrorEventsRepository } from '../repositories/ops-error-events.repository';
import { buildEvent, OpsErrorContext } from '../ops-errors.util';

/** Writes one scrubbed event per captured error. Never throws: error capture must not break a request. */
@Injectable()
export class OpsErrorCaptureService {
  private readonly logger = new Logger(OpsErrorCaptureService.name);

  constructor(private readonly repo: OpsErrorEventsRepository) {}

  async capture(error: unknown, ctx: OpsErrorContext): Promise<void> {
    try {
      await this.repo.upsert(buildEvent(error, ctx));
    } catch (e) {
      this.logger.warn(`error capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
