import test from "node:test";
import assert from "node:assert/strict";

import {
  computeCashNow,
  isProfitVisibleForUser,
  formatKpiDisplay,
  buildHomeAlerts,
} from "./home-hub.ts";

test("computeCashNow sums cash and bank correctly without precision loss", () => {
  assert.equal(computeCashNow("1000000", "2500000"), "3500000");
  assert.equal(computeCashNow(0, 0), "0");
  assert.equal(computeCashNow(null, undefined), "0");
  assert.equal(computeCashNow("50000000000", "50000000000"), "100000000000");
});

test("isProfitVisibleForUser checks role and explicit permission", () => {
  assert.equal(isProfitVisibleForUser(false, "owner"), true);
  assert.equal(isProfitVisibleForUser(true, "accountant"), true);
  assert.equal(isProfitVisibleForUser(false, "accountant"), false);
  assert.equal(isProfitVisibleForUser(false, "sales"), false);
  assert.equal(isProfitVisibleForUser(true, "sales"), true);
});

test("formatKpiDisplay returns confidential mask or formatted Rial", () => {
  assert.equal(formatKpiDisplay("1000000", true), "محرمانه");
  assert.equal(formatKpiDisplay(null, false), "۰ ریال");
  const formatted = formatKpiDisplay("1000000", false);
  assert.ok(formatted.includes("۱٬۰۰۰٬۰۰۰") || formatted.includes("1,000,000") || formatted.includes("ریال"));
});

test("buildHomeAlerts generates structured alerts only for non-zero metrics", () => {
  const emptyAlerts = buildHomeAlerts({});
  assert.equal(emptyAlerts.length, 0);

  const activeAlerts = buildHomeAlerts({
    chequesDueCount: 4,
    chequesDueAmount: "450000000",
    unmatchedBankLinesCount: 12,
    pendingApprovalsCount: 2,
    importExceptionsCount: 1,
    lowStockCount: 5,
  });

  assert.equal(activeAlerts.length, 5);
  assert.equal(activeAlerts[0].id, "cheques_due");
  assert.equal(activeAlerts[0].count, 4);
  assert.equal(activeAlerts[0].severity, "warning");

  assert.equal(activeAlerts[1].id, "unmatched_bank");
  assert.equal(activeAlerts[1].count, 12);
  assert.equal(activeAlerts[1].severity, "info");

  assert.equal(activeAlerts[2].id, "pending_approvals");
  assert.equal(activeAlerts[3].id, "import_exceptions");
  assert.equal(activeAlerts[3].severity, "destructive");

  assert.equal(activeAlerts[4].id, "low_stock");
  assert.equal(activeAlerts[4].count, 5);
});
