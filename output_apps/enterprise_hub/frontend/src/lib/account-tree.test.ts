import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAccountTree, countReview, visibleNodes } from "./account-tree.ts";

const acc = (code: string, name: string, balance: number) =>
  ({ id: Number(code), code, name, accountType: "ASSET", currency: "IRR", balance }) as never;

test("prefix codes nest and balances roll up", () => {
  const roots = buildAccountTree([
    acc("1", "دارایی", 0),
    acc("11", "دارایی جاری", 0),
    acc("1101", "صندوق", 100),
    acc("1102", "بانک ملت", 250),
    acc("2", "بدهی", -40),
  ]);
  assert.equal(roots.length, 2);
  assert.equal(roots[0].rollup, 350);
  assert.equal(roots[0].children[0].children.length, 2);
  assert.equal(roots[0].children[0].children[1].depth, 2);
  assert.equal(roots[1].rollup, -40);
});

test("bank under receivables is flagged, bank elsewhere is not", () => {
  const roots = buildAccountTree([
    acc("11", "دارایی جاری", 0),
    acc("1103", "حساب‌های دریافتنی", 0),
    acc("110301", "بانک پاسارگاد", 10),
    acc("1102", "بانک ملت", 5),
  ]);
  assert.equal(countReview(roots), 1);
});

test("collapsing hides descendants", () => {
  const roots = buildAccountTree([acc("1", "a", 0), acc("11", "b", 0), acc("2", "c", 0)]);
  assert.deepEqual(
    visibleNodes(roots, new Set(["1"])).map((n) => n.account.code),
    ["1", "2"],
  );
});
