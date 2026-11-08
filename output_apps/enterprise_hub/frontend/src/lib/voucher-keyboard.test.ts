import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeBalancingAmount,
  getNextCellCoordinates,
} from "./voucher-keyboard.ts";

describe("computeBalancingAmount", () => {
  it("computes credit needed when debit is heavier", () => {
    const lines = [
      { debit: "15000000", credit: "" },
      { debit: "", credit: "" },
    ];
    const balanced = computeBalancingAmount(lines, 1);
    assert.deepEqual(balanced, { debit: "", credit: "15000000" });
  });

  it("computes debit needed when credit is heavier", () => {
    const lines = [
      { debit: "", credit: "25000000" },
      { debit: "", credit: "" },
    ];
    const balanced = computeBalancingAmount(lines, 1);
    assert.deepEqual(balanced, { debit: "25000000", credit: "" });
  });

  it("computes balancing across multiple split lines", () => {
    const lines = [
      { debit: "100000000", credit: "" },
      { debit: "", credit: "60000000" },
      { debit: "", credit: "" },
    ];
    // Target is line 2 (3rd line): needs credit 40,000,000
    const balanced = computeBalancingAmount(lines, 2);
    assert.deepEqual(balanced, { debit: "", credit: "40000000" });
  });

  it("computes balancing when target already has an old amount to overwrite", () => {
    const lines = [
      { debit: "50000000", credit: "" },
      { debit: "10000", credit: "" }, // user wants to auto-balance this row
    ];
    const balanced = computeBalancingAmount(lines, 1);
    assert.deepEqual(balanced, { debit: "", credit: "50000000" });
  });

  it("returns empty strings when ledger is already balanced", () => {
    const lines = [
      { debit: "10000", credit: "" },
      { debit: "", credit: "10000" },
      { debit: "", credit: "" },
    ];
    const balanced = computeBalancingAmount(lines, 2);
    assert.deepEqual(balanced, { debit: "", credit: "" });
  });
});

describe("getNextCellCoordinates", () => {
  it("navigates account (col 0) -> debit (col 1)", () => {
    const next = getNextCellCoordinates(0, 0, 2, false, "next");
    assert.deepEqual(next, { row: 0, col: 1 });
  });

  it("skips credit (col 2) directly to description (col 3) when debit is non-empty", () => {
    const next = getNextCellCoordinates(0, 1, 2, true, "next");
    assert.deepEqual(next, { row: 0, col: 3 });
  });

  it("moves to credit (col 2) when debit is empty", () => {
    const next = getNextCellCoordinates(0, 1, 2, false, "next");
    assert.deepEqual(next, { row: 0, col: 2 });
  });

  it("moves credit (col 2) -> description (col 3)", () => {
    const next = getNextCellCoordinates(0, 2, 2, false, "next");
    assert.deepEqual(next, { row: 0, col: 3 });
  });

  it("moves description (col 3) to next row account (col 0) when not on last row", () => {
    const next = getNextCellCoordinates(0, 3, 2, false, "next");
    assert.deepEqual(next, { row: 1, col: 0 });
  });

  it("signals shouldAddRow when pressing next on last row description", () => {
    const next = getNextCellCoordinates(1, 3, 2, false, "next");
    assert.deepEqual(next, { row: 2, col: 0, shouldAddRow: true });
  });

  it("navigates backwards with prev", () => {
    assert.deepEqual(getNextCellCoordinates(1, 0, 2, false, "prev"), { row: 0, col: 3 });
    assert.deepEqual(getNextCellCoordinates(0, 3, 2, false, "prev"), { row: 0, col: 2 });
    assert.deepEqual(getNextCellCoordinates(0, 2, 2, false, "prev"), { row: 0, col: 1 });
    assert.deepEqual(getNextCellCoordinates(0, 1, 2, false, "prev"), { row: 0, col: 0 });
  });

  it("navigates down and up rows maintaining column", () => {
    assert.deepEqual(getNextCellCoordinates(0, 1, 3, false, "down"), { row: 1, col: 1 });
    assert.deepEqual(getNextCellCoordinates(1, 1, 3, false, "down"), { row: 2, col: 1 });
    assert.deepEqual(getNextCellCoordinates(2, 1, 3, false, "down"), { row: 2, col: 1 }); // clamp
    assert.deepEqual(getNextCellCoordinates(2, 1, 3, false, "up"), { row: 1, col: 1 });
    assert.deepEqual(getNextCellCoordinates(0, 1, 3, false, "up"), { row: 0, col: 1 }); // clamp
  });
});
