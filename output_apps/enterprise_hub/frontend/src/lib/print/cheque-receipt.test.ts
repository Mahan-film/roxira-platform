import assert from "node:assert/strict";
import { test } from "node:test";

import { CHEQUE_RECEIPT_A5_TEMPLATE } from "../../print-templates/cheque-receipt-a5.template.ts";
import type { Cheque } from "../../types/cheques.ts";

import { mapChequeToReceiptData } from "./cheque-receipt.ts";
import { renderTemplate } from "./render-template.ts";

const fixture = (overrides: Partial<Cheque> = {}): Cheque =>
  ({
    id: 1,
    direction: "received",
    sayadNumber: "1234567890123456",
    sayadVerified: false,
    sayadRegistrationStatus: "unknown",
    sayadVerifiedBy: null,
    sayadVerifiedAt: null,
    receiverNationalId: null,
    chequeNumber: "458123",
    bankName: "بانک ملی",
    amount: 1100000,
    issueDate: "2026-11-05",
    dueDate: "2026-11-05",
    partyName: "علی رضایی",
    partyCode: null,
    spentToName: null,
    spentToCode: null,
    spentToNationalId: null,
    settledAmount: 0,
    remainingAmount: 1100000,
    status: "registered",
    allowedNext: [],
    description: null,
    ...overrides,
  }) as Cheque;

const printed = (cheque: Cheque) => renderTemplate(CHEQUE_RECEIPT_A5_TEMPLATE, mapChequeToReceiptData(cheque));

type Row = { row: string; number: string; sayadId: string; bank: string; dueDateJalali: string; amount: string; status: string };

test("maps the header, party and the single cheque row", () => {
  const data = mapChequeToReceiptData(fixture());
  const row = (data.cheques as Row[])[0];
  assert.equal(data.directionLabel, "رسید دریافت چک");
  assert.equal(data.partyLabel, "دریافت از");
  assert.equal((data.party as { name: string }).name, "علی رضایی");
  assert.equal(data.chequeCount, "۱");
  assert.equal(data.total, "۱٬۱۰۰٬۰۰۰");
  assert.equal(data.currencyLabel, "ریال");
  assert.equal(row.row, "۱");
  assert.equal(row.number, "458123");
  assert.equal(row.sayadId, "1234567890123456");
  assert.equal(row.bank, "بانک ملی");
  assert.equal(row.amount, "۱٬۱۰۰٬۰۰۰");
  assert.equal(row.status, "نزد صندوق");
});

test("an issued cheque gets the payment labels", () => {
  const data = mapChequeToReceiptData(fixture({ direction: "issued", status: "delivered" }));
  assert.equal(data.directionLabel, "رسید پرداخت چک");
  assert.equal(data.partyLabel, "پرداخت به");
  const row = (data.cheques as Row[])[0];
  assert.equal(row.status, "تحویل‌شده به ذی‌نفع");
});

test("renders the amount in words", () => {
  const data = mapChequeToReceiptData(fixture());
  assert.equal(data.totalInWords, "یک میلیون و صد هزار");
});

test("amount in words is built from the integer part of a decimal-string amount", () => {
  const data = mapChequeToReceiptData(fixture({ amount: "1100000.00" }));
  assert.equal(data.totalInWords, "یک میلیون و صد هزار");
  assert.equal(data.total, "۱٬۱۰۰٬۰۰۰");
});

test("shows the due date in Jalali", () => {
  const data = mapChequeToReceiptData(fixture());
  const row = (data.cheques as Row[])[0];
  // 2026-11-05 is ۱۴ آبان ۱۴۰۵ in the Jalali calendar.
  assert.equal(row.dueDateJalali, "۱۴ آبان ۱۴۰۵");
});

test("the Sayad id appears when present and is empty when absent", () => {
  const row = (mapChequeToReceiptData(fixture()).cheques as Row[])[0];
  assert.equal(row.sayadId, "1234567890123456");
  assert.ok(printed(fixture()).includes("1234567890123456"));

  const without = (mapChequeToReceiptData(fixture({ sayadNumber: null })).cheques as Row[])[0];
  assert.equal(without.sayadId, "");
  assert.equal(printed(fixture({ sayadNumber: null })).includes("1234567890123456"), false);
});

test("fields the API does not carry stay empty", () => {
  const data = mapChequeToReceiptData(fixture());
  const row = (data.cheques as Row[])[0] as Row & { branch: string; owner: string; accountNumber: string };
  assert.equal(data.receiptNumber, "");
  assert.equal(data.dateJalali, "");
  assert.equal((data.party as { nationalId: string }).nationalId, "");
  assert.equal(data.purpose, "");
  assert.equal(data.invoiceRefs, "");
  assert.equal((data.company as { name: string }).name, "");
  assert.equal(row.branch, "");
  assert.equal(row.owner, "");
  assert.equal(row.accountNumber, "");
});

test("fills every placeholder of the real template", () => {
  const html = printed(fixture());
  assert.equal(html.includes("{{"), false);
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes("علی رضایی"));
});

test("escapes user text through the renderer", () => {
  const html = printed(fixture({ partyName: "<b>x</b>" }));
  assert.equal(html.includes("<b>x</b>"), false);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
});
