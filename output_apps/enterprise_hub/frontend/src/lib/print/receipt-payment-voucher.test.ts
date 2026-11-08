import assert from "node:assert/strict";
import test from "node:test";

import { RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE } from "../../print-templates/receipt-payment-voucher-a5.template.ts";
import type { TreasuryDocumentDetail } from "../../types/treasury.ts";
import { formatMethodDetail, mapTreasuryDocToPrintData } from "./receipt-payment-voucher.ts";
import { renderTemplate } from "./render-template.ts";

const fixture = (overrides: Partial<TreasuryDocumentDetail> = {}): TreasuryDocumentDetail => ({
  id: 101,
  kind: "receipt",
  docNumber: "REC-1405-001",
  docDate: "2026-11-05",
  partyType: "customer",
  partyCode: "10301",
  partyName: "شرکت بازرگانی فردا",
  total: "5500000",
  writeoffTotal: "0",
  advanceRemaining: "0",
  description: "تسویه فاکتور فروش",
  status: "posted",
  journalEntryId: 9001,
  methods: [
    {
      id: 1,
      method: "cash",
      amount: "1500000",
      cashBoxId: 10,
    },
    {
      id: 2,
      method: "bank_transfer",
      amount: "4000000",
      bankAccountId: 5,
      bankName: "ملت",
      reference: "TRX-889922",
    },
  ],
  allocations: [
    {
      id: 1,
      invoiceId: "inv-uuid-1",
      invoiceNumber: "INV-201",
      amount: "3000000",
      writeoff: "0",
      allocatedDate: "2026-11-05",
      journalEntryId: 9001,
    },
    {
      id: 2,
      invoiceId: "inv-uuid-2",
      invoiceNumber: "INV-202",
      amount: "2500000",
      writeoff: "0",
      allocatedDate: "2026-11-05",
      journalEntryId: 9001,
    },
  ],
  ...overrides,
});

test("maps receipt header, party, amounts and signatures accurately", () => {
  const data = mapTreasuryDocToPrintData(fixture(), "شرکت فناوری روکسیرا");
  assert.equal(data.docTitle, "رسید دریافت");
  assert.equal(data.documentNumber, "REC-1405-001");
  assert.equal(data.partyLabel, "دریافت از");
  assert.equal((data.party as { name: string; code: string }).name, "شرکت بازرگانی فردا");
  assert.equal((data.party as { name: string; code: string }).code, "10301");
  assert.equal(data.amount, "۵٬۵۰۰٬۰۰۰");
  assert.equal(data.currencyLabel, "ریال");
  assert.equal(data.amountInWords, "پنج میلیون و پانصد هزار");
  assert.equal(data.purpose, "تسویه فاکتور فروش");
  assert.equal(data.invoiceRefs, "INV-201، INV-202");
  assert.equal(data.voucherNumber, "9001");
  assert.equal(data.signerLeftLabel, "تحویل‌گیرنده وجه");
  assert.equal(data.signerRightLabel, "صندوق‌دار / مسئول مالی");
  assert.equal((data.company as { name: string }).name, "شرکت فناوری روکسیرا");
  assert.equal(data.isDraft, false);
});

test("maps payment header and counterparty labels for payment vouchers", () => {
  const paymentDoc = fixture({
    kind: "payment",
    docNumber: "PAY-1405-099",
    partyType: "supplier",
    partyName: "تأمین فولاد آریا",
    partyCode: "20401",
    description: null,
  });

  const data = mapTreasuryDocToPrintData(paymentDoc);
  assert.equal(data.docTitle, "رسید پرداخت");
  assert.equal(data.partyLabel, "پرداخت به");
  assert.equal((data.party as { name: string }).name, "تأمین فولاد آریا");
  assert.equal(data.signerLeftLabel, "دریافت‌کننده وجه");
  assert.equal(data.signerRightLabel, "تنظیم‌کننده");
  assert.equal(data.purpose, "تسویه حساب و پرداخت وجه");
});

test("formatMethodDetail handles diverse treasury instruments and references", () => {
  assert.equal(
    formatMethodDetail({
      id: 1,
      method: "bank_transfer",
      amount: 1000,
      bankName: "سامان",
      accountNumber: "849-800-112233-1",
      reference: "REV-901",
    }),
    "پیگیری: REV-901 | بانک: سامان | حساب: 849-800-112233-1",
  );

  assert.equal(
    formatMethodDetail({
      id: 2,
      method: "cheque",
      amount: 2000,
      chequeNumber: "CHK-7744",
      dueDate: "2026-11-05",
    }),
    "شماره چک: CHK-7744 | سررسید: ۱۴ آبان ۱۴۰۵",
  );

  assert.equal(
    formatMethodDetail({
      id: 3,
      method: "cash",
      amount: 500,
    }),
    "—",
  );
});

test("maps payment lines into the payments table with formatted amounts", () => {
  const data = mapTreasuryDocToPrintData(fixture());
  const rows = data.payments as Array<{ method: string; detail: string; amount: string }>;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].method, "نقد (صندوق)");
  assert.equal(rows[0].amount, "۱٬۵۰۰٬۰۰۰");
  assert.equal(rows[1].method, "واریز بانکی / حواله");
  assert.equal(rows[1].amount, "۴٬۰۰۰٬۰۰۰");
  assert.ok(rows[1].detail.includes("ملت"));
  assert.ok(rows[1].detail.includes("TRX-889922"));
  assert.equal(data.paymentsTotal, "۵٬۵۰۰٬۰۰۰");
});

test("renders template with draft watermark when draft status is active", () => {
  const draftDoc = fixture({ status: "draft" });
  const html = renderTemplate(RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE, mapTreasuryDocToPrintData(draftDoc));
  assert.ok(html.includes("class=\"is-draft\""));
  assert.ok(html.includes("پیش‌نویس"));
});

test("renders template without draft watermark when posted", () => {
  const postedDoc = fixture({ status: "posted" });
  const html = renderTemplate(RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE, mapTreasuryDocToPrintData(postedDoc));
  assert.ok(!html.includes("class=\"is-draft\""));
});

test("escapes HTML in user-entered fields safely", () => {
  const maliciousDoc = fixture({
    partyName: "<script>alert('xss')</script>",
    description: "توضیحات & <test>",
  });

  const html = renderTemplate(RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE, mapTreasuryDocToPrintData(maliciousDoc));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
});

test("full template render satisfies A5 layout with all required placeholders populated", () => {
  const html = renderTemplate(RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE, mapTreasuryDocToPrintData(fixture(), "شرکت نمونه"));
  assert.ok(html.includes("A5 landscape"));
  assert.ok(html.includes("REC-1405-001"));
  assert.ok(html.includes("شرکت بازرگانی فردا"));
  assert.ok(html.includes("پنج میلیون و پانصد هزار"));
  assert.ok(html.includes("INV-201، INV-202"));
  assert.ok(html.includes("تأییدکننده"));
});
