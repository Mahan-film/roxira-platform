import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateNationalIdChecksum,
  validateLegalEntityIdChecksum,
  validatePostalCodeFormat,
  validateVatRateForYear,
  validateItemTaxCode,
  runMoadianPreFlightValidation,
  toLatinDigits,
} from "./moadian-preflight.ts";
import type { InvoiceResponseDto } from "@/types/invoicing";

test("toLatinDigits normalises Persian and Arabic digits", () => {
  assert.equal(toLatinDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(toLatinDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
});

test("national ID checksum handles Persian and Latin digits", () => {
  assert.equal(validateNationalIdChecksum("0012345679"), true);
  assert.equal(validateNationalIdChecksum("۰۰۱۲۳۴۵۶۷۹"), true);
  assert.equal(validateNationalIdChecksum("0012345678"), false);
  assert.equal(validateNationalIdChecksum("1111111111"), false);
});

test("legal entity ID checksum handles 11-digit codes", () => {
  assert.equal(validateLegalEntityIdChecksum("10380284790"), true);
  assert.equal(validateLegalEntityIdChecksum("۱۰۳۸۰۲۸۴۷۹۰"), true);
  assert.equal(validateLegalEntityIdChecksum("10380284791"), false);
});

test("postal code format validation", () => {
  assert.equal(validatePostalCodeFormat("1985913111"), true);
  assert.equal(validatePostalCodeFormat("۱۹۸۵۹۱۳۱۱۱"), true);
  assert.equal(validatePostalCodeFormat("0123456789"), false); // starts with 0
  assert.equal(validatePostalCodeFormat("1985013111"), false); // 5th digit is 0
});

test("VAT rate validation for fiscal years", () => {
  assert.equal(validateVatRateForYear(0.1, 0.1).valid, true);
  assert.equal(validateVatRateForYear(0, 0.1).valid, true);
  assert.equal(validateVatRateForYear(0.09, 0.1).valid, false);
  assert.equal(validateVatRateForYear(0.09).valid, true);
  assert.equal(validateVatRateForYear(1.5).valid, false);
});

test("item SSTID validation", () => {
  assert.equal(validateItemTaxCode("2330001234567"), true);
  assert.equal(validateItemTaxCode("۲۳۳۰۰۰۱۲۳۴۵۶۷"), true);
  assert.equal(validateItemTaxCode("12345"), false);
});

test("runMoadianPreFlightValidation with fallback defaultSstid", () => {
  const inv = {
    id: "inv-1",
    taxInvoiceNumber: "TI-001",
    currency: "IRR",
    totalAmount: 10000,
    totalDiscount: 0,
    totalTax: 1000,
    finalPayable: 11000,
    issuedAt: "2026-11-10T12:00:00Z",
    sellerInfo: {
      name: "فروشنده",
      nationalId: "10380284790",
      postalCode: "1985913111",
    },
    buyerInfo: {
      name: "خریدار",
      nationalId: "0012345679",
      postalCode: "1456789123",
    },
    items: [
      {
        description: "آیتم ۱",
        quantity: 1,
        unitPrice: 10000,
        discount: 0,
        vatRate: 0.1,
        tax: 1000,
        total: 11000,
      },
    ],
  } as unknown as InvoiceResponseDto;

  // Without item taxCode and without defaultSstid: raises ITEM_SSTID_INVALID
  const preWithout = runMoadianPreFlightValidation(inv);
  assert.equal(preWithout.valid, false);
  assert.ok(preWithout.errors.some((e) => e.code === "ITEM_SSTID_INVALID"));

  // With options.defaultSstid: passes!
  const preWith = runMoadianPreFlightValidation(inv, { defaultSstid: "2330001234567" });
  assert.equal(preWith.valid, true);
  assert.equal(preWith.errors.length, 0);
});
