import assert from "node:assert/strict";
import { test } from "node:test";

import type { Cheque } from "../types/cheques.ts";
import { InvoiceDirection, InvoiceStatus, type InvoiceResponseDto } from "../types/invoicing.ts";
import {
  partyOpenBalance,
  partyReceipts,
  partyReceivedCheques,
  partySaleInvoices,
} from "./customer-party.ts";

function inv(over: Partial<InvoiceResponseDto>): InvoiceResponseDto {
  return {
    id: "x", taxInvoiceNumber: "1", customerId: 7, direction: InvoiceDirection.SALE,
    status: InvoiceStatus.ISSUED, finalPayable: 0, createdAt: "2026-01-01", issuedAt: null, paidAt: null,
    ...over,
  } as InvoiceResponseDto;
}

test("sale invoices are filtered to the customer and sorted newest first", () => {
  const list = [
    inv({ id: "a", createdAt: "2026-01-02" }),
    inv({ id: "b", customerId: 8 }),
    inv({ id: "c", direction: InvoiceDirection.PURCHASE }),
    inv({ id: "d", createdAt: "2026-03-01" }),
  ];
  assert.deepEqual(partySaleInvoices(list, 7).map((i) => i.id), ["d", "a"]);
});

test("receipts are paid sale invoices by payment date", () => {
  const sales = [
    inv({ id: "a", status: InvoiceStatus.PAID, paidAt: "2026-02-01" }),
    inv({ id: "b", status: InvoiceStatus.PAID, paidAt: "2026-04-01" }),
    inv({ id: "c", status: InvoiceStatus.ISSUED }),
  ];
  assert.deepEqual(partyReceipts(sales).map((i) => i.id), ["b", "a"]);
});

test("balance sums only issued, unpaid sale invoices", () => {
  const sales = [
    inv({ finalPayable: 1000 }),
    inv({ finalPayable: 250 }),
    inv({ status: InvoiceStatus.PAID, finalPayable: 9999 }),
    inv({ status: InvoiceStatus.DRAFT, finalPayable: 5 }),
  ];
  assert.deepEqual(partyOpenBalance(sales), { total: 1250, count: 2 });
});

test("received cheques match the customer's person or company name only", () => {
  const cheque = (over: Partial<Cheque>) => ({ id: 1, direction: "received", partyName: "", ...over }) as Cheque;
  const cheques = [
    cheque({ id: 1, partyName: " علی رضایی " }),
    cheque({ id: 2, partyName: "شرکت پارس" }),
    cheque({ id: 3, partyName: "علی رضایی", direction: "issued" }),
    cheque({ id: 4, partyName: "شخص دیگر" }),
  ];
  const ids = partyReceivedCheques(cheques, { fullName: "علی رضایی", company: "شرکت پارس" }).map((c) => c.id);
  assert.deepEqual(ids, [1, 2]);
  assert.deepEqual(partyReceivedCheques(cheques, { fullName: " ", company: null }), []);
});
