import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { EntityManager } from 'typeorm';
import { AuditLogEntity } from '../entities/audit-log.entity';
import { AuditRepository } from '../repositories/audit.repository';

export interface AuditEntry {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Never put secrets, tokens, passwords or request bodies here. */
  metadata?: Record<string, unknown>;
  request?: Pick<Request, 'ip' | 'headers'>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repo: AuditRepository) {}

  /** Best effort: an audit write failure is logged loudly but never breaks the user's request. */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    try {
      const ua = entry.request?.headers?.['user-agent'];
      await this.repo.append({
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.request?.ip ?? null,
        userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null,
      }, manager);
    } catch (error) {
      this.logger.error(
        `[AUDIT] write failed for ${entry.action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  verify(tenantId: string) {
    return this.repo.verifyChain(tenantId);
  }

  list(tenantId: string, opts: { limit: number; beforeId?: string; action?: string; actorUserId?: string }): Promise<AuditLogEntity[]> {
    return this.repo.listForTenant(tenantId, opts);
  }
}
