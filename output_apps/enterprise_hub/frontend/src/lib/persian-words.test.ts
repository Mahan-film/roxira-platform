import assert from "node:assert/strict";
import { test } from "node:test";

import { integerToPersianWords } from "./persian-words.ts";

const CASES: Array<[string, string]> = [
  ["0", "صفر"],
  ["7", "هفت"],
  ["15", "پانزده"],
  ["21", "بیست و یک"],
  ["100", "صد"],
  ["101", "صد و یک"],
  ["999", "نهصد و نود و نه"],
  ["1000", "هزار"],
  ["1001", "هزار و یک"],
  ["2000", "دو هزار"],
  ["12500", "دوازده هزار و پانصد"],
  ["1000000", "یک میلیون"],
  ["1001000", "یک میلیون و هزار"],
  ["12500000", "دوازده میلیون و پانصد هزار"],
  ["1234567", "یک میلیون و دویست و سی و چهار هزار و پانصد و شصت و هفت"],
  ["1000000000", "یک میلیارد"],
  ["25000000000", "بیست و پنج میلیارد"],
  ["1000000000000", "هزار میلیارد"],
  ["1500000000000", "هزار و پانصد میلیارد"],
  ["9007199254740993", "نه میلیون و هفت هزار و صد و نود و نه میلیارد و دویست و پنجاه و چهار میلیون و هفتصد و چهل هزار و نهصد و نود و سه"],
  ["۱۲۵۰۰", "دوازده هزار و پانصد"],
];

test("words for zero, hundreds, thousands, millions, milliards and beyond", () => {
  for (const [input, expected] of CASES) {
    assert.equal(integerToPersianWords(input), expected, input);
  }
});

test("bigint input matches string input and large values keep every digit", () => {
  assert.equal(integerToPersianWords(BigInt(12500000)), "دوازده میلیون و پانصد هزار");
  assert.equal(
    integerToPersianWords(BigInt("9007199254740993")),
    integerToPersianWords("9007199254740993"),
  );
});

test("non-digit and negative input throws", () => {
  assert.throws(() => integerToPersianWords("abc"), RangeError);
  assert.throws(() => integerToPersianWords("-5"), RangeError);
  assert.throws(() => integerToPersianWords(-BigInt(5)), RangeError);
});
