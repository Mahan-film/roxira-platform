import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';

export const CORE_TENANT_TABLES = [
  'fin_chart_of_accounts',
  'fin_journal_entries',
  'fin_journal_entry_lines',
  'erp_parties',
  'invoices',
  'fin_cheques',
  'erp_stock_items',
] as const;

export type CoreTenantTableName = (typeof CORE_TENANT_TABLES)[number];

@Injectable()
export class TenantExportRepository {
  constructor(private readonly tenantScope: TenantScope) {}

  /**
   * Fetches all records belonging to tenantId across core enterprise tables.
   * Every query runs strictly within TenantScope.within (SET LOCAL app.tenant_id = :tenantId)
   * with explicit WHERE tenant_id = :tenantId to guarantee complete tenant isolation (AGENTS.md §4).
   */
  async fetchTenantData(tenantId: string): Promise<Record<string, any[]>> {
    return this.tenantScope.within(tenantId, undefined, async (em: EntityManager) => {
      const result: Record<string, any[]> = {};

      for (const table of CORE_TENANT_TABLES) {
        // Double tenant isolation: RLS context + explicit parameterized WHERE clause
        const rows = await em.query(
          `SELECT * FROM "${table}" WHERE "tenant_id" = $1 ORDER BY 1 ASC`,
          [tenantId],
        );
        result[table] = Array.isArray(rows) ? rows : [];
      }

      return result;
    });
  }

  /**
   * Fetches records across ALL tenant tables by dynamically discovering every public table
   * with a tenant_id column (Task T148).
   */
  async fetchAllTenantData(tenantId: string): Promise<Record<string, any[]>> {
    return this.tenantScope.within(tenantId, undefined, async (em: EntityManager) => {
      const result: Record<string, any[]> = {};

      const tableRows: { table_name: string }[] = await em.query(`
        SELECT DISTINCT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'tenant_id'
          AND table_name NOT IN ('tenants', 'users')
        ORDER BY table_name ASC
      `);

      const tables = (tableRows || []).map((r) => r.table_name);
      const targetTables = tables.length > 0 ? tables : [...CORE_TENANT_TABLES];

      for (const table of targetTables) {
        try {
          const rows = await em.query(
            `SELECT * FROM "${table}" WHERE "tenant_id" = $1 ORDER BY 1 ASC`,
            [tenantId],
          );
          result[table] = Array.isArray(rows) ? rows : [];
        } catch {
          result[table] = [];
        }
      }

      return result;
    });
  }
}
