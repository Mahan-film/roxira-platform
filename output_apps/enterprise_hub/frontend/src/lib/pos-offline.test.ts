import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearSyncedSales,
  getPendingSales,
  getQueuedSales,
  queueOfflineSale,
  removeQueuedSale,
  updateQueuedSale,
} from "./pos-offline-db.ts";

test("queueOfflineSale adds counter sale to local storage with pending status", async () => {
  const sale = {
    idempotencyKey: "test-uuid-pos-1",
    warehouseId: "wh-1",
    issueDate: "2026-11-12",
    lines: [
      {
        itemId: "item-1",
        description: "کالای آزمایشی",
        quantity: 2,
        unitPrice: "150000",
      },
    ],
    cashReceived: "300000",
    posReceived: "0",
  };

  const queued = await queueOfflineSale(sale);
  assert.equal(queued.clientUuid, "test-uuid-pos-1");
  assert.equal(queued.status, "pending");
  assert.equal(queued.sale.lines.length, 1);

  const pending = await getPendingSales();
  const found = pending.find((p) => p.clientUuid === "test-uuid-pos-1");
  assert.ok(found);
  assert.equal(found?.status, "pending");
});

test("updateQueuedSale marks status and updates error or invoice fields", async () => {
  await updateQueuedSale("test-uuid-pos-1", {
    status: "conflict",
    error: "موجودی کالا کافی نیست",
  });

  const all = await getQueuedSales();
  const updated = all.find((p) => p.clientUuid === "test-uuid-pos-1");
  assert.equal(updated?.status, "conflict");
  assert.equal(updated?.error, "موجودی کالا کافی نیست");
});

test("clearSyncedSales keeps conflict and pending sales while purging synced ones", async () => {
  const sale2 = {
    idempotencyKey: "test-uuid-pos-2",
    warehouseId: "wh-1",
    issueDate: "2026-11-12",
    lines: [
      {
        itemId: "item-2",
        description: "کالای دوم",
        quantity: 1,
        unitPrice: "50000",
      },
    ],
    cashReceived: "50000",
    posReceived: "0",
  };

  await queueOfflineSale(sale2);
  await updateQueuedSale("test-uuid-pos-2", {
    status: "synced",
    syncedAt: new Date().toISOString(),
  });

  await clearSyncedSales();

  const remaining = await getQueuedSales();
  assert.ok(remaining.some((s) => s.clientUuid === "test-uuid-pos-1")); // conflict remains
  assert.ok(!remaining.some((s) => s.clientUuid === "test-uuid-pos-2")); // synced was purged

  // Clean up remaining
  await removeQueuedSale("test-uuid-pos-1");
  const final = await getQueuedSales();
  assert.ok(!final.some((s) => s.clientUuid === "test-uuid-pos-1"));
});
