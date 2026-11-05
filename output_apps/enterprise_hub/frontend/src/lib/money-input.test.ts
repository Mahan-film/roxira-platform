import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendZeros,
  applyMoneyEdit,
  describeRials,
  formatGroupedRials,
  normalizeMoneyDigits,
  rialsToToman,
} from "./money-input.ts";

test("normalize accepts Persian digits and separators, never decimals", () => {
  assert.equal(normalizeMoneyDigits("۱۲٬۵۰۰٬۰۰۰"), "12500000");
  assert.equal(normalizeMoneyDigits("0012"), "12");
  assert.equal(normalizeMoneyDigits("000"), "0");
  assert.equal(normalizeMoneyDigits("12.5"), "125");
  assert.equal(normalizeMoneyDigits("-5"), "5");
  assert.equal(normalizeMoneyDigits(""), "");
  assert.equal(normalizeMoneyDigits("1".repeat(25)), "1".repeat(18));
});

test("000 and 0000 shortcuts", () => {
  assert.equal(appendZeros("5", 3), "5000");
  assert.equal(appendZeros("5", 4), "50000");
  assert.equal(appendZeros("", 3), "");
  assert.equal(appendZeros("0", 3), "0");
  assert.equal(appendZeros("1".repeat(17), 3), "1".repeat(17));
});

test("grouped rials", () => {
  assert.equal(formatGroupedRials("12500000"), "۱۲٬۵۰۰٬۰۰۰");
  assert.equal(formatGroupedRials("0"), "۰");
  assert.equal(formatGroupedRials(""), "");
});

test("toman is exact: one toman is ten rials", () => {
  assert.equal(rialsToToman("12500000"), "۱٬۲۵۰٬۰۰۰");
  assert.equal(rialsToToman("12345"), "۱٬۲۳۴٫۵");
  assert.equal(rialsToToman("12347"), "۱٬۲۳۴٫۷");
  assert.equal(rialsToToman("0"), "۰");
  assert.equal(rialsToToman("7"), "۰٫۷");
  assert.equal(rialsToToman(""), "");
});

test("helper shows toman and words, including zero and huge amounts", () => {
  assert.deepEqual(describeRials("12500000"), {
    toman: "۱٬۲۵۰٬۰۰۰ تومان",
    words: "دوازده میلیون و پانصد هزار ریال",
  });
  assert.deepEqual(describeRials("0"), { toman: "۰ تومان", words: "صفر ریال" });
  assert.deepEqual(describeRials("1000000000000"), {
    toman: "۱۰۰٬۰۰۰٬۰۰۰٬۰۰۰ تومان",
    words: "هزار میلیارد ریال",
  });
  assert.equal(describeRials(""), null);
});

test("edits keep the caret next to the same digit", () => {
  assert.deepEqual(applyMoneyEdit("1250", 4), { digits: "1250", text: "۱٬۲۵۰", caret: 5 });
  assert.deepEqual(applyMoneyEdit("12345", 2), { digits: "12345", text: "۱۲٬۳۴۵", caret: 2 });
  assert.deepEqual(applyMoneyEdit("", 0), { digits: "", text: "", caret: 0 });
});
