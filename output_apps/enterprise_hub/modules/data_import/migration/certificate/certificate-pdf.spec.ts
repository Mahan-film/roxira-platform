import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { certificateTables, renderCertificatePdf } from './certificate-pdf';
import { MigrationCertificate } from './certificate.types';

const cert: MigrationCertificate = {
  version: 1,
  tenantId: '11111111-1111-4111-8111-111111111111',
  source: 'Holoo1',
  generatedAt: '2026-11-05T00:00:00Z',
  currency: 'IRR',
  contentSha256: 'ab'.repeat(32),
  status: 'blocked',
  blocking: [{ code: 'lines-unbalanced', message: 'x' }, { code: 'control-differs', control: 'AR', difference: '-1000', message: 'x' }],
  approval: { required: true, status: 'pending' },
  trialBalance: {
    sourceTrialBalanceProvided: true,
    accountsCompared: 3,
    accountsWithDifference: 1,
    migratedTotals: { debit: '10001000', credit: '10000000', balanced: false },
    differences: [{ account: '1011', source: '10000000', migrated: '10001000', difference: '-1000', suspectDocuments: [{ sourceTable: 'Lines', voucher: 'V2', firstRow: 4, voucherDifference: '1000' }] }],
    suspense: { code: 'OB-SUSPENSE', nameFa: 'حساب واسط توازن افتتاحیه', amount: '1000', note: '' },
    unbalancedVoucherCount: 1,
    unknownAccounts: [],
  },
  subledgers: {
    openItems: { ar: { total: '1000', items: 2, parties: 2, kindInferred: 0 }, ap: { total: '900', items: 1, parties: 1, kindInferred: 0 }, controlAr: { accounts: ['1103'], ledgerBalance: '0', difference: '-1000' }, controlAp: null },
    cheques: { receivable: { total: '500', count: 1 }, payable: { total: '0', count: 0 }, controlReceivable: null, controlPayable: null },
  },
  stock: {
    itemWarehousePairs: 3,
    sourceBalancesProvided: true,
    valuation: 'FIFO',
    differenceCount: 1,
    differences: [{ item: 'C', warehouse: 'W', qtyComputed: '4', qtySource: '5', valueComputed: '40', valueSource: '40', qtyDifference: '-1', valueDifference: '0' }],
    negativeCount: 1,
    negativeStock: [{ item: 'B', warehouse: 'W', endingQty: '-1', lowestRunningQty: '-3', proposedAdjustmentQty: '3', atUnitCost: '50', note: 'went negative before later receipts' }],
  },
  rejectedRows: [{ target: 'gl_trial_balance', sourceTables: ['تراز آزمایشی'], rows: 1, firstRow: 3 }],
};

describe('migration certificate PDF', () => {
  it('turns a certificate into report tables with the suspense account and the named source document', () => {
    const tables = certificateTables(cert);
    expect(tables.map((t) => t.title)).toEqual([
      'گواهی تطبیق مهاجرت داده',
      'تراز آزمایشی: اختلاف حساب‌ها با منبع (ریال)',
      'حساب‌های دریافتنی و پرداختنی و چک‌های در جریان (ریال)',
      'موجودی: اختلاف تعداد و ارزش FIFO با منبع',
      'موجودی منفی در منبع و اصلاح پیشنهادی',
      'سطرهای ردشده هنگام تبدیل (نام جدول و شمارهٔ سطر منبع)',
    ]);
    expect(tables[1].rows[0].cells).toEqual(['1011', 1000000000n, 1000100000n, -100000n, 'Lines · سند V2 (سطر 4)']);
    expect(JSON.stringify(tables[0].rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toContain('در انتظار');
  });

  it('renders a real PDF with Persian text (written to the scratch dir for a visual check)', async () => {
    const pdf = await renderCertificatePdf(cert);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    if (process.env.CERT_PDF_OUT) fs.writeFileSync(process.env.CERT_PDF_OUT, pdf);
    else fs.writeFileSync(path.join(os.tmpdir(), 'migration-certificate.pdf'), pdf);
  });
});
