import { ReportTable } from '../../../accounting/reports/report-table';
import { writePdfs } from '../../../accounting/reports/pdf-writer';
import { MigrationCertificate } from './certificate.types';

const STATUS_FA: Record<MigrationCertificate['status'], string> = {
  clean: 'بدون اختلاف',
  'differences-routed-to-suspense': 'اختلاف‌ها به حساب واسط منتقل شده است',
  blocked: 'مسدود: پیش از تأیید باید رفع شود',
};

/** Rials in the accounting report format: minor units with two decimals. */
const money = (rial: string | null): bigint | string => (rial === null ? '—' : BigInt(rial) * 100n);
const dash = (v: string | null | undefined): string => (v === null || v === undefined ? '—' : v);

const CONTROL_FA: Record<string, string> = { AR: 'دریافتنی', AP: 'پرداختنی', 'receivable cheques': 'چک دریافتنی', 'payable cheques': 'چک پرداختنی' };

/** The worker writes English reasons plus a code; the customer-facing PDF says it in Persian. */
function blockingFa(b: MigrationCertificate['blocking'][number]): string {
  switch (b.code) {
    case 'no-source-tb': return 'تراز آزمایشی منبع پیدا نشد؛ مطابقت تا ریال قابل اثبات نیست';
    case 'lines-unbalanced': return 'سطرهای سند منتقل‌شده متوازن نیست (جمع بدهکار با بستانکار برابر نیست)';
    case 'unknown-accounts': return `${b.count} کد حساب در اسناد هست که در سرفصل‌های حساب نیست`;
    case 'control-differs': return `زیرحساب ${CONTROL_FA[b.control ?? ''] ?? b.control} با حساب کل ${b.difference} ریال اختلاف دارد`;
    case 'stock-differs': return `${b.count} کالا/انبار با مانده منبع نمی‌خواند`;
  }
}

