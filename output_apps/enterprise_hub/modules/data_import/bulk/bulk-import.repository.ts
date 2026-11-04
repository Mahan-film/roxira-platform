import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { BulkJob, BulkPostProgress, BulkStatus, BulkTableInfo } from './bulk-import.types';
import { Cell } from './stream/types';

interface JobRow {
  id: string;
  tenant_id: string;
  created_by: string | null;
  file_name: string;
  size_bytes: string;
  object_key: string;
  multipart_id: string | null;
  driver: 's3' | 'local';
  part_bytes: string;
  status: BulkStatus;
  bytes_read: string;
  rows_staged: string;
  tables: BulkTableInfo[];
  checkpoint: { rows?: Record<string, number> };
  notes: string[];
  review: unknown;
  post_progress: BulkPostProgress | null;
  batch_id: string | null;
  error: string | null;
  attempts: number;
  source_removed: boolean;
  rows_removed: boolean;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

function toJob(row: JobRow): BulkJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    objectKey: row.object_key,
    multipartId: row.multipart_id,
    driver: row.driver,
    partBytes: Number(row.part_bytes),
    status: row.status,
    bytesRead: Number(row.bytes_read),
    rowsStaged: Number(row.rows_staged),
    tables: row.tables ?? [],
    checkpoint: row.checkpoint ?? {},
    notes: row.notes ?? [],
    review: row.review,
    postProgress: row.post_progress,
    batchId: row.batch_id,
    error: row.error,
    attempts: row.attempts,
    sourceRemoved: row.source_removed,
    rowsRemoved: row.rows_removed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** Columns a caller may change on a job. Names are fixed here, never taken from input. */
const UPDATABLE: Record<string, { column: string; json?: boolean }> = {
  status: { column: 'status' },
  multipartId: { column: 'multipart_id' },
  bytesRead: { column: 'bytes_read' },
  rowsStaged: { column: 'rows_staged' },
  tables: { column: 'tables', json: true },
  checkpoint: { column: 'checkpoint', json: true },
  notes: { column: 'notes', json: true },
  review: { column: 'review', json: true },
  postProgress: { column: 'post_progress', json: true },
  batchId: { column: 'batch_id' },
  error: { column: 'error' },
  attempts: { column: 'attempts' },
  sourceRemoved: { column: 'source_removed' },
  rowsRemoved: { column: 'rows_removed' },
  startedAt: { column: 'started_at' },
  finishedAt: { column: 'finished_at' },
};

export type JobPatch = Partial<{
  status: BulkStatus;
  multipartId: string | null;
  bytesRead: number;
  rowsStaged: number;
  tables: BulkTableInfo[];
  checkpoint: { rows?: Record<string, number> };
  notes: string[];
  review: unknown;
  postProgress: BulkPostProgress | null;
  batchId: string | null;
  error: string | null;
  attempts: number;
  sourceRemoved: boolean;
  rowsRemoved: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
}>;

/**
 * The only code that touches `bulk_import_jobs` and `bulk_import_rows`. Every method takes the tenant,
 * runs inside `TenantScope` (so row-level security applies) and filters on `tenant_id` itself.
 */
@Injectable()
export class BulkImportRepository {
  constructor(
    private readonly scope: TenantScope,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async createJob(
    tenantId: string,
    job: {
      id: string;
      createdBy: string | null;
      fileName: string;
      sizeBytes: number;
      objectKey: string;
      multipartId: string | null;
      driver: 's3' | 'local';
      partBytes: number;
    },
  ): Promise<BulkJob> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<JobRow[]>(
        `INSERT INTO bulk_import_jobs (id, tenant_id, created_by, file_name, size_bytes, object_key, multipart_id, driver, part_bytes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploading') RETURNING *`,
        [job.id, tenantId, job.createdBy, job.fileName, job.sizeBytes, job.objectKey, job.multipartId, job.driver, job.partBytes],
      );
      return toJob(rows[0]);
    });
  }

  async getJob(tenantId: string, id: string): Promise<BulkJob | null> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<JobRow[]>(`SELECT * FROM bulk_import_jobs WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      return rows[0] ? toJob(rows[0]) : null;
    });
  }

  async listJobs(tenantId: string, limit = 50): Promise<BulkJob[]> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<JobRow[]>(
        `SELECT * FROM bulk_import_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [tenantId, limit],
      );
      return rows.map(toJob);
    });
  }

  /** Bytes of sources the tenant currently keeps (removed sources do not count). */
  async usedBytes(tenantId: string): Promise<number> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<{ used: string }[]>(
        `SELECT COALESCE(SUM(size_bytes), 0) AS used FROM bulk_import_jobs WHERE tenant_id = $1 AND source_removed = false`,
        [tenantId],
      );
      return Number(rows[0]?.used ?? 0);
    });
  }

  /** Size of the staging table including indexes and TOAST, all tenants (a capacity probe, not tenant data). */
  async stagingBytes(): Promise<number> {
    const rows = await this.dataSource.query<{ size: string }[]>(`SELECT pg_total_relation_size('bulk_import_rows') AS size`);
    return Number(rows[0]?.size ?? 0);
  }

  async countActive(tenantId: string): Promise<number> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<{ n: string }[]>(
        `SELECT COUNT(*) AS n FROM bulk_import_jobs WHERE tenant_id = $1 AND status IN ('queued','running','pausing','cancelling','posting')`,
        [tenantId],
      );
      return Number(rows[0]?.n ?? 0);
    });
  }

  async update(tenantId: string, id: string, patch: JobPatch): Promise<void> {
    await this.scope.run(tenantId, (m) => this.updateWith(m, tenantId, id, patch));
  }

  /** Compare-and-set the status: returns false when the job was not in one of `from`. */
  async transition(tenantId: string, id: string, from: BulkStatus[], patch: JobPatch & { status: BulkStatus }): Promise<boolean> {
    return this.scope.run(tenantId, async (m) => {
      const { sql, params } = this.buildUpdate(patch, 3);
      const rows = await m.query<{ id: string }[]>(
        `UPDATE bulk_import_jobs SET ${sql}, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = ANY($${params.length + 3}::text[]) RETURNING id`,
        [tenantId, id, ...params, from],
      );
      return rows.length > 0;
    });
  }

  async status(tenantId: string, id: string): Promise<BulkStatus | null> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<{ status: BulkStatus }[]>(`SELECT status FROM bulk_import_jobs WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      return rows[0]?.status ?? null;
    });
  }

  private buildUpdate(patch: JobPatch, firstParam: number): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const spec = UPDATABLE[key];
      if (!spec || value === undefined) continue;
      params.push(spec.json ? JSON.stringify(value) : value);
      sets.push(`"${spec.column}" = $${firstParam + params.length - 1}${spec.json ? '::jsonb' : ''}`);
    }
    if (sets.length === 0) sets.push('"status" = "status"');
    return { sql: sets.join(', '), params };
  }

  private async updateWith(m: EntityManager, tenantId: string, id: string, patch: JobPatch): Promise<void> {
    const { sql, params } = this.buildUpdate(patch, 3);
    await m.query(`UPDATE bulk_import_jobs SET ${sql}, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...params]);
  }

  /**
   * Stages a batch and updates the job's progress in ONE transaction, so the checkpoint can never claim
   * rows that were not written (or the reverse). Re-inserting the same row numbers is a no-op.
   */
  async appendBatch(
    tenantId: string,
    jobId: string,
    tableIdx: number,
    firstRowNo: number,
    rows: Cell[][],
    progress: { bytesRead: number; rowsStaged: number; tables: BulkTableInfo[]; checkpoint: { rows: Record<string, number> } },
  ): Promise<void> {
    await this.scope.run(tenantId, async (m) => {
      if (rows.length > 0) {
        const numbers = new Array<number>(rows.length);
        const cells = new Array<string>(rows.length);
        for (let i = 0; i < rows.length; i += 1) {
          numbers[i] = firstRowNo + i;
          cells[i] = JSON.stringify(rows[i]);
        }
        await m.query(
          `INSERT INTO bulk_import_rows (tenant_id, job_id, table_idx, row_no, cells)
           SELECT $1::uuid, $2::uuid, $3::int, r.n, r.c FROM unnest($4::bigint[], $5::text[]) AS r(n, c)
           ON CONFLICT DO NOTHING`,
          [tenantId, jobId, tableIdx, numbers, cells],
        );
      }
      await this.updateWith(m, tenantId, jobId, progress);
    });
  }

  async readRows(tenantId: string, jobId: string, tableIdx: number, afterRowNo: number, limit: number): Promise<{ rowNo: number; cells: Cell[] }[]> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<{ row_no: string; cells: string }[]>(
        `SELECT row_no, cells FROM bulk_import_rows WHERE tenant_id = $1 AND job_id = $2 AND table_idx = $3 AND row_no > $4 ORDER BY row_no LIMIT $5`,
        [tenantId, jobId, tableIdx, afterRowNo, Math.min(limit, 5000)],
      );
      return rows.map((r) => ({ rowNo: Number(r.row_no), cells: JSON.parse(r.cells) as Cell[] }));
    });
  }

  /** Deletes up to `limit` staged rows of a job; callers loop until it returns 0 so no single statement is huge. */
  async deleteRows(tenantId: string, jobId: string, limit = 50_000): Promise<number> {
    return this.scope.run(tenantId, async (m) => {
      const res = await m.query<{ n: string }[]>(
        `WITH doomed AS (
           SELECT ctid FROM bulk_import_rows WHERE tenant_id = $1 AND job_id = $2 LIMIT $3
         ), gone AS (
           DELETE FROM bulk_import_rows r USING doomed WHERE r.ctid = doomed.ctid AND r.tenant_id = $1 AND r.job_id = $2 RETURNING 1
         ) SELECT COUNT(*) AS n FROM gone`,
        [tenantId, jobId, limit],
      );
      return Number(res[0]?.n ?? 0);
    });
  }

  /** Jobs of one tenant whose staged rows or source are older than the retention window. */
  async findExpired(tenantId: string, retentionDays: number): Promise<BulkJob[]> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<JobRow[]>(
        `SELECT * FROM bulk_import_jobs
         WHERE tenant_id = $1 AND (source_removed = false OR rows_removed = false)
           AND status IN ('ready','failed','cancelled','paused','posted','uploading')
           AND updated_at < now() - ($2::int * interval '1 day') LIMIT 200`,
        [tenantId, retentionDays],
      );
      return rows.map(toJob);
    });
  }

  /** Jobs the sweeper must finish cleaning (cancelled or posted, not yet emptied). */
  async findPendingCleanup(tenantId: string): Promise<BulkJob[]> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m.query<JobRow[]>(
        `SELECT * FROM bulk_import_jobs
         WHERE tenant_id = $1 AND status IN ('cancelled','posted','expired') AND (source_removed = false OR rows_removed = false) LIMIT 200`,
        [tenantId],
      );
      return rows.map(toJob);
    });
  }

  /** `tenants` has no row-level security, so the sweeper can enumerate tenants and then work tenant by tenant. */
  async tenantIds(): Promise<string[]> {
    const rows = await this.dataSource.query<{ id: string }[]>(`SELECT id FROM tenants`);
    return rows.map((r) => r.id);
  }
}
