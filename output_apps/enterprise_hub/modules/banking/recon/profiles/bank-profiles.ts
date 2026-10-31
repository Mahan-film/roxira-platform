import { BankCode } from '../../enums/banking.enum';
import { fixPersianChars, toAsciiDigits } from '../../../data_import/normaliser/normalise';
import { StatementField } from '../types';

/** Header text normalised for comparison (digits, Arabic letters, spacing, ZWNJ). */
export function normaliseHeader(value: string): string {
  return fixPersianChars(toAsciiDigits(value))
    .replace(/[‌‍‎‏]/g, '')
    .replace(/[:：]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * One column layout of one bank's export. A layout is only trusted when every header listed here
 * is present verbatim (after normalisation): "proven" layouts are accepted without a mapping step,
 * anything else is mapped by the user. `evidence` says how the layout was established; all current
 * entries are `synthetic` (built from the layouts documented in the banking README, not from a
 * real customer file) until the owner supplies real samples.
 */
export interface ColumnLayout {
  id: string;
  evidence: 'synthetic' | 'verified';
  /** Field to the exact header text of that column. */
  columns: Partial<Record<StatementField, string>>;
}

export interface BankProfile {
  code: BankCode;
  nameFa: string;
  /** 3-digit bank id inside the IBAN (positions 5-7 of `IRkk0BBB...`). */
  ibanBankId: string;
  /** Words that identify the bank in the title rows of an export. */
  titleKeywords: string[];
  layouts: ColumnLayout[];
}

export const BANK_PROFILES: readonly BankProfile[] = [
  {
    code: BankCode.MELLAT,
    nameFa: 'بانک ملت',
    ibanBankId: '012',
    titleKeywords: ['بانک ملت'],
    layouts: [
      {
        id: 'mellat-internet-bank',
        evidence: 'synthetic',
        columns: {
          date: 'تاریخ',
          time: 'زمان',
          description: 'شرح',
          reference: 'شماره پیگیری',
          withdrawal: 'بدهکار',
          deposit: 'بستانکار',
          balance: 'مانده',
        },
      },
    ],
  },
  {
    code: BankCode.MELLI,
    nameFa: 'بانک ملی ایران',
    ibanBankId: '017',
    titleKeywords: ['بانک ملی', 'ملی ایران'],
    layouts: [
      {
        id: 'melli-sepideh',
        evidence: 'synthetic',
        columns: {
          date: 'تاریخ',
          time: 'ساعت',
          description: 'شرح عملیات',
          reference: 'شماره سند',
          withdrawal: 'برداشت',
          deposit: 'واریز',
          balance: 'مانده',
        },
      },
    ],
  },
  {
    code: BankCode.SADERAT,
    nameFa: 'بانک صادرات ایران',
    ibanBankId: '019',
    titleKeywords: ['بانک صادرات', 'صادرات ایران'],
    layouts: [
      {
        id: 'saderat-internet-bank',
        evidence: 'synthetic',
        columns: {
          date: 'تاریخ',
          description: 'شرح',
          withdrawal: 'بدهکار',
          deposit: 'بستانکار',
          balance: 'مانده',
          chequeNo: 'شماره چک',
        },
      },
    ],
  },
  {
    code: BankCode.TEJARAT,
    nameFa: 'بانک تجارت',
    ibanBankId: '018',
    titleKeywords: ['بانک تجارت'],
    layouts: [
      {
        id: 'tejarat-internet-bank',
        evidence: 'synthetic',
        columns: {
          date: 'تاریخ تراکنش',
          description: 'شرح تراکنش',
          withdrawal: 'مبلغ برداشت',
          deposit: 'مبلغ واریز',
          balance: 'مانده حساب',
          reference: 'شماره مرجع',
        },
      },
    ],
  },
  {
    code: BankCode.PASARGAD,
    nameFa: 'بانک پاسارگاد',
    ibanBankId: '057',
    titleKeywords: ['بانک پاسارگاد'],
    layouts: [
      {
        id: 'pasargad-internet-bank',
        evidence: 'synthetic',
        columns: {
          date: 'تاریخ',
          time: 'زمان',
          description: 'شرح',
          reference: 'کد پیگیری',
          withdrawal: 'مبلغ بدهکار',
          deposit: 'مبلغ بستانکار',
          balance: 'مانده',
        },
      },
    ],
  },
  {
    code: BankCode.SAMAN,
    nameFa: 'بانک سامان',
    ibanBankId: '056',
    titleKeywords: ['بانک سامان'],
    layouts: [
      {
        id: 'saman-internet-bank',
        evidence: 'synthetic',
        columns: {
          date: 'تاریخ',
          description: 'شرح',
          reference: 'شماره سریال',
          withdrawal: 'برداشت',
          deposit: 'واریز',
          balance: 'مانده',
        },
      },
    ],
  },
];

/** Banks recognised by name/IBAN only (no proven layout yet: their files go through mapping). */
export const OTHER_BANKS: ReadonlyArray<{
  code: BankCode;
  nameFa: string;
  ibanBankId: string;
  titleKeywords: string[];
}> = [
  { code: BankCode.SEPAH, nameFa: 'بانک سپه', ibanBankId: '015', titleKeywords: ['بانک سپه'] },
  { code: BankCode.KESHAVARZI, nameFa: 'بانک کشاورزی', ibanBankId: '016', titleKeywords: ['بانک کشاورزی'] },
  { code: BankCode.MASKAN, nameFa: 'بانک مسکن', ibanBankId: '014', titleKeywords: ['بانک مسکن'] },
  { code: BankCode.REFAH, nameFa: 'بانک رفاه', ibanBankId: '013', titleKeywords: ['بانک رفاه'] },
  { code: BankCode.PARSIAN, nameFa: 'بانک پارسیان', ibanBankId: '054', titleKeywords: ['بانک پارسیان'] },
  { code: BankCode.KARAFARIN, nameFa: 'بانک کارآفرین', ibanBankId: '053', titleKeywords: ['کارآفرین'] },
  { code: BankCode.EGHTESAD_NOVIN, nameFa: 'بانک اقتصاد نوین', ibanBankId: '055', titleKeywords: ['اقتصاد نوین'] },
  { code: BankCode.SINA, nameFa: 'بانک سینا', ibanBankId: '059', titleKeywords: ['بانک سینا'] },
  { code: BankCode.SHAHR, nameFa: 'بانک شهر', ibanBankId: '061', titleKeywords: ['بانک شهر'] },
  { code: BankCode.AYANDEH, nameFa: 'بانک آینده', ibanBankId: '062', titleKeywords: ['بانک آینده'] },
  { code: BankCode.DEY, nameFa: 'بانک دی', ibanBankId: '066', titleKeywords: ['بانک دی'] },
  { code: BankCode.POST_BANK, nameFa: 'پست بانک', ibanBankId: '021', titleKeywords: ['پست بانک'] },
];

const ALL_BANKS = [
  ...BANK_PROFILES.map((p) => ({
    code: p.code,
    nameFa: p.nameFa,
    ibanBankId: p.ibanBankId,
    titleKeywords: p.titleKeywords,
  })),
  ...OTHER_BANKS,
];

export function bankNameFa(code: string | null | undefined): string {
  return ALL_BANKS.find((bank) => bank.code === code)?.nameFa ?? 'نامشخص';
}

export function bankFromIban(iban: string): BankCode | null {
  const id = iban.slice(4, 7);
  return ALL_BANKS.find((bank) => bank.ibanBankId === id)?.code ?? null;
}

/** Longest keyword wins so «بانک ملی» is not mistaken for «ملت»/«ملی ایران» sub-matches. */
export function bankFromText(text: string): BankCode | null {
  const normal = normaliseHeader(text);
  let best: { code: BankCode; length: number } | null = null;
  for (const bank of ALL_BANKS) {
    for (const keyword of bank.titleKeywords) {
      const needle = normaliseHeader(keyword);
      if (normal.includes(needle) && (!best || needle.length > best.length)) {
        best = { code: bank.code, length: needle.length };
      }
    }
  }
  return best?.code ?? null;
}

/**
 * The single proven layout whose headers all appear in `headers`; null when none or when two
 * layouts of different banks fit equally well (then the user maps the columns).
 */
export function matchLayout(
  headers: string[],
): { profile: BankProfile; layout: ColumnLayout; map: Record<string, number> } | null {
  const normal = headers.map(normaliseHeader);
  const fits: Array<{
    profile: BankProfile;
    layout: ColumnLayout;
    map: Record<string, number>;
    size: number;
  }> = [];
  for (const profile of BANK_PROFILES) {
    for (const layout of profile.layouts) {
      const map: Record<string, number> = {};
      let complete = true;
      for (const [field, header] of Object.entries(layout.columns)) {
        const index = normal.indexOf(normaliseHeader(header as string));
        if (index === -1) {
          complete = false;
          break;
        }
        map[field] = index;
      }
      if (complete) {
        fits.push({ profile, layout, map, size: Object.keys(map).length });
      }
    }
  }
  if (fits.length === 0) {
    return null;
  }
  fits.sort((a, b) => b.size - a.size);
  if (fits.length > 1 && fits[0].size === fits[1].size) {
    return null;
  }
  return fits[0];
}

/** Broad synonyms used only to *suggest* a mapping for an unknown layout (never auto-trusted). */
export const FIELD_SYNONYMS: Record<StatementField, string[]> = {
  date: ['تاریخ', 'تاریخ تراکنش', 'تاریخ سند', 'date'],
  time: ['زمان', 'ساعت', 'time'],
  description: ['شرح', 'شرح تراکنش', 'شرح عملیات', 'توضیحات', 'description'],
  reference: ['شماره پیگیری', 'کد پیگیری', 'شماره مرجع', 'شماره سند', 'شماره سریال', 'reference'],
  withdrawal: ['برداشت', 'بدهکار', 'مبلغ برداشت', 'مبلغ بدهکار', 'withdrawal', 'debit'],
  deposit: ['واریز', 'بستانکار', 'مبلغ واریز', 'مبلغ بستانکار', 'deposit', 'credit'],
  amount: ['مبلغ', 'مبلغ تراکنش', 'amount'],
  balance: ['مانده', 'مانده حساب', 'مانده پس از تراکنش', 'balance'],
  chequeNo: ['شماره چک', 'شماره صیاد', 'cheque'],
};
