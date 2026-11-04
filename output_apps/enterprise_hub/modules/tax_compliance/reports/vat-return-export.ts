import { toMinor } from '../../accounting/money';
import { writePdf } from '../../accounting/reports/pdf-writer';
import { ReportTable } from '../../accounting/reports/report-table';
import { writeXlsx } from '../../accounting/reports/xlsx-writer';
import { VatReturn } from './vat-return.service';

/** Format-neutral table of the VAT return (money cells are exact minor units). */
export function vatReturnTable(r: VatReturn): ReportTable {
  const m = (value: number | string): bigint => toMinor(value);
  const row = (label: string, base: bigint | null, vat: bigint | null, bold = false) => ({
    cells: [label, base, vat],
    bold,
  });
  return {
    title: `پیش‌نویس اظهارنامه ارزش افزوده ${r.period.label}`,
    subtitle: `${r.status} - ${r.period.label}`,
    columns: [
      { title: 'شرح', width: 4 },
      { title: 'مبلغ مشمول (ریال)', width: 2, money: true },
      { title: 'مالیات (ریال)', width: 2, money: true },
    ],
    rows: [
      row(`فروش (${r.output.invoiceCount} صورتحساب)`, m(r.output.taxableBase), m(r.output.vat)),
      row(`خرید (${r.input.documentCount} سند)`, m(r.input.taxableBase), m(r.input.vat)),
      row('عوارض (unclear)', null, m(r.levies.amount)),
      row('خالص مالیات فصل (فروش منهای خرید)', null, m(r.netVat), true),
      row('اعتبار منتقل‌شده از فصل قبل', null, m(r.carriedCreditIn)),
      row('مالیات قابل پرداخت', null, m(r.payable), true),
      row('اعتبار انتقالی به فصل بعد', null, m(r.creditCarriedForward), true),
      row(`خالص دفتر کل (حساب ${r.ledger.outputAccount ?? '-'} / ${r.ledger.inputAccount ?? '-'})`, null, m(r.ledger.netPayable)),
      row(r.ledger.reconciled ? 'اختلاف با دفتر کل: ندارد' : 'اختلاف با دفتر کل', null, m(r.ledger.difference), true),
      ...r.notes.map((note) => ({ cells: [note, null, null] })),
    ],
  };
}

export async function renderVatReturn(
  r: VatReturn,
  format: 'xlsx' | 'pdf',
): Promise<{ body: Buffer; filename: string; contentType: string }> {
  const table = vatReturnTable(r);
  const base = `vat-return-${r.period.year}-q${r.period.quarter}`;
  if (format === 'pdf') {
    return { body: await writePdf(table), filename: `${base}.pdf`, contentType: 'application/pdf' };
  }
  return {
    body: writeXlsx(table),
    filename: `${base}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
