import assert from "node:assert/strict";
import test from "node:test";

import {
  canChangeToDraft,
  canChangeToTemporary,
  canCopyVoucher,
  canEditVoucher,
  canPostVoucher,
  canReverseVoucher,
  formatReversalDescription,
  getVoucherAvailableActions,
} from "./voucher-actions.ts";

test("canChangeToDraft allows only TEMPORARY vouchers", () => {
  assert.equal(canChangeToDraft("TEMPORARY"), true);
  assert.equal(canChangeToDraft("DRAFT"), false);
  assert.equal(canChangeToDraft("POSTED"), false);
  assert.equal(canChangeToDraft("VOID"), false);
});

test("canChangeToTemporary allows only DRAFT vouchers", () => {
  assert.equal(canChangeToTemporary("DRAFT"), true);
  assert.equal(canChangeToTemporary("TEMPORARY"), false);
  assert.equal(canChangeToTemporary("POSTED"), false);
  assert.equal(canChangeToTemporary("VOID"), false);
});

test("canPostVoucher allows DRAFT and TEMPORARY vouchers but not POSTED or VOID", () => {
  assert.equal(canPostVoucher("DRAFT"), true);
  assert.equal(canPostVoucher("TEMPORARY"), true);
  assert.equal(canPostVoucher("POSTED"), false);
  assert.equal(canPostVoucher("VOID"), false);
});

test("canReverseVoucher allows only POSTED vouchers", () => {
  assert.equal(canReverseVoucher("POSTED"), true);
  assert.equal(canReverseVoucher("DRAFT"), false);
  assert.equal(canReverseVoucher("TEMPORARY"), false);
  assert.equal(canReverseVoucher("VOID"), false);
});

test("canEditVoucher permits non-final vouchers", () => {
  assert.equal(canEditVoucher("DRAFT"), true);
  assert.equal(canEditVoucher("TEMPORARY"), true);
  assert.equal(canEditVoucher("POSTED"), false);
  assert.equal(canEditVoucher("VOID"), false);
});

test("canCopyVoucher permits any non-void voucher", () => {
  assert.equal(canCopyVoucher("DRAFT"), true);
  assert.equal(canCopyVoucher("TEMPORARY"), true);
  assert.equal(canCopyVoucher("POSTED"), true);
  assert.equal(canCopyVoucher("VOID"), false);
});

test("getVoucherAvailableActions returns comprehensive matrix per status", () => {
  assert.deepEqual(getVoucherAvailableActions("DRAFT"), {
    canDraft: false,
    canTemporary: true,
    canPost: true,
    canReverse: false,
    canEdit: true,
    canCopy: true,
  });

  assert.deepEqual(getVoucherAvailableActions("TEMPORARY"), {
    canDraft: true,
    canTemporary: false,
    canPost: true,
    canReverse: false,
    canEdit: true,
    canCopy: true,
  });

  assert.deepEqual(getVoucherAvailableActions("POSTED"), {
    canDraft: false,
    canTemporary: false,
    canPost: false,
    canReverse: true,
    canEdit: false,
    canCopy: true,
  });
});

test("formatReversalDescription handles optional reason gracefully", () => {
  assert.equal(formatReversalDescription("1042"), "برگشت سند شماره 1042");
  assert.equal(formatReversalDescription("1042", "   "), "برگشت سند شماره 1042");
  assert.equal(formatReversalDescription("1042", "اشتباه در سرفصل بدهکار"), "برگشت سند شماره 1042 — اشتباه در سرفصل بدهکار");
});
