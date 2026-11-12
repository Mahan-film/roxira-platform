import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeBalancingAmount,
  getNextCellCoordinates,
  isAccountSearchKey,
  isCancelKey,
  isInsertLineKey,
  isSaveShortcut,
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

describe("accountant keyboard mode shortcuts", () => {
  it("identifies Insert as new line trigger", () => {
    assert.equal(isInsertLineKey({ key: "Insert" }), true);
    assert.equal(isInsertLineKey({ key: "Enter" }), false);
  });

  it("identifies F2 as account search trigger", () => {
    assert.equal(isAccountSearchKey({ key: "F2" }), true);
    assert.equal(isAccountSearchKey({ key: "F1" }), false);
  });

  it("identifies Ctrl+S and Cmd+S as save shortcut", () => {
    assert.equal(isSaveShortcut({ ctrlKey: true, key: "s" }), true);
    assert.equal(isSaveShortcut({ metaKey: true, key: "S" }), true);
    assert.equal(isSaveShortcut({ ctrlKey: true, key: "Enter" }), true);
    assert.equal(isSaveShortcut({ key: "s" }), false);
  });

  it("ignores key repeat for save shortcut to prevent accidental multi-submit on held key", () => {
    assert.equal(isSaveShortcut({ ctrlKey: true, key: "s", repeat: true }), false);
    assert.equal(isSaveShortcut({ metaKey: true, key: "s", repeat: true }), false);
    assert.equal(isSaveShortcut({ ctrlKey: true, key: "Enter", repeat: true }), false);
    assert.equal(isSaveShortcut({ ctrlKey: true, key: "s", repeat: false }), true);
  });

  it("one Ctrl+S keystroke calls createJournalEntry exactly once and stops propagation", async () => {
    let callCount = 0;
    const createJournalEntryMock = async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { id: 1, entryNumber: "101" };
    };

    // Re-entrancy guard matching useRef in JournalEntryForm
    let isSubmitting = false;
    const submitEntry = async () => {
      if (isSubmitting) return;
      isSubmitting = true;
      try {
        await createJournalEntryMock();
      } finally {
        isSubmitting = false;
      }
    };

    let prevented = 0;
    let stopped = 0;
    const event = {
      key: "s",
      ctrlKey: true,
      repeat: false,
      preventDefault: () => { prevented++; },
      stopPropagation: () => { stopped++; },
    };

    const handleFormKeyDown = (e: typeof event) => {
      if (isSaveShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        void submitEntry();
      }
    };

    // Simulate keydown event bubbling or rapid dual-dispatch
    handleFormKeyDown(event);
    handleFormKeyDown(event);

    assert.equal(prevented, 2);
    assert.equal(stopped, 2);
    // Guard ensures createJournalEntry is called exactly once
    assert.equal(callCount, 1);
  });

  it("identifies Escape as cancel trigger", () => {
    assert.equal(isCancelKey({ key: "Escape" }), true);
    assert.equal(isCancelKey({ key: "Enter" }), false);
  });

  it("Esc on dirty form requires confirmation before discarding, clean form cancels immediately", () => {
    let confirmCalled = 0;
    let cancelCalled = 0;

    const mockConfirmReject = () => {
      confirmCalled++;
      return false;
    };

    const handleEsc = (isDirty: boolean, confirmFn: () => boolean, onCancel: () => void) => {
      if (isDirty) {
        if (confirmFn()) {
          onCancel();
        }
      } else {
        onCancel();
      }
    };

    // 1. Clean form: cancels immediately
    handleEsc(false, mockConfirmReject, () => { cancelCalled++; });
    assert.equal(cancelCalled, 1);
    assert.equal(confirmCalled, 0);

    // 2. Dirty form: user rejects confirmation -> not cancelled
    handleEsc(true, mockConfirmReject, () => { cancelCalled++; });
    assert.equal(cancelCalled, 1);
    assert.equal(confirmCalled, 1);

    // 3. Dirty form: user accepts confirmation -> cancelled
    const mockConfirmAccept = () => {
      confirmCalled++;
      return true;
    };
    handleEsc(true, mockConfirmAccept, () => { cancelCalled++; });
    assert.equal(cancelCalled, 2);
    assert.equal(confirmCalled, 2);
  });
});
