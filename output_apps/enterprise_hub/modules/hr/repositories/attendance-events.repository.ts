import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TenantScope } from '../../access/services/tenant-scope';
import { AttendanceEventEntity } from '../entities/attendance-event.entity';
import { AttendanceEventKind, AttendanceEventSource } from '../enums/attendance-event.enum';

export interface NewAttendanceEvent {
  employeeId: number;
  branchId?: number | null;
  occurredAt: Date;
  kind: AttendanceEventKind;
  source: AttendanceEventSource;
  createdBy?: string | null;
  notes?: string | null;
}

const COLUMNS = `id, tenant_id AS "tenantId", employee_id AS "employeeId",
  branch_id AS "branchId", occurred_at AS "occurredAt", kind, source,
  created_by AS "createdBy", notes, created_at AS "createdAt"`;

@Injectable()
export class AttendanceEventsRepository {
  constructor(private readonly scope: TenantScope) {}

  /**
   * Records a single attendance event under TenantScope.
   */
  async createEvent(tenantId: string, data: NewAttendanceEvent): Promise<AttendanceEventEntity> {
    return this.scope.run(tenantId, async (m) => {
      const id = randomUUID();
      const [row] = await m.query(
        `INSERT INTO attendance_events (
           id, tenant_id, employee_id, branch_id, occurred_at, kind, source, created_by, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUMNS}`,
        [
          id,
          tenantId,
          data.employeeId,
          data.branchId ?? null,
          data.occurredAt,
          data.kind,
          data.source,
          data.createdBy ?? null,
          data.notes ?? null,
        ],
      );
      return row as AttendanceEventEntity;
    });
  }

  /**
   * Bulk inserts attendance events in chunks.
   */
  async bulkCreateEvents(tenantId: string, events: NewAttendanceEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    return this.scope.run(tenantId, async (m) => {
      let inserted = 0;
      const chunkSize = 50;
      for (let i = 0; i < events.length; i += chunkSize) {
        const chunk = events.slice(i, i + chunkSize);
        const valuePlaceholders: string[] = [];
        const params: unknown[] = [tenantId];
        let pIdx = 2;

        for (const ev of chunk) {
          const id = randomUUID();
          valuePlaceholders.push(
            `($${pIdx}, $1, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7})`,
          );
          params.push(
            id,
            ev.employeeId,
            ev.branchId ?? null,
            ev.occurredAt,
            ev.kind,
            ev.source,
            ev.createdBy ?? null,
            ev.notes ?? null,
          );
          pIdx += 8;
        }

        const sql = `INSERT INTO attendance_events (
          id, tenant_id, employee_id, branch_id, occurred_at, kind, source, created_by, notes
        ) VALUES ${valuePlaceholders.join(', ')}`;
        await m.query(sql, params);
        inserted += chunk.length;
      }
      return inserted;
    });
  }

  /**
   * Retrieves all events on a specific date (UTC / Tehran calendar day), optionally filtered by branch.
   */
  async listEventsForDay(
    tenantId: string,
    startOfDay: Date,
    endOfDay: Date,
    branchId?: number,
  ): Promise<AttendanceEventEntity[]> {
    return this.scope.run(tenantId, async (m) => {
      const params: unknown[] = [tenantId, startOfDay, endOfDay];
      let branchFilter = '';
      if (branchId !== undefined && branchId !== null) {
        branchFilter = 'AND branch_id = $4';
        params.push(branchId);
      }

      return m.query(
        `SELECT ${COLUMNS} FROM attendance_events
         WHERE tenant_id = $1
           AND occurred_at >= $2
           AND occurred_at <= $3
           ${branchFilter}
         ORDER BY occurred_at ASC`,
        params,
      );
    });
  }

  /**
   * Retrieves events within a date range for monthly rollup calculations.
   */
  async listEventsForRange(
    tenantId: string,
    startIso: string,
    endIso: string,
    employeeId?: number,
  ): Promise<AttendanceEventEntity[]> {
    return this.scope.run(tenantId, async (m) => {
      const params: unknown[] = [tenantId, startIso, endIso];
      let empFilter = '';
      if (employeeId !== undefined && employeeId !== null) {
        empFilter = 'AND employee_id = $4';
        params.push(employeeId);
      }

      return m.query(
        `SELECT ${COLUMNS} FROM attendance_events
         WHERE tenant_id = $1
           AND occurred_at >= $2
           AND occurred_at <= $3
           ${empFilter}
         ORDER BY employee_id ASC, occurred_at ASC`,
        params,
      );
    });
  }
}
