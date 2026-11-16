import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MONEY_TAB,
  MONEY_TABS,
  getMoneyTabUrl,
  isValidMoneyTab,
  resolveMoneyTab,
} from "./money-hub.ts";

test("money-hub: has all 6 unified tabs", () => {
  const expectedKeys = ["bank", "reconcile", "cash-boxes", "petty-cash", "cheques", "damages"];
  assert.deepEqual(
    MONEY_TABS.map((t) => t.key),
    expectedKeys,
  );
  assert.equal(MONEY_TABS.length, 6);
});

test("money-hub: isValidMoneyTab identifies valid tab keys", () => {
  assert.equal(isValidMoneyTab("bank"), true);
  assert.equal(isValidMoneyTab("reconcile"), true);
  assert.equal(isValidMoneyTab("cash-boxes"), true);
  assert.equal(isValidMoneyTab("petty-cash"), true);
  assert.equal(isValidMoneyTab("cheques"), true);
  assert.equal(isValidMoneyTab("damages"), true);

  assert.equal(isValidMoneyTab("unknown"), false);
  assert.equal(isValidMoneyTab(""), false);
  assert.equal(isValidMoneyTab(null), false);
  assert.equal(isValidMoneyTab(undefined), false);
  assert.equal(isValidMoneyTab(123), false);
});

test("money-hub: resolveMoneyTab falls back to DEFAULT_MONEY_TAB", () => {
  assert.equal(resolveMoneyTab("bank"), "bank");
  assert.equal(resolveMoneyTab("petty-cash"), "petty-cash");
  assert.equal(resolveMoneyTab("invalid-key"), DEFAULT_MONEY_TAB);
  assert.equal(resolveMoneyTab(null), DEFAULT_MONEY_TAB);
  assert.equal(resolveMoneyTab(undefined), DEFAULT_MONEY_TAB);
});

test("money-hub: getMoneyTabUrl produces canonical links", () => {
  assert.equal(getMoneyTabUrl("bank"), "/app/money");
  assert.equal(getMoneyTabUrl("cash-boxes"), "/app/money?tab=cash-boxes");
  assert.equal(getMoneyTabUrl("petty-cash"), "/app/money?tab=petty-cash");
  assert.equal(getMoneyTabUrl("cheques"), "/app/money?tab=cheques");
  assert.equal(getMoneyTabUrl("damages"), "/app/money?tab=damages");
});
