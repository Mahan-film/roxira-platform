import { readDbf, writeDbf } from './services/dbf-file';
import {
  buildInsuranceList,
  compareInsuranceTotals,
  DSKKAR_LAYOUT,
  DSKWOR_LAYOUT,
  InsuranceListWorker,
} from './services/insurance-list';
import { buildWageTaxFiles, WageTaxPerson } from './services/wage-tax-files';

const M = 1_000_000;
const worker: InsuranceListWorker = {
  insuranceNumber: '12345678',
  firstName: 'علی',
  lastName: 'کریمی',
  fatherName: 'حسن',
  nationalId: '0012345679',
  birthDate: '13700101',
  gender: 'MALE',
  jobTitle: 'کارگر',
  startDate: '',
  endDate: '',
  workDays: 31,
  dailyWage: 5 * M,
  insurableWage: 185 * M,
  grossPay: 185 * M,
  employeeInsurance: 12_950_000,
  employerInsurance: 37 * M,
  unemploymentInsurance: 5_550_000,
};
const list = (workers: InsuranceListWorker[]) =>
  buildInsuranceList(
    { workshopCode: '1234567890', workshopName: 'کارگاه', employerName: 'کارفرما' },
    1405,
    1,
    workers,
    23,
  );

describe('DBF files', () => {
  it('round-trips Persian text and numbers with a valid dBase III header', () => {
    const fields = [
      { name: 'NAME', type: 'C' as const, length: 20 },
      { name: 'AMT', type: 'N' as const, length: 12 },
    ];
    const file = writeDbf(fields, [{ NAME: 'پیمان یکتا', AMT: 123 }], new Date(Date.UTC(2026, 9, 31)));
    expect(file[0]).toBe(3);
    expect(file.readUInt32LE(4)).toBe(1);
    expect(file[file.length - 1]).toBe(0x1a);
    expect(readDbf(file)).toEqual([{ NAME: 'پيمان يکتا', AMT: 123 }]);
  });

  it('refuses a number wider than its column instead of cutting it', () => {
    expect(() =>
      writeDbf([{ name: 'AMT', type: 'N', length: 2 }], [{ AMT: 123 }], new Date()),
    ).toThrow(/wider/);
  });

  it('INS-01: worker rows total to the workshop row in the DBF bytes', () => {
    const files = list([worker, worker]);
    const [kar] = readDbf(Buffer.from(files.workshopDbf, 'base64'));
    const wor = readDbf(Buffer.from(files.workersDbf, 'base64'));
    expect(kar).toMatchObject({
      DSK_NUM: 2,
      DSK_TDD: 62,
      DSK_TROOZ: 10 * M,
      DSK_TMAH: 310 * M,
      DSK_TMAZ: 60 * M,
      DSK_TKOSO: 74 * M,
      DSK_BIC: 11_100_000,
      MON_PYM: '000',
    });
    expect(wor[0].DSW_ID1).toBe('0012345678');
    expect(compareInsuranceTotals(kar, wor)).toEqual([]);
    expect(files.uploadReady).toBe(false);
  });

  it('names every total that disagrees', () => {
    const files = list([worker]);
    const [kar] = readDbf(Buffer.from(files.workshopDbf, 'base64'));
    const wor = readDbf(Buffer.from(files.workersDbf, 'base64'));
    expect(
      compareInsuranceTotals({ ...kar, DSK_TMAH: 1 }, wor)[0],
    ).toContain('DSK_TMAH');
    expect(compareInsuranceTotals({ ...kar, DSK_NUM: 9 }, wor)[0]).toContain('DSK_NUM');
  });

  it('layouts carry exactly the CSV columns, with the report lengths', () => {
    expect(DSKKAR_LAYOUT.find((f) => f.name === 'DSK_ID')?.length).toBe(10);
    expect(DSKKAR_LAYOUT.find((f) => f.name === 'MON_PYM')?.length).toBe(3);
    expect(DSKWOR_LAYOUT.find((f) => f.name === 'DSW_ID1')?.length).toBe(10);
  });

  it('lists what no source confirms and stays not upload ready', () => {
    const files = list([worker]);
    expect(files.unverified.length).toBeGreaterThan(0);
    expect(files.unverified.join(' ')).toContain('کدپیج');
    expect(files.uploadReady).toBe(files.unverified.length === 0);
  });

  it('warns when a name is cut to the published column width', () => {
    const files = list([{ ...worker, lastName: 'ا'.repeat(51) }]);
    expect(files.warnings.join(' ')).toContain('DSKWOR00.DSW_LNAME');
  });
});

describe('wage tax working files', () => {
  const person: WageTaxPerson = {
    nationalId: '0012345679',
    firstName: 'علی',
    lastName: 'کریمی',
    fatherName: null,
    birthDate: '13700101',
    isNew: true,
    workDays: 31,
    basePay: 100,
    overtimePay: 0,
    allowances: 20,
    nonCash: 0,
    eidi: 0,
    grossPay: 120,
    employeeInsurance: 8,
    taxableIncome: 112,
    incomeTax: 5,
  };

  it('lists only new staff in WP, everyone in WH, and is never upload ready', () => {
    const files = buildWageTaxFiles(
      1405,
      1,
      'MAIN',
      [person, { ...person, nationalId: '0098765432', isNew: false }],
      { totalGross: 240, totalTax: 10 },
    );
    expect(files.wpFile.trim().split('\r\n')).toHaveLength(2);
    expect(files.whFile.trim().split('\r\n')).toHaveLength(3);
    expect(files.wpFileName).toBe('WP-140501-working.csv');
    expect(files.uploadReady).toBe(false);
    expect(files.unverified.length).toBeGreaterThan(0);
    expect(files.unverified.join(' ')).toContain('WP');
  });

  it('refuses rows that do not add up to the run', () => {
    expect(() =>
      buildWageTaxFiles(1405, 1, 'MAIN', [person], { totalGross: 121, totalTax: 5 }),
    ).toThrow(/disagree/);
  });
});
