import { Injectable } from '@nestjs/common';
import { ListOpsErrorsQueryDto, OpsErrorListResponseDto } from '../dto/list-ops-errors.dto';
import { shortId } from '../ops-errors.util';
import { OpsErrorEventsRepository } from '../repositories/ops-error-events.repository';

@Injectable()
export class OpsErrorsQueryService {
  constructor(private readonly repo: OpsErrorEventsRepository) {}

  async list(tenantId: string, dto: ListOpsErrorsQueryDto): Promise<OpsErrorListResponseDto> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;
    const { items, total } = await this.repo.list(tenantId, limit, (page - 1) * limit, dto.source);
    return {
      items: items.map((r) => ({
        id: r.id,
        fingerprint: r.fingerprint,
        shortId: shortId(r.fingerprint),
        day: r.day,
        source: r.source,
        errorClass: r.errorClass,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        count: r.count,
        route: r.route,
        httpMethod: r.httpMethod,
        status: r.status,
        release: r.release,
        sampleMessage: r.sampleMessage,
      })),
      total,
      page,
      limit,
    };
  }
}
