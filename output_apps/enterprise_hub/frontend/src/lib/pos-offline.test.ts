import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, test } from "node:test";
import { pathToFileURL } from "node:url";

const SRC_ROOT = new URL("../", import.meta.url).pathname;
const registerHooksFn = (
  nodeModule as unknown as {
    registerHooks?: (hooks: {
      resolve: (
        specifier: string,
        context: unknown,
        nextResolve: (specifier: string, context: unknown) => unknown,
      ) => unknown;
    }) => void;
  }
).registerHooks;

registerHooksFn?.({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const rel = specifier.slice(2);
      const tsPath = rel.endsWith(".ts") ? `${SRC_ROOT}${rel}` : `${SRC_ROOT}${rel}.ts`;
      return nextResolve(pathToFileURL(tsPath).href, context);
    }
    return nextResolve(specifier, context);
  },
});

import type { CreatePosSaleDto, InvoiceResponseDto } from "../types/invoicing.ts";
import { computePosCartTotals, parsePosQuantity, parsePosUnitPrice, splitPosPayment } from "./pos-money.ts";
import {
  clearAllOfflineSales,
  clearSyncedSales,
  getCachedTenantVatRate,
  getPendingSales,
  getQueuedSales,
  getUnsyncedOfflineSalesCount,
  queueOfflineSale,
  removeQueuedSale,
  retryQueuedSale,
  setCachedTenantVatRate,
  setUnsyncedOfflineSalesCount,
  updateQueuedSale,
  type QueuedPosSale,
} from "./pos-offline-db.ts";
import { syncOfflineSalesQueue } from "./pos-sync-manager.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function makeValidSale(idempotencyKey: string, code = "SKU-100", unitPrice = 150_000): CreatePosSaleDto {
  return {
    idempotencyKey,
    customer: { phone: "09121234567", name: "علی رضایی" },
    lines: [
      {
        code,
        description: "کالای آزمایشی",
        quantity: 2,
        unitPrice,
      },
    ],
    payments: [{ method: "CASH", amount: unitPrice * 2 }],
    warehouseId: 1,
  };
}

function makeFakeInvoice(id: string, total = 300_000): InvoiceResponseDto {
  return {
    id,
    taxInvoiceNumber: `TI-${id}`,
    status: "PAID",
    totalPayable: total,
    items: [
      {
        description: "کالای آزمایشی",
        quantity: 2,
        unitPrice: total / 2,
        vatAmount: 0,
        totalAmount: total,
      },
    ],
  } as unknown as InvoiceResponseDto;
}

afterEach(async () => {
  await clearAllOfflineSales();
  delete (globalThis as { window?: unknown }).window;
});

test("pos-offline-db enforces tenant scoping and prevents cross-tenant leakage or mutation", async () => {
  const saleA = makeValidSale("pos-tenant-a-1");
  const saleB = makeValidSale("pos-tenant-b-1", "SKU-200", 50_000);

  await queueOfflineSale(saleA, TENANT_A);
  await queueOfflineSale(saleB, TENANT_B);

  const listA = await getQueuedSales(TENANT_A);
  const listB = await getQueuedSales(TENANT_B);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].clientUuid, "pos-tenant-a-1");
  assert.equal(listA[0].tenantId, TENANT_A);

  assert.equal(listB.length, 1);
  assert.equal(listB[0].clientUuid, "pos-tenant-b-1");

  // Tenant B must not be able to mutate or delete Tenant A's queued sale
  await updateQueuedSale("pos-tenant-a-1", { status: "conflict", error: "hijack" }, TENANT_B);
  await removeQueuedSale("pos-tenant-a-1", TENANT_B);
  const stillIntact = await getPendingSales(TENANT_A);
  assert.equal(stillIntact.length, 1);
  assert.equal(stillIntact[0].status, "pending");

  // Missing tenantId fails closed
  await assert.rejects(() => queueOfflineSale(saleA, ""));
  await assert.rejects(() => getQueuedSales(""));

  // Full logout wipe removes rows across all tenants
  await clearAllOfflineSales();
  assert.equal((await getQueuedSales(TENANT_A)).length, 0);
  assert.equal((await getQueuedSales(TENANT_B)).length, 0);
});

test("clearSyncedSales keeps conflict & pending rows while purging synced rows for that tenant", async () => {
  await queueOfflineSale(makeValidSale("pos-conflict-1"), TENANT_A);
  await updateQueuedSale(
    "pos-conflict-1",
    { status: "conflict", conflictCode: "OUT_OF_STOCK", error: "موجودی کافی نیست" },
    TENANT_A,
  );

  await queueOfflineSale(makeValidSale("pos-synced-1"), TENANT_A);
  await updateQueuedSale(
    "pos-synced-1",
    { status: "synced", syncedAt: new Date().toISOString(), invoice: makeFakeInvoice("inv-s1") },
    TENANT_A,
  );

  await clearSyncedSales(TENANT_A);

  const remaining = await getQueuedSales(TENANT_A);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].clientUuid, "pos-conflict-1");
  assert.equal(remaining[0].status, "conflict");
});

