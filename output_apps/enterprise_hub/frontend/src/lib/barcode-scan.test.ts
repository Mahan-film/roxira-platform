import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addScannedItem,
  findExact,
  incrementQuantity,
  normaliseScan,
  unknownBarcodeMessage,
  type ScanLineOps,
} from "./barcode-scan.ts";

interface Line {
  code: string;
  quantity: string;
}

const ops: ScanLineOps<Line> = {
  codeOf: (l) => l.code,
  isBlank: (l) => l.code === "",
  addOne: (l) => ({ ...l, quantity: incrementQuantity(l.quantity) }),
  fromItem: (item) => ({ code: item.sku, quantity: "1" }),
};
const pen = { sku: "P-1", barcode: "6260000000011", name: "خودکار" };
const ink = { sku: "6260000000011", barcode: "999", name: "جوهر" };

test("normaliseScan folds Persian and Arabic digits and trims", () => {
  assert.equal(normaliseScan(" ۶۲۶٠٠١ "), "626001");
});

test("findExact prefers an item code over another item's barcode", () => {
  assert.equal(findExact([pen, ink], "6260000000011"), ink);
  assert.equal(findExact([pen], "6260000000011"), pen);
  assert.equal(findExact([pen, ink], "62600"), null);
});

test("scanning fills the blank line, then adds a unit, then appends", () => {
  let lines: Line[] = [{ code: "", quantity: "1" }];
  lines = addScannedItem(lines, pen, ops);
  assert.deepEqual(lines, [{ code: "P-1", quantity: "1" }]);
  lines = addScannedItem(lines, pen, ops);
  assert.deepEqual(lines, [{ code: "P-1", quantity: "2" }]);
  lines = addScannedItem(lines, ink, ops);
  assert.deepEqual(lines, [
    { code: "P-1", quantity: "2" },
    { code: "6260000000011", quantity: "1" },
  ]);
});

test("incrementQuantity handles Persian digits and junk", () => {
  assert.equal(incrementQuantity("۲"), "3");
  assert.equal(incrementQuantity("abc"), "1");
});

test("the unknown-barcode message names the code", () => {
  assert.match(unknownBarcodeMessage("123"), /«123»/);
});
