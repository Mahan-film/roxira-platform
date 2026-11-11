import { syncPosSales } from "./api/invoicing-client.ts";
import {
  getPendingSales,
  updateQueuedSale,
  type QueuedPosSale,
} from "./pos-offline-db.ts";
import type { PosConflict, PosSyncResult } from "../types/invoicing.ts";

export interface SyncExecutionResult {
  syncedCount: number;
  conflictCount: number;
  conflicts: PosConflict[];
  errors?: string[];
}

/**
 * Synchronises all pending counter sales from IndexedDB to the server.
 * Handles online network reconnection and maps server conflicts (e.g. out of stock items).
 */
export async function syncOfflineSalesQueue(): Promise<SyncExecutionResult> {
  const pending = await getPendingSales();
  if (pending.length === 0) {
    return { syncedCount: 0, conflictCount: 0, conflicts: [] };
  }

  // Mark pending items as syncing
  for (const item of pending) {
    await updateQueuedSale(item.clientUuid, { status: "syncing" });
  }

  try {
    const payload = {
      sales: pending.map((p) => p.sale),
    };

    const result: PosSyncResult = await syncPosSales(payload);

    // Update synced items
    for (const item of result.synced) {
      await updateQueuedSale(item.clientUuid, {
        status: "synced",
        syncedAt: new Date().toISOString(),
        invoice: item.invoice,
        error: undefined,
      });
    }

    // Update conflict items
    for (const conf of result.conflicts) {
      await updateQueuedSale(conf.clientUuid, {
        status: "conflict",
        error: conf.error,
      });
    }

    return {
      syncedCount: result.synced.length,
      conflictCount: result.conflicts.length,
      conflicts: result.conflicts,
    };
  } catch (err: any) {
    // Revert syncing state back to pending on connection error
    for (const item of pending) {
      await updateQueuedSale(item.clientUuid, {
        status: "pending",
        error: err?.message || "خطا در اتصال به سرور جهت همگام‌سازی",
      });
    }
    return {
      syncedCount: 0,
      conflictCount: 0,
      conflicts: [],
      errors: [err?.message || "خطای ارتباط با سرور"],
    };
  }
}