test("retryQueuedSale flips conflict back to pending and syncOfflineSalesQueue retries cleanly", async () => {
  await queueOfflineSale(makeValidSale("pos-retry-1"), TENANT_A);
  await updateQueuedSale(
    "pos-retry-1",
    { status: "conflict", conflictCode: "OUT_OF_STOCK", error: "کمبود موجودی" },
    TENANT_A,
  );

  // Without retrying the conflict row, getPendingSales excludes it
  assert.equal((await getPendingSales(TENANT_A)).length, 0);

  await retryQueuedSale("pos-retry-1", TENANT_A);
  assert.equal((await getPendingSales(TENANT_A)).length, 1);

  const res = await syncOfflineSalesQueue(TENANT_A, async (dto) => {
    assert.equal(dto.sales.length, 1);
    return {
      synced: [{ clientUuid: dto.sales[0].idempotencyKey, invoice: makeFakeInvoice("inv-r1"), replayed: false }],
      conflicts: [],
      totalProcessed: 1,
    };
  });

  assert.equal(res.syncedCount, 1);
  assert.equal(res.conflictCount, 0);
  const after = await getQueuedSales(TENANT_A);
  assert.equal(after[0].status, "synced");
  assert.equal(after[0].invoice?.taxInvoiceNumber, "TI-inv-r1");
});

test("syncOfflineSalesQueue coalesces concurrent sync calls per tenant behind a single lock", async () => {
  await queueOfflineSale(makeValidSale("pos-lock-1"), TENANT_A);

  let callCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const slowCaller = async (dto: { sales: CreatePosSaleDto[] }) => {
    callCount += 1;
    await gate;
    return {
      synced: dto.sales.map((s) => ({
        clientUuid: s.idempotencyKey,
        invoice: makeFakeInvoice(`inv-${s.idempotencyKey}`),
        replayed: false,
      })),
      conflicts: [],
      totalProcessed: dto.sales.length,
    };
  };

  const p1 = syncOfflineSalesQueue(TENANT_A, slowCaller);
  const p2 = syncOfflineSalesQueue(TENANT_A, slowCaller);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(callCount, 1);
  assert.equal(r1.syncedCount, 1);
  assert.equal(r2.syncedCount, 1);
});

test("syncOfflineSalesQueue isolates single-item 400 validation failures without losing valid batch rows, and preserves pending on 403/500", async () => {
  await queueOfflineSale(makeValidSale("pos-good-1"), TENANT_A);
  await queueOfflineSale(makeValidSale("pos-bad-1"), TENANT_A);

  // Batch fails with 400, per-item fallback sends one-by-one
  const batch400Res = await syncOfflineSalesQueue(TENANT_A, async (dto) => {
    if (dto.sales.length > 1) {
      throw Object.assign(new Error("Validation failed"), { statusCode: 400 });
    }
    if (dto.sales[0].idempotencyKey === "pos-bad-1") {
      throw Object.assign(new Error("نام مشتری بیش از حد مجاز است"), { statusCode: 400 });
    }
    return {
      synced: [{ clientUuid: dto.sales[0].idempotencyKey, invoice: makeFakeInvoice("inv-g1"), replayed: false }],
      conflicts: [],
      totalProcessed: 1,
    };
  });

  assert.equal(batch400Res.syncedCount, 1);
  assert.equal(batch400Res.conflictCount, 1);
  assert.equal(batch400Res.conflicts[0].clientUuid, "pos-bad-1");
  assert.equal(batch400Res.conflicts[0].code, "VALIDATION_FAILED");

  // 403 / 500 keeps pending items pending instead of marking permanent conflicts
  await queueOfflineSale(makeValidSale("pos-403-retry"), TENANT_A);
  const errRes = await syncOfflineSalesQueue(TENANT_A, async () => {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  });
  assert.equal(errRes.syncedCount, 0);
  assert.equal(errRes.conflictCount, 0);
  assert.equal(errRes.errors?.[0], "Forbidden");
  const pendingAfter403 = await getPendingSales(TENANT_A);
  assert.equal(pendingAfter403[0].clientUuid, "pos-403-retry");
  assert.equal(pendingAfter403[0].status, "pending");
});

