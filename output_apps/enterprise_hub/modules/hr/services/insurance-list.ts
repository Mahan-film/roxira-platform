/**
 * Social Security Organization (SSO) monthly insurance list (لیست بیمه)
 * export, modelled on the two files of the SSO "DISKET" program
 * (DSKWIN): `DSKKAR00` (workshop header, one row) and `DSKWOR00`
 * (one row per worker).
 *
 * Format assumptions (see docs/hr/INSURANCE_LIST_EXPORT.md):
 *   - The DISKET program stores dBase files in the Iran System code page.
 *     We emit the same columns, in the same order and with the same field
 *     names, as UTF-8 CSV text (comma separated, CRLF, header row). Converting
 *     to DBF / Iran System is a separate step and is not done here.
 *   - Years are two digits (1405 → "05"), months two digits, dates are
 *     compact Jalali `YYYYMMDD`. Amounts are whole rials, no separators.
 *   - DSW_MAH = daily wage × days; DSW_MAZ = insurable benefits above that;
 *     DSW_MASH = DSW_MAH + DSW_MAZ (the capped insurable wage);
 *     DSW_TOTL = DSW_MASH + non-insurable pay (child allowance).
 *   - DSK_TKOSO is the employer's 20% share, DSK_BIC the 3% unemployment
 *     share, DSK_RATE the employer's total rate in percent (23).
 */

export interface InsuranceListWorkshop {
  workshopCode: string;
  workshopName: string;
  employerName: string;
  workshopAddress?: string;
  /** ردیف پیمان (contract row), "000" for a normal workshop list. */
  contractRow?: string;
  /** List number within the month, "01" by default. */
  listNumber?: string;
  description?: string;
}

export interface InsuranceListWorker {
  insuranceNumber: string | null;
  firstName: string;
  lastName: string;
  fatherName: string | null;
  nationalId: string;
  /** Compact Jalali `YYYYMMDD` or ''. */
  birthDate: string;
  gender: 'MALE' | 'FEMALE';
  jobTitle: string;
  /** Compact Jalali start date if the worker started in this month, else ''. */
  startDate: string;
  /** Compact Jalali end date if the worker left in this month, else ''. */
  endDate: string;
  workDays: number;
  dailyWage: number;
  insurableWage: number;
  grossPay: number;
  employeeInsurance: number;
  employerInsurance: number;
  unemploymentInsurance: number;
}

export interface InsuranceListFiles {
  workshopFileName: string;
  workshopFile: string;
  workersFileName: string;
  workersFile: string;
  warnings: string[];
}

export const DSKKAR_FIELDS = [
  'DSK_ID',
  'DSK_NAME',
  'DSK_FARM',
  'DSK_ADRS',
  'DSK_KIND',
  'DSK_YY',
  'DSK_MM',
  'DSK_LISTNO',
  'DSK_DISC',
  'DSK_NUM',
  'DSK_TDD',
  'DSK_TROOZ',
  'DSK_TMAH',
  'DSK_TMAZ',
  'DSK_TMASH',
  'DSK_TTOTL',
  'DSK_TBIME',
  'DSK_TKOSO',
  'DSK_BIC',
  'DSK_RATE',
  'DSK_PRATE',
  'DSK_BIMH',
  'MON_PYM',
] as const;

export const DSKWOR_FIELDS = [
  'DSW_ID',
  'DSW_YY',
  'DSW_MM',
  'DSW_LISTNO',
  'DSW_ID1',
  'DSW_FNAME',
  'DSW_LNAME',
  'DSW_DNAME',
  'DSW_IDNO',
  'DSW_IDPLC',
  'DSW_IDATE',
  'DSW_BDATE',
  'DSW_SEX',
  'DSW_NAT',
  'DSW_OCP',
  'DSW_SDATE',
  'DSW_EDATE',
  'DSW_DD',
  'DSW_ROOZ',
  'DSW_MAH',
  'DSW_MAZ',
  'DSW_MASH',
  'DSW_TOTL',
  'DSW_BIME',
  'DSW_PRATE',
  'DSW_JOB',
  'PER_NATCOD',
] as const;

type Row = Record<string, string | number>;

const csvCell = (value: string | number): string => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (fields: ReadonlyArray<string>, rows: Row[]): string =>
  [
    fields.join(','),
    ...rows.map((row) => fields.map((f) => csvCell(row[f])).join(',')),
  ]
    .join('\r\n')
    .concat('\r\n');

const pad = (value: number | string, length: number): string =>
  String(value).padStart(length, '0');

