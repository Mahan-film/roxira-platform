import type {
  CreatePosSaleDto,
  InvoiceResponseDto,
  PosConflict,
} from "../types/invoicing.ts";

export type QueuedSaleStatus = "pending" | "syncing" | "synced" | "conflict";

export interface QueuedPosSale {
  clientUuid: string;
  tenantId: string;
  sale: CreatePosSaleDto;
  status: QueuedSaleStatus;
  conflictCode?: PosConflict["code"];
  createdAt: string;
  syncedAt?: string;
  error?: string;
  invoice?: InvoiceResponseDto;
}

const DB_NAME = "roxira_pos_offline_v1";
const STORE_NAME = "sales_queue";
const DB_VERSION = 2;

// In-memory fallback for SSR or environments where indexedDB is not available
const inMemoryStore = new Map<string, QueuedPosSale>();

function assertTenantId(tenantId: string): string {
  const normalized = tenantId?.trim();
  if (!normalized) {
    throw new Error("شناسه سازمان (tenantId) برای صف فروش آفلاین الزامی است.");
  }
  return normalized;
}

function hasIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      return reject(new Error("IndexedDB is not available in this environment"));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest;
      const db = target.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: "clientUuid" });
      } else {
        store = target.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains("status")) {
        store.createIndex("status", "status", { unique: false });
      }
      if (!store.indexNames.contains("createdAt")) {
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!store.indexNames.contains("tenantId")) {
        store.createIndex("tenantId", "tenantId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Adds or updates a tenant-scoped counter sale in the local offline IndexedDB queue.
 */
export async function queueOfflineSale(
  sale: CreatePosSaleDto,
  tenantId: string,
): Promise<QueuedPosSale> {
  const scopedTenant = assertTenantId(tenantId);
  const queued: QueuedPosSale = {
    clientUuid: sale.idempotencyKey,
    tenantId: scopedTenant,
    sale,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  if (!hasIndexedDb()) {
    inMemoryStore.set(queued.clientUuid, queued);
    return queued;
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(queued);
    req.onsuccess = () => resolve(queued);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns all queued counter sales scoped strictly to the given tenantId.
 */
export async function getQueuedSales(tenantId: string): Promise<QueuedPosSale[]> {
  const scopedTenant = assertTenantId(tenantId);

  if (!hasIndexedDb()) {
    return Array.from(inMemoryStore.values())
      .filter((item) => item.tenantId === scopedTenant)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = ((req.result as QueuedPosSale[]) || []).filter(
        (item) => item.tenantId === scopedTenant,
      );
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns all pending (and crash-interrupted syncing) counter sales for this tenant.
 */
export async function getPendingSales(tenantId: string): Promise<QueuedPosSale[]> {
  const all = await getQueuedSales(tenantId);
  return all.filter((s) => s.status === "pending" || s.status === "syncing");
}

/**
 * Updates a queued sale status, error details, or attached created invoice (tenant-guarded).
 */
export async function updateQueuedSale(
  clientUuid: string,
  patch: Partial<QueuedPosSale>,
  tenantId: string,
): Promise<void> {
  const scopedTenant = assertTenantId(tenantId);

  if (!hasIndexedDb()) {
    const existing = inMemoryStore.get(clientUuid);
    if (existing && existing.tenantId === scopedTenant) {
      inMemoryStore.set(clientUuid, { ...existing, ...patch, tenantId: scopedTenant });
    }
    return;
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(clientUuid);

    getReq.onsuccess = () => {
      const current = getReq.result as QueuedPosSale | undefined;
      if (!current || current.tenantId !== scopedTenant) {
        return resolve();
      }
      const updated = { ...current, ...patch, tenantId: scopedTenant };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Re-queues a previously conflicted sale back to pending so a retry actually sends it.
 */
export async function retryQueuedSale(clientUuid: string, tenantId: string): Promise<void> {
  await updateQueuedSale(
    clientUuid,
    { status: "pending", error: undefined, conflictCode: undefined },
    tenantId,
  );
}

/**
 * Removes a specific sale from the queue for this tenant (tenant-guarded).
 */
export async function removeQueuedSale(clientUuid: string, tenantId: string): Promise<void> {
  const scopedTenant = assertTenantId(tenantId);

  if (!hasIndexedDb()) {
    const existing = inMemoryStore.get(clientUuid);
    if (existing && existing.tenantId === scopedTenant) {
      inMemoryStore.delete(clientUuid);
    }
    return;
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(clientUuid);
    getReq.onsuccess = () => {
      const current = getReq.result as QueuedPosSale | undefined;
      if (!current || current.tenantId !== scopedTenant) {
        return resolve();
      }
      const req = store.delete(clientUuid);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Clears all successfully synced sales from this tenant's local queue.
 */
export async function clearSyncedSales(tenantId: string): Promise<void> {
  const all = await getQueuedSales(tenantId);
  const syncedUuids = all.filter((s) => s.status === "synced").map((s) => s.clientUuid);
  for (const uuid of syncedUuids) {
    await removeQueuedSale(uuid, tenantId);
  }
}

const TENANT_VAT_RATE_KEY_PREFIX = "roxira.pos.tenantVatRate:";
const TENANT_UNSYNCED_COUNT_KEY_PREFIX = "roxira.pos.unsyncedCount:";
const inMemoryTenantVatRates = new Map<string, number>();
const inMemoryUnsyncedCounts = new Map<string, number>();

/**
 * Stores a tenant's verified server VAT percentage for offline counter sales fallback.
 */
export function setCachedTenantVatRate(tenantId: string, rate: number): void {
  const scoped = tenantId.trim();
  if (!scoped || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    return;
  }
  inMemoryTenantVatRates.set(scoped, rate);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(`${TENANT_VAT_RATE_KEY_PREFIX}${scoped}`, String(rate));
    } catch {
      // Ignore storage quota/availability errors in restricted environments
    }
  }
}

/**
 * Loads the last verified server VAT percentage cached for this tenant, or null if unknown.
 */
export function getCachedTenantVatRate(tenantId: string): number | null {
  const scoped = tenantId.trim();
  if (!scoped) {
    return null;
  }
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(`${TENANT_VAT_RATE_KEY_PREFIX}${scoped}`);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
          inMemoryTenantVatRates.set(scoped, parsed);
          return parsed;
        }
      }
    } catch {
      // Fall through to in-memory cache
    }
  }
  return inMemoryTenantVatRates.get(scoped) ?? null;
}

/**
 * Records how many unsynced (pending / syncing / conflict) POS sales exist locally for a tenant
 * so logout guards can warn synchronously before signing out.
 */
export function setUnsyncedOfflineSalesCount(tenantId: string, count: number): void {
  const scoped = tenantId.trim();
  if (!scoped) return;
  const normalized = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  inMemoryUnsyncedCounts.set(scoped, normalized);
  if (typeof window !== "undefined") {
    try {
      const key = `${TENANT_UNSYNCED_COUNT_KEY_PREFIX}${scoped}`;
      if (normalized > 0) {
        window.localStorage.setItem(key, String(normalized));
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // no-op
    }
  }
}

/**
 * Returns the cached count of unsynced offline POS sales for a tenant (0 if none recorded).
 */
export function getUnsyncedOfflineSalesCount(tenantId: string): number {
  const scoped = tenantId.trim();
  if (!scoped) return 0;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(`${TENANT_UNSYNCED_COUNT_KEY_PREFIX}${scoped}`);
      if (raw !== null) {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    } catch {
      // Fall through to in-memory cache
    }
  }
  return inMemoryUnsyncedCounts.get(scoped) ?? 0;
}

/**
 * Clears every queued offline sale across all tenants (used by full resets and test cleanup).
 */
export async function clearAllOfflineSales(): Promise<void> {
  inMemoryStore.clear();
  inMemoryTenantVatRates.clear();
  inMemoryUnsyncedCounts.clear();
  if (!hasIndexedDb()) {
    return;
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
