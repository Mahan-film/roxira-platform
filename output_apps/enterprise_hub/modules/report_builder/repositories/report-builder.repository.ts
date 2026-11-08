import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { STATEMENT_TIMEOUT_MS } from '../constants/report-builder.constants';
import { ExecuteReportQueryDto, ReportTemplateView, SaveReportTemplateDto } from '../dto/report-builder.dto';

@Injectable()
export class ReportBuilderRepository {
  constructor(private readonly scope: TenantScope) {}

  /**
   * Executes a read-only query inside a transaction with:
   *   1. Tenant RLS binding (`app.current_tenant_id`)
   *   2. Read-only transaction enforcement (`SET TRANSACTION READ ONLY`)
   *   3. 5-second statement timeout (`SET LOCAL statement_timeout = '5000ms'`)
   */
  async executeReadOnlyQuery<T = Record<string, unknown>>(
    tenantId: string,
    sql: string,
    params: unknown[],
  ): Promise<T[]> {
    return this.scope.run(tenantId, async (manager: EntityManager) => {
      await manager.query(`SET TRANSACTION READ ONLY`);
      await manager.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      return (await manager.query(sql, params)) as T[];
    });
  }

  async saveTemplate(
    tenantId: string,
    userId: string,
    dto: SaveReportTemplateDto,
  ): Promise<ReportTemplateView> {
    return this.scope.run(tenantId, async (manager) => {
      const rows = (await manager.query(
        `INSERT INTO "tenant_report_templates" (
           "tenant_id", "name", "description", "dataset", "config", "created_by", "updated_at"
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
         RETURNING *`,
        [
          tenantId,
          dto.name.trim(),
          dto.description?.trim() || null,
          dto.dataset.trim(),
          JSON.stringify(dto.config),
          userId,
        ],
      )) as Array<Record<string, unknown>>;
      return mapTemplate(rows[0]);
    });
  }

  async listTemplates(tenantId: string, dataset?: string): Promise<ReportTemplateView[]> {
    return this.scope.run(tenantId, async (manager) => {
      const rows = dataset
        ? ((await manager.query(
            `SELECT * FROM "tenant_report_templates"
             WHERE "tenant_id" = $1 AND "dataset" = $2
             ORDER BY "created_at" DESC`,
            [tenantId, dataset],
          )) as Array<Record<string, unknown>>)
        : ((await manager.query(
            `SELECT * FROM "tenant_report_templates"
             WHERE "tenant_id" = $1
             ORDER BY "created_at" DESC`,
            [tenantId],
          )) as Array<Record<string, unknown>>);
      return rows.map(mapTemplate);
    });
  }

  async findTemplateById(tenantId: string, id: string): Promise<ReportTemplateView | null> {
    return this.scope.run(tenantId, async (manager) => {
      const rows = (await manager.query(
        `SELECT * FROM "tenant_report_templates"
         WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, id],
      )) as Array<Record<string, unknown>>;
      return rows[0] ? mapTemplate(rows[0]) : null;
    });
  }

  async deleteTemplate(tenantId: string, id: string): Promise<boolean> {
    return this.scope.run(tenantId, async (manager) => {
      const result = await manager.query(
        `DELETE FROM "tenant_report_templates"
         WHERE "tenant_id" = $1 AND "id" = $2`,
        [tenantId, id],
      );
      const count = Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
      return count > 0;
    });
  }
}

function mapTemplate(row: Record<string, unknown>): ReportTemplateView {
  const rawConfig = row.config;
  const config =
    rawConfig && typeof rawConfig === 'object'
      ? (rawConfig as ExecuteReportQueryDto)
      : (JSON.parse(String(rawConfig ?? '{}')) as ExecuteReportQueryDto);

  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description != null ? String(row.description) : null,
    dataset: String(row.dataset),
    config,
    createdBy: String(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}
