import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDimensionTree,
  calculateBalancesSummary,
  getBalanceDisplay,
  isValidDimensionCode,
} from "./dimensions.ts";
import { DimensionKind, type Dimension, type DimensionBalanceRow } from "../types/dimension.ts";

test("isValidDimensionCode validates code format strictly", () => {
  assert.equal(isValidDimensionCode("CC-101"), true);
  assert.equal(isValidDimensionCode("PRJ_2026.01"), true);
  assert.equal(isValidDimensionCode("D-1"), true);
  assert.equal(isValidDimensionCode(""), false);
  assert.equal(isValidDimensionCode("کد فارسی"), false); // latin only
  assert.equal(isValidDimensionCode("CODE WITH SPACE"), false);
  assert.equal(isValidDimensionCode("A".repeat(33)), false); // max 32
});

test("getBalanceDisplay determines debit, credit or settled with Persian indicators", () => {
  const debit = getBalanceDisplay("1500000");
  assert.equal(debit.status, "DEBIT");
  assert.equal(debit.statusFa, "بد");
  assert.equal(debit.amountMinor, BigInt(1500000));

  const credit = getBalanceDisplay("-2500000");
  assert.equal(credit.status, "CREDIT");
  assert.equal(credit.statusFa, "بس");
  assert.equal(credit.amountMinor, BigInt(2500000));

  const zero = getBalanceDisplay("0");
  assert.equal(zero.status, "SETTLED");
  assert.equal(zero.statusFa, "تسویه");
  assert.equal(zero.amountMinor, BigInt(0));
});

test("buildDimensionTree establishes parent-child hierarchy", () => {
  const list: Dimension[] = [
    { id: 1, tenantId: "t1", kind: DimensionKind.COST_CENTER, code: "CC-ROOT", name: "دفتر مرکزی", parentId: null, createdAt: "" },
    { id: 2, tenantId: "t1", kind: DimensionKind.COST_CENTER, code: "CC-SALES", name: "فروش", parentId: 1, createdAt: "" },
    { id: 3, tenantId: "t1", kind: DimensionKind.COST_CENTER, code: "CC-ONLINE", name: "فروش اینترنتی", parentId: 2, createdAt: "" },
    { id: 4, tenantId: "t1", kind: DimensionKind.COST_CENTER, code: "CC-ISOLATED", name: "کارخانه مستقل", parentId: null, createdAt: "" },
  ];

  const tree = buildDimensionTree(list);
  assert.equal(tree.length, 2); // 2 roots: CC-ROOT and CC-ISOLATED
  assert.equal(tree[0].dimension.code, "CC-ROOT");
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].dimension.code, "CC-SALES");
  assert.equal(tree[0].children[0].children.length, 1);
  assert.equal(tree[0].children[0].children[0].dimension.code, "CC-ONLINE");
  assert.equal(tree[1].dimension.code, "CC-ISOLATED");
});

test("calculateBalancesSummary sums debits, credits, and calculates net balance", () => {
  const rows: DimensionBalanceRow[] = [
    { code: "CC-1", name: "واحد ۱", debit: "1000000", credit: "400000", balance: "600000" },
    { code: "CC-2", name: "واحد ۲", debit: "500000", credit: "800000", balance: "-300000" },
  ];

  const summary = calculateBalancesSummary(rows);
  assert.equal(summary.totalDebit, BigInt(1500000));
  assert.equal(summary.totalCredit, BigInt(1200000));
  assert.equal(summary.netBalance, BigInt(300000));
});