/** Insurance-list figures of one worker, derived from the payslip. */
export function workerAmounts(worker: InsuranceListWorker): {
  rooz: number;
  mah: number;
  maz: number;
  mash: number;
  totl: number;
} {
  const mash = Math.round(worker.insurableWage);
  const mah = Math.min(Math.round(worker.dailyWage * worker.workDays), mash);
  return {
    rooz: Math.round(worker.dailyWage),
    mah,
    maz: mash - mah,
    mash,
    totl: Math.max(mash, Math.round(worker.grossPay)),
  };
}

export function buildInsuranceList(
  workshop: InsuranceListWorkshop,
  periodYear: number,
  periodMonth: number,
  workers: InsuranceListWorker[],
  employerRatePercent: number,
): InsuranceListFiles {
  const yy = pad(periodYear % 100, 2);
  const mm = pad(periodMonth, 2);
  const listNo = pad(workshop.listNumber ?? '01', 2);
  const warnings: string[] = [];

  const totals = {
    dd: 0,
    rooz: 0,
    mah: 0,
    maz: 0,
    mash: 0,
    totl: 0,
    bime: 0,
    koso: 0,
    bic: 0,
  };

  const workerRows: Row[] = workers.map((worker) => {
    const amounts = workerAmounts(worker);
    if (!worker.insuranceNumber) {
      warnings.push(
        `شماره بیمه برای ${worker.firstName} ${worker.lastName} (${worker.nationalId}) ثبت نشده است.`,
      );
    }
    totals.dd += worker.workDays;
    totals.rooz += amounts.rooz;
    totals.mah += amounts.mah;
    totals.maz += amounts.maz;
    totals.mash += amounts.mash;
    totals.totl += amounts.totl;
    totals.bime += Math.round(worker.employeeInsurance);
    totals.koso += Math.round(worker.employerInsurance);
    totals.bic += Math.round(worker.unemploymentInsurance);
    return {
      DSW_ID: workshop.workshopCode,
      DSW_YY: yy,
      DSW_MM: mm,
      DSW_LISTNO: listNo,
      DSW_ID1: worker.insuranceNumber ?? '',
      DSW_FNAME: worker.firstName,
      DSW_LNAME: worker.lastName,
      DSW_DNAME: worker.fatherName ?? '',
      DSW_IDNO: worker.nationalId,
      DSW_IDPLC: '',
      DSW_IDATE: '',
      DSW_BDATE: worker.birthDate,
      DSW_SEX: worker.gender === 'FEMALE' ? 'زن' : 'مرد',
      DSW_NAT: 'ایرانی',
      DSW_OCP: worker.jobTitle,
      DSW_SDATE: worker.startDate,
      DSW_EDATE: worker.endDate,
      DSW_DD: worker.workDays,
      DSW_ROOZ: amounts.rooz,
      DSW_MAH: amounts.mah,
      DSW_MAZ: amounts.maz,
      DSW_MASH: amounts.mash,
      DSW_TOTL: amounts.totl,
      DSW_BIME: Math.round(worker.employeeInsurance),
      DSW_PRATE: 0,
      DSW_JOB: '',
      PER_NATCOD: worker.nationalId,
    };
  });

  const header: Row = {
    DSK_ID: workshop.workshopCode,
    DSK_NAME: workshop.workshopName,
    DSK_FARM: workshop.employerName,
    DSK_ADRS: workshop.workshopAddress ?? '',
    DSK_KIND: 0,
    DSK_YY: yy,
    DSK_MM: mm,
    DSK_LISTNO: listNo,
    DSK_DISC: workshop.description ?? `لیست بیمه ${periodYear}/${mm}`,
    DSK_NUM: workers.length,
    DSK_TDD: totals.dd,
    DSK_TROOZ: totals.rooz,
    DSK_TMAH: totals.mah,
    DSK_TMAZ: totals.maz,
    DSK_TMASH: totals.mash,
    DSK_TTOTL: totals.totl,
    DSK_TBIME: totals.bime,
    DSK_TKOSO: totals.koso,
    DSK_BIC: totals.bic,
    DSK_RATE: employerRatePercent,
    DSK_PRATE: 0,
    DSK_BIMH: 0,
    MON_PYM: workshop.contractRow ?? '000',
  };

  return {
    workshopFileName: 'DSKKAR00.csv',
    workshopFile: toCsv(DSKKAR_FIELDS, [header]),
    workersFileName: 'DSKWOR00.csv',
    workersFile: toCsv(DSKWOR_FIELDS, workerRows),
    warnings,
  };
}
