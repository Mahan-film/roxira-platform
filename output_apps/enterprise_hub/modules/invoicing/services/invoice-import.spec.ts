import 'reflect-metadata';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import {
  groupInvoiceRows,
  InvoiceImportLookups,
  InvoiceImportRow,
} from './invoice-import';

const TENANT_PARTIES: InvoiceImportLookups = {
  partyByCode: new Map([
    ['CUST-1', { id: 1, code: 'CUST-1', name: 'آرش نمونه' }],
    ['SUPP-1', { id: 2, code: 'SUPP-1', name: 'شهاب تأمین' }],
  ]),
  existingSkus: new Set(['ITM-1', 'ITM-2']),
};

const row = (over: Partial<InvoiceImportRow>): InvoiceImportRow => ({
  rowNumber: 2,
  number: 'INV-1',
  type: 'فروش',
  date: '2024-04-01',
  partyCode: 'CUST-1',
  itemCode: 'ITM-1',
  quantity: 2,
  unitPrice: 18625000,
  amount: 37250000,
  vat: 3725000,
  totalRial: 40975000,
  currency: 'IRR',
  fxRate: 1,
  ...over,
});

describe('groupInvoiceRows', () => {
  it('accepts decimals that binary floating point cannot scale exactly', () => {
    const [money] = groupInvoiceRows([
      row({ rowNumber: 2, number: 'INV-D1', quantity: 1, unitPrice: 19.99, amount: 19.99, vat: 0, totalRial: 19.99 }),
    ], TENANT_PARTIES);
    expect(money.valid).toBe(true);
    expect(money.lines[0].unitPriceMinor).toBe(1999n);
    const [qty] = groupInvoiceRows([
      row({ rowNumber: 3, number: 'INV-D2', quantity: 1.1, unitPrice: 100, amount: 110, vat: 0, totalRial: 110 }),
    ], TENANT_PARTIES);
    expect(qty.valid).toBe(true);
    expect(qty.lines[0].quantity).toBe(1.1);
  });

  it('groups rows of one number into one multi-line invoice', () => {
    const plans = groupInvoiceRows([
      row({ rowNumber: 2, itemCode: 'ITM-1', quantity: 2, unitPrice: 1000, amount: 2000, vat: 200, totalRial: 2200 }),
      row({ rowNumber: 3, itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5500 }),
    ], TENANT_PARTIES);

    expect(plans).toHaveLength(1);
    expect(plans[0].invoiceNumber).toBe('INV-1');
    expect(plans[0].direction).toBe(InvoiceDirection.SALE);
    expect(plans[0].date).toEqual(new Date(Date.UTC(2024, 3, 1)));
    expect(plans[0].currency).toBe(Currency.IRR);
    expect(plans[0].valid).toBe(true);
    expect(plans[0].lines.map((line) => line.sku)).toEqual(['ITM-1', 'ITM-2']);
    expect(plans[0].lines[0]).toMatchObject({
      rowNumber: 2,
      unitPriceMinor: 100000n,
      amountMinor: 200000n,
      vatMinor: 20000n,
      totalMinor: 220000n,
      vatRate: 0.1,
      quantity: 2,
    });
  });

  it('counts an exact repeat once and reports it as a duplicate line', () => {
    const repeat = row({ rowNumber: 2, itemCode: 'ITM-1', quantity: 2, unitPrice: 1000, amount: 2000, vat: 200, totalRial: 2200 });
    const plans = groupInvoiceRows([
      repeat,
      row({ rowNumber: 3, itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5500 }),
      { ...repeat, rowNumber: 9 },
    ], TENANT_PARTIES);

    expect(plans).toHaveLength(1);
    expect(plans[0].lines.map((line) => line.rowNumber)).toEqual([2, 3]);
    expect(plans[0].duplicateRows).toEqual([{ rowNumber: 9, ofRowNumber: 2 }]);
    expect(plans[0].rowNumbers).toEqual([2, 3, 9]);
    expect(plans[0].valid).toBe(true);
  });

  it('maps خرید to a real PURCHASE invoice', () => {
    const plans = groupInvoiceRows([
      row({ type: 'خرید', partyCode: 'SUPP-1', itemCode: 'ITM-1', quantity: 3, unitPrice: 10000, amount: 30000, vat: 3000, totalRial: 33000 }),
    ], TENANT_PARTIES);

    expect(plans[0].direction).toBe(InvoiceDirection.PURCHASE);
    expect(plans[0].party?.name).toBe('شهاب تأمین');
    expect(plans[0].walkIn).toBe(false);
  });

  it('accepts SALE/PURCHASE spellings too', () => {
    const plans = groupInvoiceRows([
      row({ type: 'SALE' }),
      row({ number: 'INV-2', rowNumber: 3, type: 'PURCHASE', partyCode: 'SUPP-1' }),
    ], TENANT_PARTIES);

    expect(plans[0].direction).toBe(InvoiceDirection.SALE);
    expect(plans[1].direction).toBe(InvoiceDirection.PURCHASE);
  });

  it('fails a row with an unknown or blank type', () => {
    const plans = groupInvoiceRows([row({ type: 'برگشتی' }), row({ rowNumber: 3, type: '' })], TENANT_PARTIES);

    expect(plans[0].valid).toBe(false);
    expect(plans[0].rowErrors.get(2)).toContain('شناخته نمی‌شود');
    expect(plans[0].rowErrors.get(3)).toContain('شناخته نمی‌شود');
  });

  it('fails a row whose party code is unknown, with a Persian message and no placeholder name', () => {
    const plans = groupInvoiceRows([row({ partyCode: 'CUST-404' })], TENANT_PARTIES);

    expect(plans[0].valid).toBe(false);
    expect(plans[0].rowErrors.get(2)).toContain('طرف حساب با کد «CUST-404»');
  });

  it('treats a blank party on a sale as the walk-in customer and on a purchase as a failure', () => {
    const sale = groupInvoiceRows([row({ partyCode: '' })], TENANT_PARTIES);
    const purchase = groupInvoiceRows([row({ rowNumber: 5, type: 'خرید', partyCode: '' })], TENANT_PARTIES);

    expect(sale[0].walkIn).toBe(true);
    expect(sale[0].valid).toBe(true);
    expect(sale[0].party).toBeNull();
    expect(purchase[0].valid).toBe(false);
    expect(purchase[0].rowErrors.get(5)).toContain('تأمین‌کننده');
  });

  it('fails a row whose item code is unknown or blank', () => {
    const unknown = groupInvoiceRows([row({ itemCode: 'ITM-404' })], TENANT_PARTIES);
    const blank = groupInvoiceRows([row({ rowNumber: 4, itemCode: '' })], TENANT_PARTIES);

    expect(unknown[0].rowErrors.get(2)).toContain('کالای انبار با کد «ITM-404»');
    expect(blank[0].rowErrors.get(4)).toContain('کد کالا');
  });

  it('fails a row whose amount is not exactly quantity × unit price (no rounding)', () => {
    const plans = groupInvoiceRows([
      row({ quantity: 1, unitPrice: 1000, amount: 999, vat: 0, totalRial: 999 }),
      row({ rowNumber: 3, quantity: 3, unitPrice: 0.333, amount: 1, vat: 0, totalRial: 1 }),
    ], TENANT_PARTIES);

    expect(plans[0].valid).toBe(false);
    expect(plans[0].rowErrors.get(2)).toContain('1 × 1000 = 1000');
    expect(plans[0].rowErrors.get(2)).toContain('«999»');
    expect(plans[0].rowErrors.get(3)).toContain('دو رقم اعشار');
  });

  it('fails a row whose total is not amount + VAT, naming both figures', () => {
    const plans = groupInvoiceRows([
      row({ amount: 37250000, vat: 3725000, totalRial: 40974999 }),
    ], TENANT_PARTIES);

    expect(plans[0].rowErrors.get(2)).toContain('37250000 + 3725000 = 40975000');
    expect(plans[0].rowErrors.get(2)).toContain('«40974999»');
  });

  it('fails a row whose VAT is not an exact four-decimal rate of the amount', () => {
    const plans = groupInvoiceRows([
      row({ amount: 300, vat: 100, totalRial: 400 }),
    ], TENANT_PARTIES);

    expect(plans[0].rowErrors.get(2)).toContain('نرخ دقیق سازگار نیست');
  });

  it('keeps a clean VAT rate (10%) and derives it exactly', () => {
    const plans = groupInvoiceRows([
      row({ quantity: 3, unitPrice: 11125000, amount: 33375000, vat: 3337500, totalRial: 36712500 }),
      row({ rowNumber: 3, quantity: 4, unitPrice: 27875000, amount: 111500000, vat: 11150000, totalRial: 122650000 }),
    ], TENANT_PARTIES);

    expect(plans[0].lines.map((line) => line.vatRate)).toEqual([0.1, 0.1]);
    expect(plans[0].valid).toBe(true);
  });

  it('fails the whole invoice and reports every row when one line is broken', () => {
    const plans = groupInvoiceRows([
      row({ rowNumber: 2 }),
      row({ rowNumber: 3, itemCode: 'ITM-2', quantity: 1, unitPrice: 5000, amount: 5000, vat: 500, totalRial: 5600 }),
      row({ rowNumber: 4, itemCode: 'ITM-1', quantity: 1, unitPrice: 1000, amount: 1000, vat: 100, totalRial: 1100 }),
    ], TENANT_PARTIES);

    expect(plans[0].valid).toBe(false);
    expect(plans[0].rowErrors.size).toBe(3);
    expect(plans[0].rowErrors.get(2)).toContain('سطر 3');
    expect(plans[0].rowErrors.get(2)).toContain('INV-1');
    expect(plans[0].rowErrors.get(3)).toContain('5000 + 500 = 5500');
    expect(plans[0].rowErrors.get(4)).toContain('سطر 3');
  });

  it('fails an invalid or missing date', () => {
    const bad = groupInvoiceRows([row({ date: '2024-02-30' })], TENANT_PARTIES);
    const jalali = groupInvoiceRows([row({ rowNumber: 3, date: '1403/07/15' })], TENANT_PARTIES);
    const blank = groupInvoiceRows([row({ rowNumber: 4, date: '' })], TENANT_PARTIES);

    expect(bad[0].rowErrors.get(2)).toContain('تاریخ');
    expect(jalali[0].rowErrors.get(3)).toContain('تاریخ');
    expect(blank[0].rowErrors.get(4)).toContain('تاریخ');
  });

  it('fails an unsupported currency and defaults a blank one to IRR', () => {
    const unsupported = groupInvoiceRows([row({ currency: 'GBP' })], TENANT_PARTIES);
    const blank = groupInvoiceRows([row({ rowNumber: 3, currency: '' })], TENANT_PARTIES);
    const lower = groupInvoiceRows([row({ rowNumber: 4, currency: 'usd', fxRate: 920000 })], TENANT_PARTIES);

    expect(unsupported[0].rowErrors.get(2)).toContain('ارز «GBP»');
    expect(blank[0].currency).toBe(Currency.IRR);
    expect(blank[0].valid).toBe(true);
    expect(lower[0].currency).toBe(Currency.USD);
    expect(lower[0].fxRate).toBe(920000);
  });

  it('fails a row whose quantity has more than two decimals or is not positive', () => {
    const tooMany = groupInvoiceRows([row({ quantity: 1.125, unitPrice: 1000, amount: 1125, vat: 112.5, totalRial: 1237.5 })], TENANT_PARTIES);
    const zero = groupInvoiceRows([row({ rowNumber: 3, quantity: 0 })], TENANT_PARTIES);

    expect(tooMany[0].rowErrors.get(2)).toContain('تعداد «1.125» بیش از 2 رقم اعشار دارد و گرد نمی‌شود.');
    expect(zero[0].rowErrors.get(3)).toContain('بیشتر از صفر');
  });

  it('fails rows of one invoice whose directions or currencies disagree', () => {
    const mixed = groupInvoiceRows([
      row({ rowNumber: 2 }),
      row({ rowNumber: 3, type: 'خرید', partyCode: 'SUPP-1' }),
    ], TENANT_PARTIES);
    const currencies = groupInvoiceRows([
      row({ rowNumber: 2 }),
      row({ rowNumber: 3, itemCode: 'ITM-2', currency: 'USD', fxRate: 920000 }),
    ], TENANT_PARTIES);

    expect(mixed[0].rowErrors.get(3)).toContain('یکی نیست');
    expect(currencies[0].rowErrors.get(3)).toContain('ارز این سطر');
  });

  it('keeps first-seen order of invoices and skips rows without a number', () => {
    const plans = groupInvoiceRows([
      row({ number: 'B-2', rowNumber: 2 }),
      { rowNumber: 3, number: '' } as InvoiceImportRow,
      row({ number: 'A-1', rowNumber: 4 }),
    ], TENANT_PARTIES);

    expect(plans.map((plan) => plan.invoiceNumber)).toEqual(['B-2', 'A-1']);
  });
});
