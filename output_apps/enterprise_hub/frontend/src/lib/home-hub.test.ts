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
  // Precision check on amounts > 2^53 (Iranian Rial amounts > 9 quadrillion)
  const huge1 = "9007199254740993"; // 2^53 + 1
  const huge2 = "10000000000000005";
  assert.equal(computeCashNow(huge1, huge2), "19007199254740998");
});

test("isProfitVisibleForUser checks role and explicit permission", () => {
  assert.equal(isProfitVisibleForUser(false, "owner"), true);
  assert.equal(isProfitVisibleForUser(true, "accountant"), true);
  assert.equal(isProfitVisibleForUser(false, "accountant"), false);
  assert.equal(isProfitVisibleForUser(false, "sales"), false);
  assert.equal(isProfitVisibleForUser(true, "sales"), true);
});

test("formatKpiDisplay returns confidential mask or formatted Rial/Toman/Million", () => {
  assert.equal(formatKpiDisplay("1000000", true), "محرمانه");
  assert.equal(formatKpiDisplay("1000000", true, "toman"), "محرمانه");
  assert.equal(formatKpiDisplay(null, false), "۰ ریال");
  assert.equal(formatKpiDisplay(null, false, "toman"), "۰ تومان");
  assert.equal(formatKpiDisplay(null, false, "million"), "۰ میلیون ریال");
  assert.equal(formatKpiDisplay("1000000", false, "rial"), "۱٬۰۰۰٬۰۰۰ ریال");
  assert.equal(formatKpiDisplay("1000000", false, "toman"), "۱۰۰٬۰۰۰ تومان");
  assert.equal(formatKpiDisplay("50000000", false, "million"), "۵۰ میلیون ریال");
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
