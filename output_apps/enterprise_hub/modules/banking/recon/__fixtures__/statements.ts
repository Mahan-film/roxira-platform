import { jalaliToGregorian } from '../../../data_import/normaliser/normalise';
import { buildIban } from '../iban';
import { BANK_PROFILES } from '../profiles/bank-profiles';
import { buildXlsx } from '../report/xlsx-writer';

/**
 * Synthetic statements for the reconciliation tests. They follow the layouts documented in the
 * banking README; no real customer data. Amounts are whole rials.
 */
export interface FixtureTxn {
  jalali: string;
  time: string;
  description: string;
  withdrawal: number;
  deposit: number;
  reference: string;
}

export const OPENING = 100_000_000;

export const TXNS: FixtureTxn[] = [
  { jalali: '1403/07/01', time: '09:10', description: 'واریز پایا از شرکت آلفا بابت فاکتور فروش 1201', withdrawal: 0, deposit: 50_000_000, reference: '700100001' },
  { jalali: '1403/07/02', time: '10:30', description: 'انتقال پایا به شرکت بتا بابت فاکتور خرید 77', withdrawal: 12_000_000, deposit: 0, reference: '700100002' },
  { jalali: '1403/07/03', time: '11:00', description: 'کارمزد پایا', withdrawal: 350_000, deposit: 0, reference: '700100003' },
  { jalali: '1403/07/03', time: '11:01', description: 'هزینه پیامک', withdrawal: 15_000, deposit: 0, reference: '700100004' },
  { jalali: '1403/07/05', time: '08:00', description: 'پرداخت حقوق مهر ماه', withdrawal: 30_000_000, deposit: 0, reference: '700100005' },
  { jalali: '1403/07/09', time: '14:20', description: 'واریز از آقای علی رضایی جاری شریک', withdrawal: 0, deposit: 20_000_000, reference: '700100006' },
  { jalali: '1403/07/10', time: '09:00', description: 'کسر قسط وام', withdrawal: 8_000_000, deposit: 0, reference: '700100007' },
  { jalali: '1403/07/12', time: '12:00', description: 'پرداخت مالیات بر ارزش افزوده سازمان امور مالیاتی', withdrawal: 5_000_000, deposit: 0, reference: '700100008' },
  { jalali: '1403/07/15', time: '13:00', description: 'پاس چک شماره 123456 صیاد 1403123456789012', withdrawal: 40_000_000, deposit: 0, reference: '700100009' },
];

export function gregorian(jalali: string): string {
  const [y, m, d] = jalali.split('/').map(Number);
  const g = jalaliToGregorian(y, m, d);
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

export const ACCOUNT_NUMBER = '0102345678001';
export const IBAN_BODY = '0102345678001';

export function ibanFor(bankId: string): string {
  return buildIban(bankId, IBAN_BODY);
}

export function closingBalance(txns: FixtureTxn[] = TXNS): number {
  return txns.reduce((b, t) => b + t.deposit - t.withdrawal, OPENING);
}

interface RenderOptions {
  newestFirst?: boolean;
  persianDigits?: boolean;
  /** Overrides applied to the title block. */
  noAccount?: boolean;
  openingBalance?: number;
  txns?: FixtureTxn[];
  breakBalanceAt?: number;
}

const BANK_TITLE: Record<string, { name: string; ibanId: string }> = {
  mellat: { name: 'بانک ملت', ibanId: '012' },
  melli: { name: 'بانک ملی ایران', ibanId: '017' },
  saderat: { name: 'بانک صادرات ایران', ibanId: '019' },
  tejarat: { name: 'بانک تجارت', ibanId: '018' },
  pasargad: { name: 'بانک پاسارگاد', ibanId: '057' },
  saman: { name: 'بانک سامان', ibanId: '056' },
  sepah: { name: 'بانک سپه', ibanId: '015' },
};

const toPersian = (text: string) => text.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** Grid of cells: title rows, header row, data rows. */
export function statementGrid(bank: string, options: RenderOptions = {}): string[][] {
  const title = BANK_TITLE[bank];
  const txns = options.txns ?? TXNS;
  const opening = options.openingBalance ?? OPENING;
  const profile = BANK_PROFILES.find((p) => p.code === bank);
  const layout = profile?.layouts[0].columns ?? {
    // Sepah has no proven layout: an unusual header set that must go through mapping.
    date: 'تاریخ',
    description: 'شرح',
    reference: 'شماره پیگیری',
    withdrawal: 'مبلغ بدهکار (ریال)',
    deposit: 'مبلغ بستانکار (ریال)',
    balance: 'مانده (ریال)',
  };
  const fields = Object.keys(layout) as Array<keyof typeof layout>;
  const last = txns[txns.length - 1].jalali;
  const grid: string[][] = [
    [`صورتحساب ${title.name}`],
    ...(options.noAccount ? [] : [[`شماره حساب: ${ACCOUNT_NUMBER}`], [`شماره شبا: ${ibanFor(title.ibanId)}`]]),
    [`از تاریخ ${txns[0].jalali} تا تاریخ ${last}`],
    [`مانده اول دوره: ${opening.toLocaleString('en-US')}`],
    [],
    fields.map((f) => layout[f] as string),
  ];
  let balance = opening;
  const data = txns.map((t, i) => {
    balance += t.deposit - t.withdrawal;
    const shown = options.breakBalanceAt === i ? balance + 1_000 : balance;
    const values: Record<string, string> = {
      date: t.jalali,
      time: t.time,
      description: t.description,
      reference: t.reference,
      withdrawal: t.withdrawal ? t.withdrawal.toLocaleString('en-US') : '0',
      deposit: t.deposit ? t.deposit.toLocaleString('en-US') : '0',
      balance: shown.toLocaleString('en-US'),
      chequeNo: t.description.includes('چک') ? '123456' : '',
    };
    return fields.map((f) => values[f]);
  });
  if (options.newestFirst) {
    data.reverse();
  }
  grid.push(...data);
  return options.persianDigits ? grid.map((row) => row.map(toPersian)) : grid;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function statementCsv(bank: string, options: RenderOptions = {}): Buffer {
  const lines = statementGrid(bank, options).map((row) => row.map(csvEscape).join(','));
  return Buffer.from(`﻿${lines.join('\n')}\n`, 'utf8');
}

export function statementXlsx(bank: string, options: RenderOptions = {}): Buffer {
  return buildXlsx([{ name: 'statement', rows: statementGrid(bank, options) }]);
}

/** Minimal text PDF with a table (English headers: Persian glyph encoding is not generated here). */
export function statementPdf(): Buffer {
  const header = ['date', 'description', 'withdrawal', 'deposit', 'balance'];
  const body = [
    ['2024-09-22', 'deposit from alpha', '0', '50,000,000', '150,000,000'],
    ['2024-09-23', 'transfer to beta', '12,000,000', '0', '138,000,000'],
  ];
  const xs = [72, 140, 300, 380, 460];
  const ops = ['BT /F1 10 Tf'];
  [header, ...body].forEach((row, r) => {
    row.forEach((cellText, c) => {
      ops.push(`1 0 0 1 ${xs[c]} ${720 - r * 18} Tm (${cellText}) Tj`);
    });
  });
  ops.push('ET');
  const content = ops.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  return Buffer.from(`%PDF-1.4\n${objects.join('')}trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n`, 'latin1');
}

export const BANKS_WITH_PROFILE = ['mellat', 'melli', 'saderat', 'tejarat', 'pasargad', 'saman'] as const;