test("pos-offline-db exercises real IndexedDB code path with mocked window.indexedDB", async () => {
  const records = new Map<string, QueuedPosSale>();
  const indexes = new Set<string>();
  let upgradeRan = false;

  interface FakeReq<T> {
    result: T;
    error: unknown;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
  }

  const makeReq = <T>(executor: () => T): FakeReq<T> => {
    const req: FakeReq<T> = {
      result: undefined as unknown as T,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    queueMicrotask(() => {
      try {
        req.result = executor();
        req.onsuccess?.();
      } catch (e) {
        req.error = e;
        req.onerror?.();
      }
    });
    return req;
  };

  const fakeStore = {
    indexNames: { contains: (name: string) => indexes.has(name) },
    createIndex: (name: string) => {
      indexes.add(name);
    },
    put: (val: QueuedPosSale) =>
      makeReq(() => {
        records.set(val.clientUuid, structuredClone(val));
        return val.clientUuid;
      }),
    get: (key: string) =>
      makeReq(() => (records.has(key) ? structuredClone(records.get(key)) : undefined)),
    getAll: () => makeReq(() => Array.from(records.values()).map((r) => structuredClone(r))),
    delete: (key: string) =>
      makeReq(() => {
        records.delete(key);
      }),
    clear: () =>
      makeReq(() => {
        records.clear();
      }),
  };

  let createdStore = false;
  const fakeDb = {
    objectStoreNames: { contains: () => createdStore },
    createObjectStore: () => {
      createdStore = true;
      return fakeStore;
    },
    transaction: () => ({ objectStore: () => fakeStore }),
  };

  interface FakeOpenReq {
    result: typeof fakeDb;
    onupgradeneeded: ((ev: { target: FakeOpenReq }) => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    transaction: { objectStore: () => typeof fakeStore };
  }

  (globalThis as unknown as { window?: { indexedDB: { open: () => FakeOpenReq } } }).window = {
    indexedDB: {
      open: () => {
        const openReq: FakeOpenReq = {
          result: fakeDb,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          transaction: { objectStore: () => fakeStore },
        };
        queueMicrotask(() => {
          if (!upgradeRan) {
            upgradeRan = true;
            openReq.onupgradeneeded?.({ target: openReq });
          }
          openReq.onsuccess?.();
        });
        return openReq;
      },
    },
  };

  await queueOfflineSale(makeValidSale("pos-idb-a"), TENANT_A);
  await queueOfflineSale(makeValidSale("pos-idb-b"), TENANT_B);
  assert.ok(indexes.has("tenantId"));

  const rowsA = await getQueuedSales(TENANT_A);
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].clientUuid, "pos-idb-a");

  await retryQueuedSale("pos-idb-a", TENANT_B); // blocked cross-tenant
  assert.equal(records.get("pos-idb-a")?.tenantId, TENANT_A);

  await clearAllOfflineSales();
  assert.equal(records.size, 0);
});

test("pos-money computes BigInt cart totals, dynamic VAT, Persian digits, and splits payments without floats", () => {
  assert.equal(parsePosQuantity("۱.۵"), 1.5);
  assert.equal(parsePosUnitPrice("۲۵۰,۰۰۰"), 250_000);

  const totals10 = computePosCartTotals([{ quantity: "۲", unitPrice: "100000" }], 10);
  assert.equal(totals10.netTotal, BigInt(200_000));
  assert.equal(totals10.vatTotal, BigInt(20_000));
  assert.equal(totals10.payableTotal, BigInt(220_000));

  const totals9 = computePosCartTotals([{ quantity: "1.5", unitPrice: "10000" }], 9);
  assert.equal(totals9.netTotal, BigInt(15_000));
  assert.equal(totals9.vatTotal, BigInt(1_350));
  assert.equal(totals9.payableTotal, BigInt(16_350));

  assert.deepEqual(splitPosPayment(BigInt(220_000), "70000", "CASH"), [
    { method: "CARD", amount: 70_000 },
    { method: "CASH", amount: 150_000 },
  ]);
  assert.equal(splitPosPayment(BigInt(220_000), "300000", "CASH"), null);
  assert.equal(splitPosPayment(BigInt(220_000), "10.5", "CASH"), null);
});

