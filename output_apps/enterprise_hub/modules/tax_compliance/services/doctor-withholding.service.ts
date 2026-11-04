import { BadRequestException, Injectable } from '@nestjs/common';
import { minorToDecimal, parseMinor } from '../../accounting/money';
import { gregorianToJalali, isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { DoctorWithholdingPreviewDto } from '../dto/doctor-withholding-preview.dto';
import { applyRate, readStatutory, StatutoryUse } from '../utils/progressive-tax';

export const DOCTOR_WITHHOLDING_NOTES: readonly string[] = [
  'پیش‌نمایش است و هیچ سندی در دفتر کل ثبت نمی‌شود و چیزی به سازمان امور مالیاتی ارسال نمی‌شود.',
  'مبنای قانونی سال ۱۴۰۵ (بند قانون بودجه) در متن قانون بودجه و بخشنامهٔ احکام مالیاتی ۱۴۰۵ مخزن نیست و unclear است؛ نرخ، دامنه، مبنا (پرداختی/تهاتر/مطالبه) و مهلت فقط از منابع ثانویه شناخته‌شده‌اند (docs/tax/DOCTOR_FEE_WITHHOLDING.md).',
  'متن رسمی دستورالعمل‌های سازمان امور مالیاتی (مثلاً ۲۰۰/۱۴۰۰/۵۰۲) برای تأیید در دسترس نبود.',
  'مهلت ایصال (پایان ماه بعد) و شمارش ماه‌های تأخیر (ماه شروع‌شده یک ماه حساب می‌شود) unclear است.',
  'جریمهٔ ماده ۱۹۹ (۱۰٪ مالیات پرداخت‌نشده و ۲٫۵٪ به ازای هر ماه) از متن قانون مخزن خوانده می‌شود و فقط برای برآورد است.',
];

export interface DoctorWithholdingLine {
  doctorRef: string;
  paidOn: string;
  kind: string;
  amount: string;
  withheld: string;
  netToDoctor: string;
  excludedReason: string | null;
  /** End of the Jalali month after the payment (Gregorian ISO date). */
  remitBy: string;
}

export interface DoctorWithholdingPreview {
  status: 'preview';
  fiscalYear: number;
  currency: 'IRR';
  lines: DoctorWithholdingLine[];
  byDoctor: Array<{ doctorRef: string; gross: string; withheld: string }>;
  totalWithheld: string;
  latePenalty: { remittedOn: string; monthsLate: number; amount: string } | null;
  parameters: StatutoryUse[];
  voucher: { posted: false };
  notes: string[];
}

const KEYS = ['doctor_fee_withholding_rate', 'withholding_late_penalty_rate', 'withholding_late_penalty_monthly_rate'] as const;

/** End of the Jalali month after the one containing `paidOn` (the source: by the end of the following month). */
export function remitDeadline(paidOn: string): string {
  const j = gregorianToJalali(paidOn);
  if (!j) throw new BadRequestException(`تاریخ ${paidOn} معتبر نیست.`);
  const year = j.jm === 12 ? j.jy + 1 : j.jy;
  const month = j.jm === 12 ? 1 : j.jm + 1;
  return isoDate(jalaliMonthEnd(year, month));
}

/** Jalali months started after `due` up to `remitted` (0 when not late). */
export function monthsLate(due: string, remitted: string): number {
  if (remitted <= due) return 0;
  const a = gregorianToJalali(due)!;
  const b = gregorianToJalali(remitted)!;
  return (b.jy * 12 + b.jm) - (a.jy * 12 + a.jm) + (b.jd > a.jd ? 1 : 0) || 1;
}

/** Advance withholding on doctors' fees paid by medical centres. Preview only, rates from the statutory store. */
@Injectable()
export class DoctorWithholdingService {
  constructor(private readonly statutory: StatutoryRepository) {}

  async preview(tenantId: string, dto: DoctorWithholdingPreviewDto): Promise<DoctorWithholdingPreview> {
    const used = await readStatutory(this.statutory, tenantId, dto.fiscalYear, KEYS);
    const rate = String(used.get('doctor_fee_withholding_rate')!.value);

    const lines: DoctorWithholdingLine[] = dto.payments.map((p) => {
      const amount = parseMinor(p.amount);
      const fee = p.kind === 'FEE';
      const withheld = fee ? applyRate(amount, rate) : 0n;
      return {
        doctorRef: p.doctorRef,
        paidOn: p.paidOn,
        kind: p.kind,
        amount: minorToDecimal(amount),
        withheld: minorToDecimal(withheld),
        netToDoctor: minorToDecimal(amount - withheld),
        excludedReason: fee ? null : 'حقوق و کارانه (بودجه‌ای) مشمول این کسر نیست و طبق مقررات حقوق مالیات می‌شود',
        remitBy: remitDeadline(p.paidOn),
      };
    });

    const totals = new Map<string, { gross: bigint; withheld: bigint }>();
    for (const line of lines) {
      const t = totals.get(line.doctorRef) ?? { gross: 0n, withheld: 0n };
      t.gross += parseMinor(line.amount);
      t.withheld += parseMinor(line.withheld);
      totals.set(line.doctorRef, t);
    }
    const totalWithheld = lines.reduce((a, l) => a + parseMinor(l.withheld), 0n);

    let latePenalty: DoctorWithholdingPreview['latePenalty'] = null;
    if (dto.remittedOn) {
      // Late tax of each line: 10% of the unpaid tax plus 2.5% for each month of delay (Act, Art. 199).
      const flat = String(used.get('withholding_late_penalty_rate')!.value);
      const monthly = String(used.get('withholding_late_penalty_monthly_rate')!.value);
      let months = 0;
      let amount = 0n;
      for (const line of lines) {
        const w = parseMinor(line.withheld);
        const late = monthsLate(line.remitBy, dto.remittedOn);
        if (w === 0n || late === 0) continue;
        months = Math.max(months, late);
        amount += applyRate(w, flat) + applyRate(w, monthly) * BigInt(late);
      }
      latePenalty = { remittedOn: dto.remittedOn, monthsLate: months, amount: minorToDecimal(amount) };
    }

    return {
      status: 'preview',
      fiscalYear: dto.fiscalYear,
      currency: 'IRR',
      lines,
      byDoctor: [...totals.entries()].map(([doctorRef, t]) => ({
        doctorRef, gross: minorToDecimal(t.gross), withheld: minorToDecimal(t.withheld),
      })),
      totalWithheld: minorToDecimal(totalWithheld),
      latePenalty,
      parameters: [...used.values()],
      voucher: { posted: false },
      notes: [...DOCTOR_WITHHOLDING_NOTES],
    };
  }
}
