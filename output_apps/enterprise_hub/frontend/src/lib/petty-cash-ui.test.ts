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