test("computePosCartTotals rounds VAT per line matching InvoicingService.quote on multi-line odd carts", () => {
  // 2 lines of 1 x 105 Rial at 10% VAT:
  // Per-line VAT rounding gives 11 Rial per line = 22 Rial total VAT, 232 Rial payable
  // (whole-cart VAT rounding on 210 Rial would have been 21 Rial -> 231, causing server conflict).
  const oddTwoLine = computePosCartTotals(
    [
      { quantity: "1", unitPrice: "105" },
      { quantity: "1", unitPrice: "105" },
    ],
    10,
  );
  assert.equal(oddTwoLine.netTotal, BigInt(210));
  assert.equal(oddTwoLine.vatTotal, BigInt(22));
  assert.equal(oddTwoLine.payableTotal, BigInt(232));

  // Fractional quantity lines: 2 x (1.5 * 15 = 22.5) at 10% -> lineTax=2, lineTotal=round(24.5)=25 -> 50
  const fractionalMulti = computePosCartTotals(
    [
      { quantity: "1.5", unitPrice: "15" },
      { quantity: "1.5", unitPrice: "15" },
    ],
    10,
  );
  assert.equal(fractionalMulti.netTotal, BigInt(45));
  assert.equal(fractionalMulti.vatTotal, BigInt(4));
  assert.equal(fractionalMulti.payableTotal, BigInt(50));
});

test("per-tenant VAT rate cache and unsynced logout counter are tenant-isolated and validated", () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  };

  assert.equal(getCachedTenantVatRate(TENANT_A), null);
  setCachedTenantVatRate(TENANT_A, 10);
  setCachedTenantVatRate(TENANT_B, 0);
  setCachedTenantVatRate(TENANT_A, Number.NaN); // ignored
  setCachedTenantVatRate(TENANT_A, -5); // ignored

  assert.equal(getCachedTenantVatRate(TENANT_A), 10);
  assert.equal(getCachedTenantVatRate(TENANT_B), 0);

  setUnsyncedOfflineSalesCount(TENANT_A, 3);
  assert.equal(getUnsyncedOfflineSalesCount(TENANT_A), 3);
  assert.equal(getUnsyncedOfflineSalesCount(TENANT_B), 0);
  setUnsyncedOfflineSalesCount(TENANT_A, 0);
  assert.equal(getUnsyncedOfflineSalesCount(TENANT_A), 0);
});

test("syncOfflineSalesQueue falls back one-by-one on HTTP 413 oversized batch responses", async () => {
  await queueOfflineSale(makeValidSale("pos-413-split-1", "SKU-1", 100_000), TENANT_A);
  await queueOfflineSale(makeValidSale("pos-413-split-2", "SKU-2", 100_000), TENANT_A);
  const splitRes = await syncOfflineSalesQueue(TENANT_A, async ({ sales }) => {
    if (sales.length > 1) {
      throw Object.assign(new Error("Request Entity Too Large"), { statusCode: 413 });
    }
    return {
      synced: [
        {
          clientUuid: sales[0].idempotencyKey,
          invoice: makeFakeInvoice(sales[0].idempotencyKey, 200_000),
          replayed: false,
        },
      ],
      conflicts: [],
      totalProcessed: 1,
    };
  });
  assert.equal(splitRes.syncedCount, 2);
  assert.equal(splitRes.conflictCount, 0);
});

test("removeSession preserves pending and conflict offline sales while purging only synced rows for the signed-out tenant", async () => {
  await queueOfflineSale(makeValidSale("pos-keep-pending"), TENANT_A);
  await queueOfflineSale(makeValidSale("pos-keep-conflict"), TENANT_A);
  await updateQueuedSale("pos-keep-conflict", { status: "conflict", conflictCode: "OUT_OF_STOCK" }, TENANT_A);
  await queueOfflineSale(makeValidSale("pos-purge-synced"), TENANT_A);
  await updateQueuedSale("pos-purge-synced", { status: "synced" }, TENANT_A);
  await queueOfflineSale(makeValidSale("pos-other-tenant-synced"), TENANT_B);
  await updateQueuedSale("pos-other-tenant-synced", { status: "synced" }, TENANT_B);

  const jwtPayload = Buffer.from(JSON.stringify({ sub: "u-1", tenantId: TENANT_A })).toString("base64url");
  const storage = new Map<string, string>([
    [
      "roxira.auth.session",
      JSON.stringify({
        accessToken: `eyJhbGciOiJIUzI1NiJ9.${jwtPayload}.sig`,
        tokenType: "Bearer",
        user: { id: "u-1" },
        expiresAt: Date.now() + 60_000,
      }),
    ],
  ]);
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
    dispatchEvent: () => true,
  };
  (globalThis as { Event?: unknown }).Event = class FakeEvent {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };

  const { removeSession } = await import("./api/session-store.ts");
  removeSession();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(storage.has("roxira.auth.session"), false);
  const tenantARows = (await getQueuedSales(TENANT_A))
    .map((r) => [r.clientUuid, r.status] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(tenantARows, [
    ["pos-keep-conflict", "conflict"],
    ["pos-keep-pending", "pending"],
  ]);
  const tenantBRows = await getQueuedSales(TENANT_B);
  assert.deepEqual(
    tenantBRows.map((r) => [r.clientUuid, r.status]),
    [["pos-other-tenant-synced", "synced"]],
  );
});
