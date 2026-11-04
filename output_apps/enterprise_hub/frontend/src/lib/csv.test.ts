import assert from "node:assert/strict";
import { test } from "node:test";

import { foldDigits, parseCsv } from "./csv.ts";

test("reads quoted cells, escaped quotes, CRLF and a BOM", () => {
  const rows = parseCsv('﻿sku,name,quantity\r\nA-1,"کالا, با ویرگول",5\r\nB-2,"say ""hi""",\r\n');
  assert.deepEqual(rows, [
    ["sku", "name", "quantity"],
    ["A-1", "کالا, با ویرگول", "5"],
    ["B-2", 'say "hi"', ""],
  ]);
});

test("skips blank lines and keeps empty trailing cells", () => {
  assert.deepEqual(parseCsv("a,b,\n\n,,\nc,,d"), [["a", "b", ""], ["c", "", "d"]]);
});

test("folds Persian and Arabic digits and separators", () => {
  assert.equal(foldDigits("۱٬۲۳۴٫۵"), "1234.5");
  assert.equal(foldDigits("٣٠"), "30");
});
