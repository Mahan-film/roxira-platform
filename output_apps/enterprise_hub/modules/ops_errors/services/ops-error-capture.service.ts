import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_OPS_TENANT_ID } from '../constants/ops-errors.constants';
import { OpsErrorEventsRepository } from '../repositories/ops-error-events.repository';
import { buildEvent, OpsErrorContext } from '../ops-errors.util';

/** Writes one scrubbed event per captured error inside TenantScope. Never throws. */
@Injectable()
export class OpsErrorCaptureService {
  private readonly logger = new Logger(OpsErrorCaptureService.name);

  constructor(private readonly repo: OpsErrorEventsRepository) {}

  async capture(error: unknown, ctx: OpsErrorContext): Promise<void> {
    try {
      const event = buildEvent(error, ctx);
      const effectiveTenantId = event.tenantId ?? PLATFORM_OPS_TENANT_ID;
      await this.repo.upsert(effectiveTenantId, event);
    } catch (e) {
      this.logger.warn(`error capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
