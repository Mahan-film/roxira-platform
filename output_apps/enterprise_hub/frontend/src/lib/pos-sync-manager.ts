import {
  getPendingSales,
  updateQueuedSale,
} from "./pos-offline-db.ts";
import type {
  PosConflict,
  PosSyncResult,
  SyncPosSalesDto,
} from "../types/invoicing.ts";

export interface SyncExecutionResult {
  syncedCount: number;
  conflictCount: number;
  conflicts: PosConflict[];
  errors?: string[];
}

export type SyncPosSalesCaller = (dto: SyncPosSalesDto) => Promise<PosSyncResult>;

// Per-tenant in-flight mutex prevents concurrent sync runs from double-sending the same pending rows.
const inFlightByTenant = new Map<string, Promise<SyncExecutionResult>>();

function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const record = err as { statusCode?: unknown; status?: unknown };
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.status === "number") return record.status;
  return undefined;
}

/**
 * Synchronises all pending counter sales for the active tenant from IndexedDB to the server.
 * Coalesces concurrent invocations for the same tenant behind a single promise.
 */
export function syncOfflineSalesQueue(
  tenantId: string,
  caller?: SyncPosSalesCaller,
): Promise<SyncExecutionResult> {
  const scopedTenant = tenantId?.trim();
  if (!scopedTenant) {
    return Promise.resolve({
      syncedCount: 0,
      conflictCount: 0,
      conflicts: [],
      errors: ["شناسه سازمان برای همگام‌سازی صف مشخص نیست."],
    });
  }

  const existingRun = inFlightByTenant.get(scopedTenant);
  if (existingRun) {
    return existingRun;
  }

  const resolvedCaller: SyncPosSalesCaller =
    caller ??
    (async (dto) => {
      const mod = await import("./api/invoicing-client");
      return mod.syncPosSales(dto);
    });

  const run = executeTenantSync(scopedTenant, resolvedCaller).finally(() => {
    if (inFlightByTenant.get(scopedTenant) === run) {
      inFlightByTenant.delete(scopedTenant);
    }
  });
  inFlightByTenant.set(scopedTenant, run);
  return run;
}

async function executeTenantSync(
  tenantId: string,
  caller: SyncPosSalesCaller,
): Promise<SyncExecutionResult> {
  const pending = await getPendingSales(tenantId);
  if (pending.length === 0) {
    return { syncedCount: 0, conflictCount: 0, conflicts: [] };
  }

  // Mark pending items as syncing
  for (const item of pending) {
    await updateQueuedSale(item.clientUuid, { status: "syncing" }, tenantId);
  }

  try {
    const result = await caller({
      sales: pending.map((p) => p.sale),
    });

    for (const item of result.synced) {
      await updateQueuedSale(
        item.clientUuid,
        {
          status: "synced",
          syncedAt: new Date().toISOString(),
          invoice: item.invoice,
          error: undefined,
          conflictCode: undefined,
        },
        tenantId,
      );
    }

    for (const conf of result.conflicts) {
      await updateQueuedSale(
        conf.clientUuid,
        {
          status: "conflict",
          conflictCode: conf.code,
          error: conf.error,
        },
        tenantId,
      );
    }

    return {
      syncedCount: result.synced.length,
      conflictCount: result.conflicts.length,
      conflicts: result.conflicts,
    };
  } catch (err: unknown) {
    const statusCode = extractStatusCode(err);
    const message = err instanceof Error && err.message ? err.message : "خطای ارتباط با سرور";

    // If a batch was rejected by request validation / payload size (400/413/422) and has multiple items,
    // probe one-by-one so valid items succeed and only malformed rows become conflicts.
    if ((statusCode === 400 || statusCode === 413 || statusCode === 422) && pending.length > 1) {
      return isolateBadBatchItems(pending.map((p) => p.sale), tenantId, caller);
    }

    if (statusCode === 400 || statusCode === 422) {
      const conflicts: PosConflict[] = [];
      for (const item of pending) {
        const conflict: PosConflict = {
          clientUuid: item.clientUuid,
          code: "VALIDATION_FAILED",
          error: message,
        };
        conflicts.push(conflict);
        await updateQueuedSale(
          item.clientUuid,
          { status: "conflict", conflictCode: "VALIDATION_FAILED", error: message },
          tenantId,
        );
      }
      return {
        syncedCount: 0,
        conflictCount: conflicts.length,
        conflicts,
        errors: [message],
      };
    }

    // Transient network/5xx or 401/403 permission failures keep items pending for later retry.
    for (const item of pending) {
      await updateQueuedSale(
        item.clientUuid,
        {
          status: "pending",
          error: message,
        },
        tenantId,
      );
    }
    return {
      syncedCount: 0,
      conflictCount: 0,
      conflicts: [],
      errors: [message],
    };
  }
}

async function isolateBadBatchItems(
  sales: SyncPosSalesDto["sales"],
  tenantId: string,
  caller: SyncPosSalesCaller,
): Promise<SyncExecutionResult> {
  let syncedCount = 0;
  const conflicts: PosConflict[] = [];
  const errors: string[] = [];

  for (const sale of sales) {
    try {
      const res = await caller({ sales: [sale] });
      for (const s of res.synced) {
        syncedCount += 1;
        await updateQueuedSale(
          s.clientUuid,
          {
            status: "synced",
            syncedAt: new Date().toISOString(),
            invoice: s.invoice,
            error: undefined,
            conflictCode: undefined,
          },
          tenantId,
        );
      }
      for (const c of res.conflicts) {
        conflicts.push(c);
        await updateQueuedSale(
          c.clientUuid,
          { status: "conflict", conflictCode: c.code, error: c.error },
          tenantId,
        );
      }
    } catch (itemErr: unknown) {
      const status = extractStatusCode(itemErr);
      const msg =
        itemErr instanceof Error && itemErr.message ? itemErr.message : "خطای اعتبارسنجی فروش";
      if (status === 400 || status === 422) {
        const conf: PosConflict = {
          clientUuid: sale.idempotencyKey,
          code: "VALIDATION_FAILED",
          error: msg,
        };
        conflicts.push(conf);
        await updateQueuedSale(
          sale.idempotencyKey,
          { status: "conflict", conflictCode: "VALIDATION_FAILED", error: msg },
          tenantId,
        );
      } else {
        errors.push(msg);
        await updateQueuedSale(
          sale.idempotencyKey,
          { status: "pending", error: msg },
          tenantId,
        );
      }
    }
  }

  return {
    syncedCount,
    conflictCount: conflicts.length,
    conflicts,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
