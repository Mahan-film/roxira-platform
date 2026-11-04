import { BadRequestException, Injectable } from '@nestjs/common';
import { minorToDecimal, parseMinor, scaledToDecimal } from '../../accounting/money';
import { isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { isValidStatutoryValue, StatutoryKey } from '../../hr/statutory/statutory-catalogue';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { IRAN, resolveParameters } from '../../hr/statutory/statutory.service';
import { CorporateTaxPreviewDto } from '../dto/corporate-tax-preview.dto';

export const CORPORATE_TAX_NOTES: readonly string[] = [
  'پیش‌نمایش است و هیچ سندی در دفتر کل ثبت نمی‌شود.',
  'نرخ مالیات، حداقل نرخ مؤثر ۱۰٪، مبنای آن، قواعد زیان انتقالی و زمان ذخیره در منابع قانونی مخزن نیست و unclear است (docs/tax/CORPORATE_TAX_WORKBENCH.md).',
  'نرخ‌ها فقط از پارامترهای قانونی خوانده می‌شوند؛ مقدار تأییدنشده با verified=false نشان داده می‌شود.',
];

export interface CorporateTaxParameterUse {
  key: StatutoryKey;
  value: string;
  effectiveFrom: string;
  version: number;
  source: string;
  verified: boolean;
}

export interface CorporateTaxPreview {
  status: 'preview';
  fiscalYear: number;
  currency: 'IRR';
  worksheet: Array<{ step: string; amount: string }>;
  taxableIncome: string;
  taxByRate: string;
  floorTax: string;
  provision: string;
  floorApplied: boolean;
  /** Provision / accounting profit as a 6-decimal string, or null when there is no profit. */
  effectiveRate: string | null;
  voucher: { posted: false; lines: Array<{ accountCode: string | null; debit: string; credit: string; description: string }> };
  parameters: CorporateTaxParameterUse[];
  notes: string[];
}

const RATE_SCALE = 1_000_000n;

/** amount (minor units) x rate (exact decimal string, <= 6 places), rounded half up. */
export function applyRate(amountMinor: bigint, rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  const scaled = BigInt(whole + fraction.padEnd(6, '0'));
  return (amountMinor * scaled + RATE_SCALE / 2n) / RATE_SCALE;
}

const KEYS = ['corporate_tax_rate', 'corporate_tax_effective_floor'] as const;

/** Provision computation for the corporate income tax workbench. Preview only, rates from the store. */
@Injectable()
export class CorporateTaxService {
  constructor(private readonly statutory: StatutoryRepository) {}

  private async rates(tenantId: string, fiscalYear: number): Promise<CorporateTaxParameterUse[]> {
    const rows = await this.statutory.findForYear(tenantId, IRAN, fiscalYear);
    const resolved = resolveParameters(rows, isoDate(jalaliMonthEnd(fiscalYear, 12)));
    return KEYS.map((key) => {
      const row = resolved.get(key);
      if (!row || !isValidStatutoryValue(key, row.value)) {
        throw new BadRequestException(
          `پارامتر قانونی «${key}» برای سال ${fiscalYear} تعریف نشده یا نامعتبر است؛ منبع قانونی تأییدشده لازم است.`,
        );
      }
      return {
        key,
        value: String(row.value),
        effectiveFrom: row.effectiveFrom.slice(0, 10),
        version: row.version,
        source: row.source,
        verified: row.verified,
      };
    });
  }

  async preview(tenantId: string, dto: CorporateTaxPreviewDto): Promise<CorporateTaxPreview> {
    const parameters = await this.rates(tenantId, dto.fiscalYear);
    const rate = parameters[0].value;
    const floor = parameters[1].value;
    const profit = parseMinor(dto.accountingProfit);
    const additions = parseMinor(dto.nonDeductibleAdditions);
    const deductions = parseMinor(dto.exemptIncomeAndDeductions);
    const losses = parseMinor(dto.lossesBroughtForward);

    const raw = profit + additions - deductions - losses;
    const taxable = raw > 0n ? raw : 0n;
    const byRate = applyRate(taxable, rate);
    const floorTax = applyRate(profit > 0n ? profit : 0n, floor);
    const provision = byRate > floorTax ? byRate : floorTax;
    const effective = profit > 0n ? ((provision * RATE_SCALE * 2n) / profit + 1n) / 2n : null;

    const lines =
      provision > 0n
        ? [
            { accountCode: dto.expenseAccountCode ?? null, debit: minorToDecimal(provision), credit: '0.00', description: 'هزینه مالیات بر درآمد' },
            { accountCode: dto.payableAccountCode ?? null, debit: '0.00', credit: minorToDecimal(provision), description: 'مالیات بر درآمد پرداختنی' },
          ]
        : [];
    return {
      status: 'preview',
      fiscalYear: dto.fiscalYear,
      currency: 'IRR',
      worksheet: [
        { step: 'سود حسابداری قبل از مالیات', amount: minorToDecimal(profit) },
        { step: 'اضافات غیرقابل قبول', amount: minorToDecimal(additions) },
        { step: 'درآمد معاف و کسورات', amount: minorToDecimal(deductions) },
        { step: 'زیان انتقالی', amount: minorToDecimal(losses) },
        { step: 'درآمد مشمول مالیات', amount: minorToDecimal(taxable) },
        { step: `مالیات به نرخ ${rate}`, amount: minorToDecimal(byRate) },
        { step: `حداقل مالیات (نرخ مؤثر ${floor})`, amount: minorToDecimal(floorTax) },
        { step: 'ذخیرهٔ مالیات (بیشتر دو مبلغ)', amount: minorToDecimal(provision) },
      ],
      taxableIncome: minorToDecimal(taxable),
      taxByRate: minorToDecimal(byRate),
      floorTax: minorToDecimal(floorTax),
      provision: minorToDecimal(provision),
      floorApplied: floorTax > byRate,
      effectiveRate: effective === null ? null : scaledToDecimal(effective, 6),
      voucher: { posted: false, lines },
      parameters,
      notes: [...CORPORATE_TAX_NOTES],
    };
  }
}
