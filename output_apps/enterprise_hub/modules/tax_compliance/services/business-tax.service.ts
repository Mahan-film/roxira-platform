import { BadRequestException, Injectable } from '@nestjs/common';
import { minorToDecimal, parseMinor } from '../../accounting/money';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { BusinessTaxPreviewDto } from '../dto/business-tax-preview.dto';
import { Bracket, bracketTax, readStatutory, StatutoryUse } from '../utils/progressive-tax';

export const BUSINESS_TAX_NOTES: readonly string[] = [
  'پیش‌نمایش است و هیچ سندی در دفتر کل ثبت نمی‌شود.',
  'پله‌های ماده ۱۳۱ و سقف معافیت از پارامترهای قانونی خوانده می‌شوند. متن قانون در مخزن مربوط به ۱۴۰۰/۱۰/۲۰ است و جدول ۱۴۰۵ ماده ۱۳۱ در منبع رسمی مخزن نیست و unclear است (docs/tax/BUSINESS_OWNER_TAX.md).',
  'تخفیف تبصرهٔ ماده ۱۳۱ (کاهش نرخ به ازای رشد درآمد ابرازی)، جریمه‌ها، زیان سال‌های قبل و معافیت‌های خاص مدل نشده است.',
  'فوت یکی از شرکا و ورثهٔ او در این پیش‌نمایش مدل نشده است.',
];

export interface TaxpayerLine {
  label: string;
  incomeShare: string;
  exemption: string;
  taxableIncome: string;
  tax: string;
}

export interface BusinessTaxPreview {
  status: 'preview';
  fiscalYear: number;
  mode: 'SOLE' | 'PARTNERSHIP';
  currency: 'IRR';
  totalIncome: string;
  exemptionsUsed: number;
  taxpayers: TaxpayerLine[];
  totalTax: string;
  parameters: StatutoryUse[];
  voucher: { posted: false };
  notes: string[];
}

const KEYS = ['income_tax_art131_brackets', 'income_exemption_ceiling_art57_art101', 'civil_partnership_max_exemptions'] as const;

/** Shares of `total` by basis points, rounded down, the remainder going to the largest share. */
export function splitByShares(total: bigint, shares: number[]): bigint[] {
  const parts = shares.map((s) => (total * BigInt(s)) / 10_000n);
  const remainder = total - parts.reduce((a, b) => a + b, 0n);
  let largest = 0;
  shares.forEach((s, i) => { if (s > shares[largest]) largest = i; });
  parts[largest] += remainder;
  return parts;
}

/** Income tax preview for a business owner (Art. 101) or a civil partnership (Art. 101 note 1). Preview only. */
@Injectable()
export class BusinessTaxService {
  constructor(private readonly statutory: StatutoryRepository) {}

  async preview(tenantId: string, dto: BusinessTaxPreviewDto): Promise<BusinessTaxPreview> {
    const used = await readStatutory(this.statutory, tenantId, dto.fiscalYear, KEYS);
    const brackets = used.get('income_tax_art131_brackets')!.value as Bracket[];
    const ceiling = BigInt(used.get('income_exemption_ceiling_art57_art101')!.value as number) * 100n;
    const maxExemptions = Number(used.get('civil_partnership_max_exemptions')!.value);

    const income = dto.units.reduce((sum, u) => sum + parseMinor(u.revenue) - parseMinor(u.deductibleExpenses), 0n);
    const positive = income > 0n ? income : 0n;
    const lines: TaxpayerLine[] = [];
    let exemptionsUsed = 1;

    if (dto.mode === 'SOLE') {
      // Several business units: their income is added up and only one exemption is deducted (Art. 101 note 2).
      const taxable = positive > ceiling ? positive - ceiling : 0n;
      lines.push(this.line('مؤدی', positive, positive - taxable, taxable, brackets));
    } else {
      const partners = dto.partners ?? [];
      if (partners.length < 2) {
        throw new BadRequestException('برای مشارکت مدنی حداقل دو شریک لازم است.');
      }
      if (partners.reduce((a, p) => a + p.shareBps, 0) !== 10_000) {
        throw new BadRequestException('جمع سهم شرکا باید دقیقاً ۱۰۰٪ (۱۰۰۰۰) باشد.');
      }
      // Spouses count as one partner; at most `maxExemptions` exemptions, divided equally; spouses' exemption goes to the first of them.
      const groups = new Map<string, number[]>();
      partners.forEach((p, i) => {
        const key = p.spouseGroup ? `g:${p.spouseGroup}` : `p:${i}`;
        groups.set(key, [...(groups.get(key) ?? []), i]);
      });
      const effective = [...groups.values()];
      exemptionsUsed = Math.min(effective.length, maxExemptions);
      const pool = ceiling * BigInt(exemptionsUsed);
      const perEffective = pool / BigInt(effective.length);
      const leftover = pool - perEffective * BigInt(effective.length);
      const shares = splitByShares(positive, partners.map((p) => p.shareBps));
      const exemptionOf = new Map<number, bigint>();
      effective.forEach((members, index) => exemptionOf.set(members[0], perEffective + (index === 0 ? leftover : 0n)));
      partners.forEach((p, i) => {
        const share = shares[i];
        const wanted = exemptionOf.get(i) ?? 0n;
        const exemption = wanted < share ? wanted : share;
        lines.push(this.line(p.name?.trim() || `شریک ${i + 1}`, share, exemption, share - exemption, brackets));
      });
    }

    return {
      status: 'preview',
      fiscalYear: dto.fiscalYear,
      mode: dto.mode,
      currency: 'IRR',
      totalIncome: minorToDecimal(income),
      exemptionsUsed,
      taxpayers: lines,
      totalTax: minorToDecimal(lines.reduce((a, l) => a + parseMinor(l.tax), 0n)),
      parameters: [...used.values()],
      voucher: { posted: false },
      notes: [...BUSINESS_TAX_NOTES],
    };
  }

  private line(label: string, income: bigint, exemption: bigint, taxable: bigint, brackets: Bracket[]): TaxpayerLine {
    return {
      label,
      incomeShare: minorToDecimal(income),
      exemption: minorToDecimal(exemption),
      taxableIncome: minorToDecimal(taxable),
      tax: minorToDecimal(bracketTax(taxable, brackets)),
    };
  }
}
