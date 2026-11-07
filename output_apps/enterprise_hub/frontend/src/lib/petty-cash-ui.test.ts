import { test } from "node:test";
import assert from "node:assert/strict";

import { lastSettlementDate } from "./petty-cash-ui";

test("lastSettlementDate returns the greatest date among settled transactions", () => {
  assert.equal(
    lastSettlementDate([
      { status: "SETTLED", date: "2026-10-02" },
      { status: "PENDING", date: "2026-11-01" },
      { status: "SETTLED", date: "2026-10-20" },
    ]),
    "2026-10-20",
  );
});

test("lastSettlementDate returns null for an empty list", () => {
  assert.equal(lastSettlementDate([]), null);
});

test("lastSettlementDate returns null when nothing is settled", () => {
  assert.equal(lastSettlementDate([{ status: "PENDING", date: "2026-11-01" }]), null);
});

test("normalizeAmount accepts positive amounts and rejects the rest", async () => {
  const { normalizeAmount } = await import("./petty-cash-ui");
  assert.equal(normalizeAmount("1,500,000"), "1500000");
  assert.equal(normalizeAmount("۱۲۰۰"), "1200");
  assert.equal(normalizeAmount("12.5"), "12.5");
  assert.equal(normalizeAmount("0"), null);
  assert.equal(normalizeAmount("0.00"), null);
  assert.equal(normalizeAmount("-5"), null);
  assert.equal(normalizeAmount("1.234"), null);
  assert.equal(normalizeAmount("abc"), null);
  assert.equal(normalizeAmount(""), null);
});
