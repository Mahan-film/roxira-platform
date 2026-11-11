import type { CreatePosSaleDto, InvoiceResponseDto } from "../types/invoicing.ts";

export type QueuedSaleStatus = "pending" | "syncing" | "synced" | "conflict";

export interface QueuedPosSale {
  clientUuid: string;
  sale: CreatePosSaleDto;
  status: QueuedSaleStatus;
  createdAt: string;
  syncedAt?: string;
  error?: string;
  invoice?: InvoiceResponseDto;
}

const DB_NAME = "roxira_pos_offline_v1";
const STORE_NAME = "sales_queue";
const DB_VERSION = 1;

// In-memory fallback for SSR or environments where indexedDB is not available
const inMemoryStore = new Map<string, QueuedPosSale>();

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
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "clientUuid" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Adds or updates a counter sale in the local offline IndexedDB queue.
 */
export async function queueOfflineSale(sale: CreatePosSaleDto): Promise<QueuedPosSale> {
  const queued: QueuedPosSale = {
    clientUuid: sale.idempotencyKey,
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
 * Returns all queued counter sales (pending, syncing, conflict, and synced).
 */
export async function getQueuedSales(): Promise<QueuedPosSale[]> {
  if (!hasIndexedDb()) {
    return Array.from(inMemoryStore.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result as QueuedPosSale[]) || [];
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns all pending and conflicted counter sales that require synchronization.
 */
export async function getPendingSales(): Promise<QueuedPosSale[]> {
  const all = await getQueuedSales();
  return all.filter((s) => s.status === "pending" || s.status === "syncing");
}

/**
 * Updates a queued sale status, error details, or attached created invoice.
 */
export async function updateQueuedSale(
  clientUuid: string,
  patch: Partial<QueuedPosSale>,
): Promise<void> {
  if (!hasIndexedDb()) {
    const existing = inMemoryStore.get(clientUuid);
    if (existing) {
      inMemoryStore.set(clientUuid, { ...existing, ...patch });
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
      if (!current) {
        return resolve();
      }
      const updated = { ...current, ...patch };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Removes a specific sale from the queue (e.g. manually discarded or resolved).
 */
export async function removeQueuedSale(clientUuid: string): Promise<void> {
  if (!hasIndexedDb()) {
    inMemoryStore.delete(clientUuid);
    return;
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(clientUuid);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clears all successfully synced sales from local queue.
 */
export async function clearSyncedSales(): Promise<void> {
  const all = await getQueuedSales();
  const syncedUuids = all.filter((s) => s.status === "synced").map((s) => s.clientUuid);
  for (const uuid of syncedUuids) {
    await removeQueuedSale(uuid);
  }
}
