import { Injectable } from '@nestjs/common';
import { fromMinor } from '../../accounting/money';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { VAT_ACCOUNT, VAT_RECEIVABLE_ACCOUNT } from '../../invoicing/constants/suite-events.constants';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import { tehranDay } from './jalali-format.util';
import { SeasonalReportService } from './seasonal-report.service';
import { VatLedgerAccount, VatReturnRepository } from './vat-return.repository';

export type Amount = number | string;

export interface VatReturn {
  /** Always a draft: the accountant reviews it and files in the tax portal. */
  status: 'draft';
  period: { year: number; quarter: number; label: string };
  currency: 'IRR';
  output: { invoiceCount: number; taxableBase: Amount; vat: Amount };
  input: { documentCount: number; taxableBase: Amount; vat: Amount };
  /** Levies (عوارض) are not stored on any document yet; reported as zero and marked unclear. */
  levies: { amount: Amount; status: 'unclear' };
  /** Output VAT minus input VAT of this season, before any carried credit. */
  netVat: Amount;
  carriedCreditIn: Amount;
  /** Positive amount to pay, or zero. */
  payable: Amount;
  /** Credit to carry into the next season, or zero. */
  creditCarriedForward: Amount;
  ledger: {
    outputAccount: string | null;
    inputAccount: string | null;
    /** Credit minus debit on the output account, minus debit minus credit on the input account. */
    netPayable: Amount;
    /** Document net VAT minus ledger net: zero when the return agrees with the ledger exactly. */
    difference: Amount;
    reconciled: boolean;
  };
  notes: string[];
}

export const VAT_RETURN_NOTES: readonly string[] = [
  'این برگه پیش‌نویس محاسباتی از اسناد ثبت‌شده است و اظهارنامهٔ ارزش افزوده نیست؛ حسابدار باید آن را بازبینی و در سامانه ثبت کند.',
  'عوارض و مالیات خرید غیرقابل‌کسر در سامانه نگهداری نمی‌شود؛ عوارض صفر گزارش شده و وضعیت آن unclear است.',
  'انتقال اعتبار مالیاتی به فصل بعد (به‌جای استرداد) مطابق منبع قانونی تأییدشده نیست و unclear است؛ فقط درون یک سال شمسی محاسبه می‌شود.',
  'مالیات ورودی قابل کسر مشروط به تطبیق کارپوشه است که هنوز انجام نمی‌شود (VAT-02).',
  'تطبیق با دفتر کل: حساب بدهی «مالیات بر ارزش افزوده» و حساب دارایی «اعتبار مالیاتی» با همان قاعدهٔ ثبت صورتحساب انتخاب می‌شوند؛ اختلاف غیرصفر یعنی سندی ثبت‌نشده یا سند دستی روی این حساب‌ها وجود دارد.',
];

/** Same pick the invoice posting uses: first account of the type whose name matches, else the default code. */
export function pickVatAccount(
  accounts: VatLedgerAccount[],
  spec: { code: string; accountType: AccountType; match: string[] },
): string | null {
  const byName = accounts.find(
    (a) => a.accountType === spec.accountType && spec.match.some((m) => a.name.includes(m)),
  );
  if (byName) return byName.code;
  return accounts.find((a) => a.code === spec.code)?.code ?? null;
}

@Injectable()
export class VatReturnService {
  constructor(
    private readonly seasonal: SeasonalReportService,
    private readonly ledger: VatReturnRepository,
  ) {}

  private async season(tenantId: string, year: number, quarter: number) {
    const sales = await this.seasonal.salesTotals(tenantId, year, quarter);
    const purchases = await this.seasonal.loadPurchases(tenantId, jalaliQuarterRange(year, quarter));
    return {
      sales,
      purchaseCount: purchases.rows.length,
      purchaseBase: purchases.rows.reduce((sum, r) => sum + r.baseMinor, 0n),
      purchaseVat: purchases.rows.reduce((sum, r) => sum + r.vatMinor, 0n),
    };
  }

  async vatReturn(tenantId: string, year: number, quarter: number): Promise<VatReturn> {
    const range = jalaliQuarterRange(year, quarter);

    // Credit carried inside the year: each season starts with the previous season's credit.
    let credit = 0n;
    let carriedIn = 0n;
    let current = await this.season(tenantId, year, 1);
    for (let q = 1; q <= quarter; q++) {
      if (q > 1) current = await this.season(tenantId, year, q);
      carriedIn = credit;
      const owed = current.sales.vatMinor - current.purchaseVat - carriedIn;
      credit = owed < 0n ? -owed : 0n;
    }
    const net = current.sales.vatMinor - current.purchaseVat;
    const owed = net - carriedIn;

    const accounts = await this.ledger.chartAccounts(tenantId);
    const outputCode = pickVatAccount(accounts, VAT_ACCOUNT);
    const inputCode = pickVatAccount(accounts, VAT_RECEIVABLE_ACCOUNT);
    const fromDay = tehranDay(range.from);
    const toDay = tehranDay(range.to);
    const out = outputCode
      ? await this.ledger.turnover(tenantId, outputCode, fromDay, toDay)
      : { debitMinor: 0n, creditMinor: 0n };
    const inp = inputCode
      ? await this.ledger.turnover(tenantId, inputCode, fromDay, toDay)
      : { debitMinor: 0n, creditMinor: 0n };
    const ledgerNet = out.creditMinor - out.debitMinor - (inp.debitMinor - inp.creditMinor);
    const difference = net - ledgerNet;

    return {
      status: 'draft',
      period: { year: range.year, quarter: range.quarter, label: range.label },
      currency: 'IRR',
      output: {
        invoiceCount: current.sales.invoiceCount,
        taxableBase: fromMinor(current.sales.baseMinor),
        vat: fromMinor(current.sales.vatMinor),
      },
      input: {
        documentCount: current.purchaseCount,
        taxableBase: fromMinor(current.purchaseBase),
        vat: fromMinor(current.purchaseVat),
      },
      levies: { amount: 0, status: 'unclear' },
      netVat: fromMinor(net),
      carriedCreditIn: fromMinor(carriedIn),
      payable: fromMinor(owed > 0n ? owed : 0n),
      creditCarriedForward: fromMinor(owed < 0n ? -owed : 0n),
      ledger: {
        outputAccount: outputCode,
        inputAccount: inputCode,
        netPayable: fromMinor(ledgerNet),
        difference: fromMinor(difference),
        reconciled: difference === 0n,
      },
      notes: [...VAT_RETURN_NOTES],
    };
  }
}