export function certificateTables(c: MigrationCertificate): ReportTable[] {
  const header = `منبع: ${c.source ?? '—'} · تاریخ: ${c.generatedAt.slice(0, 10)} · شناسه محتوا: ${c.contentSha256.slice(0, 12)}`;
  const summary: ReportTable = {
    title: 'گواهی تطبیق مهاجرت داده',
    subtitle: header,
    columns: [{ title: 'بررسی', width: 3 }, { title: 'نتیجه', width: 4 }],
    rows: [
      { cells: ['وضعیت کلی', STATUS_FA[c.status]], bold: true },
      { cells: ['تراز آزمایشی: حساب‌های مقایسه‌شده', String(c.trialBalance.accountsCompared)] },
      { cells: ['تراز آزمایشی: حساب‌های دارای اختلاف', String(c.trialBalance.accountsWithDifference)] },
      { cells: [`مانده «${c.trialBalance.suspense.nameFa}» (ریال)`, money(c.trialBalance.suspense.amount)] },
      { cells: ['اسناد نامتوازن در منبع', String(c.trialBalance.unbalancedVoucherCount)] },
      { cells: ['سطرهای ردشده (قابل تایپ نبود)', String(c.rejectedRows.reduce((s, r) => s + r.rows, 0))] },
      { cells: ['موجودی: اختلاف کالا/انبار', c.stock ? String(c.stock.differenceCount) : 'داده‌ای نبود'] },
      { cells: ['موجودی منفی در منبع', c.stock ? String(c.stock.negativeCount) : 'داده‌ای نبود'] },
      ...c.blocking.map((b) => ({ cells: ['مانع تأیید', blockingFa(b)] })),
      { cells: ['تأیید مشتری', 'در انتظار: هیچ‌چیز پیش از تأیید مشتری فعال نمی‌شود'], bold: true },
    ],
  };
  const tables: ReportTable[] = [summary];
  if (c.trialBalance.differences.length) {
    tables.push({
      title: 'تراز آزمایشی: اختلاف حساب‌ها با منبع (ریال)',
      subtitle: `${header} · مقدار اختلاف به «${c.trialBalance.suspense.nameFa}» منتقل می‌شود`,
      columns: [{ title: 'حساب', width: 1.5 }, { title: 'منبع', money: true }, { title: 'مهاجرت‌شده', money: true }, { title: 'اختلاف', money: true }, { title: 'سند مشکوک در منبع', width: 3 }],
      rows: c.trialBalance.differences.map((d) => ({
        cells: [d.account, money(d.source), money(d.migrated), money(d.difference), d.suspectDocuments.length ? d.suspectDocuments.map((s) => `${s.sourceTable} · سند ${s.voucher} (سطر ${s.firstRow})`).join('، ') : 'علت در سطح سند یافت نشد'],
      })),
    });
  }
  const sub: ReportTable = {
    title: 'حساب‌های دریافتنی و پرداختنی و چک‌های در جریان (ریال)',
    subtitle: header,
    columns: [{ title: 'مورد', width: 3 }, { title: 'جمع زیرحساب', money: true }, { title: 'مانده حساب کل', money: true }, { title: 'اختلاف', money: true }],
    rows: [],
  };
  const oi = c.subledgers.openItems;
  if (oi) {
    sub.rows.push({ cells: [`دریافتنی (${oi.ar.items} قلم، ${oi.ar.parties} طرف حساب)`, money(oi.ar.total), money(oi.controlAr?.ledgerBalance ?? null), money(oi.controlAr?.difference ?? null)] });
    sub.rows.push({ cells: [`پرداختنی (${oi.ap.items} قلم، ${oi.ap.parties} طرف حساب)`, money(oi.ap.total), money(oi.controlAp?.ledgerBalance ?? null), money(oi.controlAp?.difference ?? null)] });
  }
  const ch = c.subledgers.cheques;
  if (ch) {
    sub.rows.push({ cells: [`چک دریافتنی در جریان (${ch.receivable.count})`, money(ch.receivable.total), money(ch.controlReceivable?.ledgerBalance ?? null), money(ch.controlReceivable?.difference ?? null)] });
    sub.rows.push({ cells: [`چک پرداختنی در جریان (${ch.payable.count})`, money(ch.payable.total), money(ch.controlPayable?.ledgerBalance ?? null), money(ch.controlPayable?.difference ?? null)] });
  }
  if (sub.rows.length) tables.push(sub);
  if (c.stock && c.stock.differences.length) {
    tables.push({
      title: 'موجودی: اختلاف تعداد و ارزش FIFO با منبع',
      subtitle: header,
      columns: [{ title: 'کالا' }, { title: 'انبار' }, { title: 'تعداد محاسبه‌شده' }, { title: 'تعداد منبع' }, { title: 'ارزش محاسبه‌شده', money: true }, { title: 'ارزش منبع', money: true }, { title: 'اختلاف ارزش', money: true }],
      rows: c.stock.differences.map((d) => ({ cells: [d.item, d.warehouse, d.qtyComputed, d.qtySource, money(d.valueComputed), money(d.valueSource), money(d.valueDifference)] })),
    });
  }
  if (c.stock && c.stock.negativeStock.length) {
    tables.push({
      title: 'موجودی منفی در منبع و اصلاح پیشنهادی',
      subtitle: header,
      columns: [{ title: 'کالا' }, { title: 'انبار' }, { title: 'مانده پایانی' }, { title: 'کمترین مانده' }, { title: 'تعداد اصلاحی' }, { title: 'با فی' }, { title: 'توضیح', width: 2 }],
      rows: c.stock.negativeStock.map((n) => ({ cells: [n.item, n.warehouse, n.endingQty, dash(n.lowestRunningQty), n.proposedAdjustmentQty, dash(n.atUnitCost), n.note === 'ends negative' ? 'پایان منفی' : 'پیش از ورودهای بعدی منفی شده'] })),
    });
  }
  if (c.rejectedRows.length) {
    tables.push({
      title: 'سطرهای ردشده هنگام تبدیل (نام جدول و شمارهٔ سطر منبع)',
      subtitle: header,
      columns: [{ title: 'نوع داده' }, { title: 'جدول منبع', width: 2 }, { title: 'تعداد' }, { title: 'اولین سطر' }],
      rows: c.rejectedRows.map((r) => ({ cells: [r.target, r.sourceTables.join('، '), String(r.rows), String(r.firstRow)] })),
    });
  }
  return tables;
}

export function renderCertificatePdf(c: MigrationCertificate): Promise<Buffer> {
  return writePdfs(certificateTables(c));
}
