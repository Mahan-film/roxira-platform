import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { groupInvoiceRows, InvoiceImportRow } from './invoice-import';

const digits = (s: string): string =>
  s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

// The sample company's invoices.csv, hand-counted: 360 rows, 238 distinct numbers (143 sales, 95 purchases),
// 2 exact repeated rows, 6 blank-party rows.
const csv = readFileSync(
  join(__dirname, '../../../../../e2e/fixtures/sample-company/invoices.csv'),
  'utf8',
)
  .replace(/^﻿/, '')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.split(',').map((c) => digits(c.trim())));

const rows: InvoiceImportRow[] = csv.map((c, i) => ({
  rowNumber: i + 2,
  number: c[0],
  type: c[1],
  date: c[2],
  partyCode: c[3],
  itemCode: c[5],
  quantity: Number(c[6]),
  unitPrice: Number(c[7]),
  amount: Number(c[8]),
  vat: Number(c[9]),
  totalRial: Number(c[10]),
  currency: c[11],
  fxRate: Number(c[12]),
}));

describe('sample-company invoices.csv through groupInvoiceRows', () => {
  const plans = groupInvoiceRows(rows, {
    partyByCode: new Proxy(new Map(), {
      get: (t, p) =>
        p === 'get'
          ? (code: string) => ({ id: 1, code, name: 'x' })
          : Reflect.get(t, p).bind(t),
    }) as never,
    existingSkus: new Proxy(new Set(), {
      get: (t, p) => (p === 'has' ? () => true : Reflect.get(t, p).bind(t)),
    }) as never,
  });

  it('has the hand-computed counts', () => {
    expect(rows).toHaveLength(360);
    expect(plans).toHaveLength(238);
    expect(plans.filter((p) => p.direction === InvoiceDirection.SALE)).toHaveLength(143);
    expect(plans.filter((p) => p.direction === InvoiceDirection.PURCHASE)).toHaveLength(95);
    expect(plans.flatMap((p) => p.duplicateRows)).toHaveLength(2);
    expect(rows.filter((r) => !r.partyCode)).toHaveLength(6);
  });

  it('every invoice reconciles, with no row failure', () => {
    expect(plans.filter((p) => !p.valid).map((p) => [p.invoiceNumber, [...p.rowErrors]])).toEqual([]);
  });
});
