import { bankNameFa, bankFromIban } from './profiles/bank-profiles';
import { isValidIban, normaliseAccountNumber } from './iban';
import { StatementHeaderInfo, StatementRow } from './types';

export type CheckSeverity = 'ok' | 'warn' | 'ask' | 'block';

export interface CheckChoice {
  id: string;
  label: string;
}

export interface PrerequisiteCheck {
  code:
    | 'iban_checksum'
    | 'account_match'
    | 'bank_match'
    | 'period'
    | 'duplicate_file'
    | 'period_overlap'
    | 'opening_continuity'
    | 'running_balance';
  severity: CheckSeverity;
  /** One short sentence for the user (Persian). */
  message: string;
  /** Facts the decision rests on. */
  evidence: string[];
  choices: CheckChoice[];
}

export interface KnownBankAccount {
  id: number;
  name: string;
  bankCode: string;
  accountNumber: string;
  iban: string | null;
  openingBalance: bigint;
}

/** A period already imported for the same bank account. */
export interface ImportedPeriod {
  sessionId: number;
  fileSha256: string;
  from: string;
  to: string;
  openingBalance: bigint | null;
  closingBalance: bigint | null;
}

export interface PrerequisiteInput {
  header: StatementHeaderInfo;
  rows: StatementRow[];
  fileSha256: string;
  accounts: KnownBankAccount[];
  /** Account the user picked/confirmed (overrides detection). */
  chosenAccountId?: number | null;
  /** Imports of the resolved account (any status other than discarded). */
  imported: ImportedPeriod[];
  /** Answers already given: check code to choice id. */
  confirmations?: Record<string, string>;
}

export interface PrerequisiteResult {
  resolvedAccountId: number | null;
  period: { from: string; to: string } | null;
  opening: bigint | null;
  closing: bigint | null;
  checks: PrerequisiteCheck[];
  /** No block and no unanswered ask. */
  canProceed: boolean;
  /** Can the user create a new bank account from the statement's details. */
  offerCreateAccount: boolean;
}

const money = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const dayAfter = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** The chronological running balance must follow `balance = previous + deposit - withdrawal`. */
export function checkRunningBalance(rows: StatementRow[]): {
  breaks: Array<{ rowNo: number; expected: bigint; actual: bigint }>;
  checked: number;
  impliedOpening: bigint | null;
} {
  const breaks: Array<{ rowNo: number; expected: bigint; actual: bigint }> = [];
  let checked = 0;
  let impliedOpening: bigint | null = null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.balance === null) {
      continue;
    }
    if (impliedOpening === null && i === 0) {
      impliedOpening = row.balance - row.deposit + row.withdrawal;
    }
    const prev = rows[i - 1];
    if (prev && prev.balance !== null) {
      checked += 1;
      const expected = prev.balance + row.deposit - row.withdrawal;
      if (expected !== row.balance) {
        breaks.push({ rowNo: row.rowNo, expected, actual: row.balance });
      }
    }
  }
  return { breaks, checked, impliedOpening };
}

