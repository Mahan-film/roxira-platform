import { BadRequestException, Injectable } from '@nestjs/common';
import { minorToDecimal, parseMinor } from '../../accounting/money';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { RentalTaxPreviewDto } from '../dto/rental-tax-preview.dto';
import { applyRate, Bracket, bracketTax, readStatutory, StatutoryUse } from '../utils/progressive-tax';

export const RENTAL_TAX_NOTES: readonly string[] = [
  'پیش‌نمایش است و هیچ سندی در دفتر کل ثبت نمی‌شود.',
  'پله‌های ماده ۱۳۱ در متن قانون مخزن (۱۴۰۰/۱۰/۲۰) و جدول ۱۴۰۵ آن در منبع رسمی مخزن نیست و unclear است. مالیات اجاره جداگانه با این پله‌ها محاسبه می‌شود؛ جمع‌شدن با سایر درآمدها unclear است (docs/tax/RENTAL_INCOME_TAX.md).',
  'تخفیف‌های قرارداد دوساله و سه‌ساله و اجارهٔ کمتر از ارزش منطقه‌ای که پس از ۱۴۰۰ به ماده ۵۳ اضافه شده در متن مخزن نیست و مدل نشده است (unclear).',
  'حقوق بازنشستگی، وظیفه، جوایز و سود سپردهٔ بانکی درآمد حساب نمی‌شوند؛ حسابدار باید آن‌ها را از «سایر درآمد» حذف کند.',
  'معافیت ماده ۵۷ نیازمند اظهارنامهٔ مخصوص و اعلام نداشتن درآمد دیگر است؛ این برگه آن را ثبت نمی‌کند.',
];

export interface RentalTaxPreview {
  status: 'preview';
  fiscalYear: number;
  currency: 'IRR';
  grossRent: string;
  taxableRent: string;
  exemptionAmount: string;
  taxableAfterExemption: string;
  tax: string;
  worksheet: Array<{ step: string; amount: string }>;
  parameters: StatutoryUse[];
  voucher: { posted: false };
  notes: string[];
}

const KEYS = ['rental_expense_deduction_rate', 'income_exemption_ceiling_art57_art101', 'income_tax_art131_brackets'] as const;
const big = (v: string | undefined): bigint => (v ? parseMinor(v) : 0n);
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Rental income tax (Act Art. 53) with the Art. 57 exemption. Preview only, rates from the statutory store. */
@Injectable()
export class RentalTaxService {
  constructor(private readonly statutory: StatutoryRepository) {}

  async preview(tenantId: string, dto: RentalTaxPreviewDto): Promise<RentalTaxPreview> {
    if (!dto.lessorIsOwner && dto.rentPaid === undefined) {
      throw new BadRequestException('وقتی موجر مالک نیست، اجاره‌بهای پرداختی (rentPaid) لازم است.');
    }
    const used = await readStatutory(this.statutory, tenantId, dto.fiscalYear, KEYS);
    const deductionRate = String(used.get('rental_expense_deduction_rate')!.value);
    // The store holds whole rials (money kind); the computation works in minor units (rial x 100).
    const ceiling = BigInt(used.get('income_exemption_ceiling_art57_art101')!.value as number) * 100n;
    const brackets = used.get('income_tax_art131_brackets')!.value as Bracket[];

    const gross = parseMinor(dto.rentReceived) + big(dto.inKindIncome);
    // Owner: the rent minus the share for the owner's costs and depreciation (Art. 53). Not the owner: rent received minus rent paid.
    const afterCosts = dto.lessorIsOwner ? gross - applyRate(gross, deductionRate) : gross - big(dto.rentPaid);
    const taxableRent = afterCosts > 0n ? afterCosts : 0n;
    const afterManual = taxableRent - min(taxableRent, big(dto.exemptRentPortion));

    // Art. 57 and note 2: the part of the rent that, together with the other income, stays within the exemption ceiling is exempt.
    const other = big(dto.otherTaxableIncome);
    const room = ceiling > other ? ceiling - other : 0n;
    const exemption = dto.minorUnderGuardianship ? 0n : min(afterManual, room);
    const taxable = afterManual - exemption;
    const tax = bracketTax(taxable, brackets);

    return {
      status: 'preview',
      fiscalYear: dto.fiscalYear,
      currency: 'IRR',
      grossRent: minorToDecimal(gross),
      taxableRent: minorToDecimal(taxableRent),
      exemptionAmount: minorToDecimal(exemption),
      taxableAfterExemption: minorToDecimal(taxable),
      tax: minorToDecimal(tax),
      worksheet: [
        { step: 'اجاره‌بهای دریافتی (نقدی و غیرنقدی)', amount: minorToDecimal(gross) },
        { step: dto.lessorIsOwner ? `پس از کسر ${deductionRate} هزینه و استهلاک مالک` : 'پس از کسر اجارهٔ پرداختی', amount: minorToDecimal(taxableRent) },
        { step: 'پس از کسر اجارهٔ معاف اعلام‌شده', amount: minorToDecimal(afterManual) },
        { step: 'معافیت ماده ۵۷', amount: minorToDecimal(exemption) },
        { step: 'درآمد مشمول مالیات اجاره', amount: minorToDecimal(taxable) },
        { step: 'مالیات (پله‌های ماده ۱۳۱)', amount: minorToDecimal(tax) },
      ],
      parameters: [...used.values()],
      voucher: { posted: false },
      notes: [...RENTAL_TAX_NOTES],
    };
  }
}
