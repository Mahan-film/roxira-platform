import test from "node:test";
import assert from "node:assert/strict";
import { formatMinorMoney, formatQuantity, formatWeight } from "../components/purchasing/purchasing-format.ts";

test("formatMinorMoney formats bigint minor units string into Rial string", () => {
  // 5000000 minor units = 50,000 rials
  const formatted = formatMinorMoney("5000000");
  assert.match(formatted, /۵۰٬۰۰۰\s*ریال/);

  // 0 minor units
  assert.match(formatMinorMoney("0"), /۰\s*ریال/);

  // null or empty
  assert.equal(formatMinorMoney(null), "—");
  assert.equal(formatMinorMoney(""), "—");
});

test("formatQuantity converts hundredths to standard quantity representation", () => {
  // "1000" hundredths = 10
  assert.match(formatQuantity("1000"), /۱۰/);

  // "450" hundredths = 4.5
  assert.match(formatQuantity("450"), /۴٫۵/);

  // null or empty
  assert.equal(formatQuantity(null), "—");
  assert.equal(formatQuantity(""), "—");
});

test("formatWeight converts thousandths of kg to kilograms", () => {
  // "1500" = 1.5 kg
  assert.match(formatWeight("1500"), /۱٫۵\s*کیلوگرم/);

  // null or empty
  assert.equal(formatWeight(null), "—");
  assert.equal(formatWeight(""), "—");
});