export function evaluatePrerequisites(input: PrerequisiteInput): PrerequisiteResult {
  const { header, rows, accounts } = input;
  const answers = input.confirmations ?? {};
  const checks: PrerequisiteCheck[] = [];
  const push = (check: PrerequisiteCheck) => checks.push(check);

  // ---- IBAN checksum
  if (header.iban && !isValidIban(header.iban)) {
    push({
      code: 'iban_checksum',
      severity: 'block',
      message: 'شماره شبای موجود در فایل نامعتبر است؛ فایل ممکن است دستکاری یا ناقص باشد.',
      evidence: [`شبا: ${header.iban.slice(0, 6)}…${header.iban.slice(-4)}`],
      choices: [],
    });
  }

  // ---- account match: chosen > IBAN > account number
  let resolved: KnownBankAccount | null = null;
  const chosen = input.chosenAccountId
    ? accounts.find((account) => account.id === input.chosenAccountId) ?? null
    : null;
  let detectedBy: 'iban' | 'number' | null = null;
  if (chosen) {
    resolved = chosen;
  } else {
    const byIban = header.iban
      ? accounts.filter((a) => a.iban && a.iban.toUpperCase() === header.iban)
      : [];
    const wanted = normaliseAccountNumber(header.accountNumber);
    const byNumber = wanted
      ? accounts.filter((a) => normaliseAccountNumber(a.accountNumber) === wanted)
      : [];
    if (byIban.length === 1) {
      resolved = byIban[0];
      detectedBy = 'iban';
    } else if (byNumber.length === 1) {
      resolved = byNumber[0];
      detectedBy = 'number';
    }
    if (byIban.length === 1 && byNumber.length === 1 && byIban[0].id !== byNumber[0].id) {
      resolved = null;
      push({
        code: 'account_match',
        severity: 'ask',
        message: 'شبا و شماره حساب فایل به دو حساب متفاوت اشاره می‌کنند؛ کدام درست است؟',
        evidence: [`شبا: ${byIban[0].name}`, `شماره حساب: ${byNumber[0].name}`],
        choices: [byIban[0], byNumber[0]].map((a) => ({ id: `account:${a.id}`, label: a.name })),
      });
    }
  }

  const accountAnswer = answers.account_match;
  if (!resolved && accountAnswer?.startsWith('account:')) {
    resolved = accounts.find((a) => `account:${a.id}` === accountAnswer) ?? null;
  }

  let offerCreateAccount = false;
  if (!resolved && !checks.some((c) => c.code === 'account_match')) {
    const hasIdentity = Boolean(header.iban || header.accountNumber);
    if (hasIdentity) {
      offerCreateAccount = true;
      push({
        code: 'account_match',
        severity: 'ask',
        message: 'این حساب بانکی هنوز تعریف نشده است؛ حساب جدید بسازید یا حساب موجود را انتخاب کنید.',
        evidence: [
          header.iban ? `شبا: …${header.iban.slice(-6)}` : '',
          header.accountNumber ? `شماره حساب: …${header.accountNumber.slice(-4)}` : '',
          header.bankCode ? `بانک: ${bankNameFa(header.bankCode)}` : '',
        ].filter(Boolean),
        choices: [
          { id: 'create', label: 'ساخت حساب بانکی جدید' },
          ...accounts.map((a) => ({ id: `account:${a.id}`, label: a.name })),
        ],
      });
    } else {
      push({
        code: 'account_match',
        severity: 'ask',
        message: 'در فایل شماره حساب یا شبا پیدا نشد؛ این صورتحساب مربوط به کدام حساب است؟',
        evidence: [],
        choices: accounts.map((a) => ({ id: `account:${a.id}`, label: a.name })),
      });
    }
  } else if (resolved && !chosen && !accountAnswer) {
    push({
      code: 'account_match',
      severity: 'ok',
      message: `حساب «${resolved.name}» شناسایی شد.`,
      evidence: [detectedBy === 'iban' ? 'تطبیق با شبا' : 'تطبیق با شماره حساب'],
      choices: [],
    });
  } else if (resolved && (chosen || accountAnswer)) {
    push({
      code: 'account_match',
      severity: 'ok',
      message: `حساب «${resolved.name}» توسط کاربر تأیید شد.`,
      evidence: [],
      choices: [],
    });
  }

  // ---- bank mismatch (file says one bank, the account is another)
  const fileBank = header.bankCode ?? (header.iban ? bankFromIban(header.iban) : null);
  if (resolved && fileBank && resolved.bankCode !== 'other' && resolved.bankCode !== fileBank) {
    const confirmed = answers.bank_match === 'confirm';
    push({
      code: 'bank_match',
      severity: confirmed ? 'warn' : 'ask',
      message: `فایل متعلق به ${bankNameFa(fileBank)} است اما حساب انتخابی ${bankNameFa(resolved.bankCode)} است. ادامه می‌دهید؟`,
      evidence: [`حساب: ${resolved.name}`],
      choices: [
        { id: 'confirm', label: 'بله، همین حساب است' },
        { id: 'cancel', label: 'خیر، لغو' },
      ],
    });
  }

  // ---- period
  const dates = rows.map((row) => row.date).sort();
  const rowFrom = dates[0] ?? null;
  const rowTo = dates[dates.length - 1] ?? null;
  const period =
    header.periodFrom && header.periodTo
      ? { from: header.periodFrom, to: header.periodTo }
      : rowFrom && rowTo
        ? { from: rowFrom, to: rowTo }
        : null;
  if (!period) {
    push({
      code: 'period',
      severity: 'block',
      message: 'بازه زمانی صورتحساب مشخص نیست (سطر معتبری وجود ندارد).',
      evidence: [],
      choices: [],
    });
  } else if (rowFrom && rowTo && (rowFrom < period.from || rowTo > period.to)) {
    push({
      code: 'period',
      severity: 'block',
      message: 'تاریخ برخی سطرها خارج از بازه اعلام‌شده در سربرگ فایل است.',
      evidence: [`سربرگ: ${period.from} تا ${period.to}`, `سطرها: ${rowFrom} تا ${rowTo}`],
      choices: [],
    });
  }

  // ---- duplicate / overlap with earlier imports
  if (resolved && period) {
    const sameFile = input.imported.find((p) => p.fileSha256 === input.fileSha256);
    if (sameFile) {
      push({
        code: 'duplicate_file',
        severity: 'block',
        message: 'همین فایل قبلاً بارگذاری شده است.',
        evidence: [`بازه: ${sameFile.from} تا ${sameFile.to}`],
        choices: [],
      });
    } else {
      const overlapping = input.imported.filter(
        (p) => p.from <= period.to && p.to >= period.from,
      );
      if (overlapping.length > 0) {
        const choice = answers.period_overlap;
        push({
          code: 'period_overlap',
          severity: choice === 'skip_existing' ? 'warn' : 'ask',
          message: 'بازه این صورتحساب با بازه‌ای که قبلاً وارد شده هم‌پوشانی دارد.',
          evidence: overlapping.map((p) => `قبلاً: ${p.from} تا ${p.to}`),
          choices: [
            { id: 'skip_existing', label: 'فقط سطرهای جدید را وارد کن' },
            { id: 'cancel', label: 'لغو' },
          ],
        });
      }
    }
  }

  // ---- running balance arithmetic
  const running = checkRunningBalance(rows);
  if (running.breaks.length > 0) {
    const first = running.breaks[0];
    push({
      code: 'running_balance',
      severity: answers.running_balance === 'continue' ? 'warn' : 'ask',
      message: `مانده جاری در ${running.breaks.length} سطر با مبالغ نمی‌خواند (نخستین: سطر ${first.rowNo}).`,
      evidence: [
        `انتظار: ${money(first.expected)} ریال`,
        `فایل: ${money(first.actual)} ریال`,
      ],
      choices: [
        { id: 'continue', label: 'ادامه با همین فایل' },
        { id: 'cancel', label: 'لغو' },
      ],
    });
  }

  // ---- opening balance continuity
  const opening =
    header.openingBalance ?? running.impliedOpening ?? null;
  const closing =
    header.closingBalance ??
    [...rows].reverse().find((row) => row.balance !== null)?.balance ??
    null;
  if (resolved && period && opening !== null) {
    const previous = [...input.imported]
      .filter((p) => p.to < period.from && p.closingBalance !== null)
      .sort((a, b) => b.to.localeCompare(a.to))[0];
    const expectedOpening = previous ? previous.closingBalance : input.imported.length === 0 ? resolved.openingBalance : null;
    if (expectedOpening !== null && expectedOpening !== opening) {
      push({
        code: 'opening_continuity',
        severity: answers.opening_continuity === 'accept' ? 'warn' : 'ask',
        message: previous
          ? 'مانده ابتدای این صورتحساب با مانده پایان دوره قبلی برابر نیست.'
          : 'مانده ابتدای این صورتحساب با مانده افتتاحیه حساب بانکی برابر نیست.',
        evidence: [
          `انتظار: ${money(expectedOpening)} ریال`,
          `فایل: ${money(opening)} ریال`,
        ],
        choices: [
          { id: 'accept', label: 'مانده فایل درست است' },
          { id: 'cancel', label: 'لغو' },
        ],
      });
    } else if (previous && dayAfter(previous.to) < period.from) {
      push({
        code: 'opening_continuity',
        severity: 'warn',
        message: 'بین پایان دوره قبلی و این صورتحساب فاصله زمانی وجود دارد.',
        evidence: [`پایان دوره قبلی: ${previous.to}`, `آغاز این فایل: ${period.from}`],
        choices: [],
      });
    }
  }

  const cancelled = Object.values(answers).includes('cancel');
  const canProceed =
    !cancelled && checks.every((check) => check.severity === 'ok' || check.severity === 'warn');

  return {
    resolvedAccountId: resolved?.id ?? null,
    period,
    opening,
    closing,
    checks,
    canProceed,
    offerCreateAccount,
  };
}
