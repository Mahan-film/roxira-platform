import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildCloseChecklist,
  canConfirmClose,
  normalizeName,
  periodLockState,
  toPersianDigits,
} from "./fiscal-close.ts";

const allOk = buildCloseChecklist({ draftCount: 0, bankDifferences: [] });

test("buildCloseChecklist with no drafts and no bank accounts is all ok/unknown", () => {
  assert.deepEqual(
    buildCloseChecklist({ draftCount: 0, bankDifferences: [] }).map((i) => i.status),
    ["ok", "ok", "unknown"],
  );
});

test("buildCloseChecklist with drafts blocks drafts and keeps bank ok", () => {
  const items = buildCloseChecklist({
    draftCount: 3,
    bankDifferences: [{ accountName: "بانک ملی", difference: 0 }],
  });
  assert.deepEqual(items.map((i) => i.status), ["blocked", "ok", "unknown"]);
  assert.ok(items[0].detail.includes("۳"));
});

test("buildCloseChecklist with unavailable data is all unknown", () => {
  assert.deepEqual(
    buildCloseChecklist({ draftCount: null, bankDifferences: null }).map((i) => i.status),
    ["unknown", "unknown", "unknown"],
  );
});

test("buildCloseChecklist blocks bank with a non-zero difference", () => {
  const items = buildCloseChecklist({
    draftCount: 0,
    bankDifferences: [{ accountName: "بانک ملت", difference: 125000 }],
  });
  assert.equal(items[1].status, "blocked");
  assert.ok(items[1].detail.includes("بانک ملت"));
});

test("buildCloseChecklist is unknown when a bank difference is null", () => {
  const items = buildCloseChecklist({
    draftCount: 0,
    bankDifferences: [{ accountName: "بانک ملت", difference: null }],
  });
  assert.equal(items[1].status, "unknown");
});

test("canConfirmClose accepts persian digits typed against latin year name", () => {
  assert.equal(canConfirmClose(allOk, "۱۴۰۵", "1405"), true);
});

test("canConfirmClose trims typed name", () => {
  assert.equal(canConfirmClose(allOk, " ۱۴۰۵ ", "۱۴۰۵"), true);
});

test("canConfirmClose rejects a mismatched year name", () => {
  assert.equal(canConfirmClose(allOk, "۱۴۰۴", "۱۴۰۵"), false);
});

test("canConfirmClose rejects when any item is blocked", () => {
  const items = buildCloseChecklist({ draftCount: 2, bankDifferences: [] });
  assert.equal(canConfirmClose(items, "۱۴۰۵", "۱۴۰۵"), false);
});

test("canConfirmClose rejects empty year name", () => {
  assert.equal(canConfirmClose(allOk, "", ""), false);
});

test("toPersianDigits maps digits and handles zero and negatives", () => {
  assert.equal(toPersianDigits(0), "۰");
  assert.equal(toPersianDigits(-1405), "-۱۴۰۵");
  assert.equal(toPersianDigits(12), "۱۲");
});

test("normalizeName strips ZWNJ and converts persian digits", () => {
  assert.equal(normalizeName("۱۴۰۵‌۰۱"), "140501");
});

test("periodLockState locks on an active overlapping lock", () => {
  assert.equal(
    periodLockState([{ periodStart: "2026-03-21", periodEnd: "2027-03-20", active: true }], "2026-03-21", "2027-03-20"),
    "locked",
  );
});

test("periodLockState ignores inactive locks and empty lock lists", () => {
  assert.equal(
    periodLockState([{ periodStart: "2026-03-21", periodEnd: "2027-03-20", active: false }], "2026-03-21", "2027-03-20"),
    "open",
  );
  assert.equal(periodLockState([], "2026-03-21", "2027-03-20"), "open");
});

test("periodLockState is open for a non-overlapping lock", () => {
  assert.equal(
    periodLockState([{ periodStart: "2025-01-01", periodEnd: "2025-12-29", active: true }], "2026-03-21", "2027-03-20"),
    "open",
  );
});
