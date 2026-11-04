import { ReportTable } from '../../accounting/reports/report-table';

/** The payslip figures the printout needs (rials, integers). */
export interface PayslipPrint {
  payslipNumber: string;
  periodYear: number;
  periodMonth: number;
  employeeNumber: string;
  fullName: string;
  nationalId: string;
  insuranceNumber: string | null;
  jobTitle: string;
  workDays: number;
  baseSalary: number;
  seniorityAmount: number;
  housingAllowance: number;
  foodAllowance: number;
  childAllowance: number;
  marriageAllowance: number;
  allowancesTotal: number;
  eidiAmount: number;
  overtimeAmount: number;
  nightShiftAmount: number;
  holidayAmount: number;
  absenceDeduction: number;
  grossPay: number;
  insuranceDeduction: number;
  incomeTax: number;
  otherDeductions: number;
  netPay: number;
  employerInsurance: number;
  unemploymentInsurance: number;
}

export const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const digits = (text: string): string => text.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);

/** Whole rials with Persian digits and the Persian thousands separator: 1234567 -> ۱٬۲۳۴٬۵۶۷. */
export function formatRial(value: number): string {
  const rounded = Math.round(Number(value) || 0);
  const grouped = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return digits(rounded < 0 ? `(${grouped})` : grouped);
}

/** One payslip as a two-column table: label, amount in rials. Zero lines are left out. */
export function payslipTable(p: PayslipPrint): ReportTable {
  const month = JALALI_MONTH_NAMES[p.periodMonth - 1] ?? String(p.periodMonth);
  const text = (label: string, value: string): { cells: string[] } => ({ cells: [label, value] });
  const money = (label: string, value: number, bold = false): { cells: string[]; bold?: boolean } => ({
    cells: [label, formatRial(value)],
    bold,
  });
  const earnings: Array<[string, number]> = [
    ['حقوق مبنا', p.baseSalary],
    ['پایه سنوات', p.seniorityAmount],
    ['حق مسکن', p.housingAllowance],
    ['کمک‌هزینه اقلام مصرفی', p.foodAllowance],
    ['حق اولاد', p.childAllowance],
    ['حق تأهل', p.marriageAllowance],
    ['سایر مزایا', p.allowancesTotal],
    ['اضافه‌کار', p.overtimeAmount],
    ['شب‌کاری', p.nightShiftAmount],
    ['کار در تعطیلات', p.holidayAmount],
    ['عیدی و پاداش', p.eidiAmount],
  ];
  const deductions: Array<[string, number]> = [
    ['کسر غیبت', p.absenceDeduction],
    ['حق بیمه سهم کارگر', p.insuranceDeduction],
    ['مالیات حقوق', p.incomeTax],
    ['سایر کسورات', p.otherDeductions],
  ];
  const lines = (rows: Array<[string, number]>) =>
    rows.filter(([, value]) => Math.round(value) !== 0).map(([label, value]) => money(label, value));
  return {
    title: `فیش حقوقی ${month} ${digits(String(p.periodYear))}`,
    subtitle: `شماره ${p.payslipNumber}`,
    columns: [
      { title: 'شرح', width: 3 },
      { title: 'مبلغ (ریال)', width: 2 },
    ],
    rows: [
      text('نام و نام خانوادگی', p.fullName),
      text('شماره پرسنلی', p.employeeNumber),
      text('کد ملی', p.nationalId),
      text('شماره بیمه', p.insuranceNumber ?? '—'),
      text('عنوان شغلی', p.jobTitle),
      text('روزهای کارکرد', digits(String(p.workDays))),
      { cells: ['مزایا', ''], bold: true },
      ...lines(earnings),
      money('جمع ناخالص', p.grossPay, true),
      { cells: ['کسورات', ''], bold: true },
      ...lines(deductions),
      money('خالص پرداختی', p.netPay, true),
      { cells: ['سهم کارفرما (اطلاعاتی)', ''], bold: true },
      ...lines([
        ['بیمه سهم کارفرما', p.employerInsurance],
        ['بیمه بیکاری', p.unemploymentInsurance],
      ]),
    ],
  };
}
