/**
 * PURE SYNTHETIC (MOCK) FIXTURE FOR SEPIDAR MIGRATION TESTS.
 * Strictly artificial data — NO REAL CUSTOMER DATA committed (#230 / T78).
 */

import {
  SepidarRawAccount,
  SepidarRawItem,
  SepidarRawParty,
  SepidarRawVoucherItem,
} from '../migration/bak/sepidar-raw-types';

export {
  SepidarRawAccount,
  SepidarRawItem,
  SepidarRawParty,
  SepidarRawVoucherItem,
};

export const SYNTHETIC_SEPIDAR_ACCOUNTS: SepidarRawAccount[] = [
  // Level 1: Gorouh (گروه)
  { AccountID: 1, Code: '1', Title: 'دارایی‌های جاری', Level: 1, ParentAccountID: null },
  { AccountID: 2, Code: '2', Title: 'بدهی‌های جاری', Level: 1, ParentAccountID: null },
  { AccountID: 3, Code: '3', Title: 'حقوق صاحبان سهام', Level: 1, ParentAccountID: null },

  // Level 2: Kol (کل)
  { AccountID: 10, Code: '10', Title: 'موجودی نقد و بانک', Level: 2, ParentAccountID: 1 },
  { AccountID: 11, Code: '11', Title: 'حساب‌های دریافتنی تجاری', Level: 2, ParentAccountID: 1 },
  { AccountID: 12, Code: '12', Title: 'موجودی مواد و کالا', Level: 2, ParentAccountID: 1 },
  { AccountID: 20, Code: '20', Title: 'حساب‌های پرداختنی تجاری', Level: 2, ParentAccountID: 2 },
  { AccountID: 30, Code: '30', Title: 'سرمایه اول دوره', Level: 2, ParentAccountID: 3 },

  // Level 3: Moein (معین)
  { AccountID: 101, Code: '1010', Title: 'صندوق ریالی', Level: 3, ParentAccountID: 10 },
  { AccountID: 102, Code: '1020', Title: 'بانک‌های ریالی', Level: 3, ParentAccountID: 10 },
  { AccountID: 111, Code: '1110', Title: 'بدهکاران تجاری داخلی', Level: 3, ParentAccountID: 11 },
  { AccountID: 121, Code: '1210', Title: 'موجودی کالای تجاری', Level: 3, ParentAccountID: 12 },
  { AccountID: 201, Code: '2010', Title: 'بستانکاران تجاری داخلی', Level: 3, ParentAccountID: 20 },
  { AccountID: 301, Code: '3010', Title: 'سرمایه ثبت‌شده', Level: 3, ParentAccountID: 30 },

  // Level 4: Tafsili (تفصیلی)
  { AccountID: 10201, Code: '102001', Title: 'بانک ملت شعبه مرکزی', Level: 4, ParentAccountID: 102 },
  { AccountID: 10202, Code: '102002', Title: 'بانک سامان شعبه ونک', Level: 4, ParentAccountID: 102 },

  // Floating Detail (تفصیلی شناور)
  { AccountID: 9001, Code: 'F-001', Title: 'مرکز هزینه دفتر مرکزی', Level: 4, ParentAccountID: null, IsFloatingDetail: true },
  { AccountID: 9002, Code: 'F-002', Title: 'پروژه استقرار نرم‌افزار', Level: 4, ParentAccountID: null, IsFloatingDetail: true },
];

export const SYNTHETIC_SEPIDAR_PARTIES: SepidarRawParty[] = [
  {
    PartyID: 101,
    Code: 'PRT-1001',
    Title: 'شرکت فناوران دانش سپهر',
    NationalCode: '10102030405',
    EconomicCode: '4111222333',
    Phone: '02188990011',
    IsCustomer: true,
    IsVendor: false,
  },
  {
    PartyID: 102,
    Code: 'PRT-1002',
    Title: 'تأمین الکترونیک خاورمیانه',
    NationalCode: '10109988776',
    EconomicCode: '4111555666',
    Phone: '02177889900',
    IsCustomer: false,
    IsVendor: true,
  },
  {
    PartyID: 103,
    Code: 'PRT-1003',
    Title: 'صنایع پخش آریا (دوگانه)',
    NationalCode: '10103344556',
    EconomicCode: '4111777888',
    Phone: '02122334455',
    IsCustomer: true,
    IsVendor: true,
  },
];

export const SYNTHETIC_SEPIDAR_ITEMS: SepidarRawItem[] = [
  {
    ItemID: 201,
    Code: 'SKU-SEP-001',
    Title: 'ماژول شبکه صنعتی',
    Barcode: '6269988776655',
    UnitTitle: 'عدد',
    SecondaryUnitTitle: 'کارتن',
    UnitConversionRate: 10,
    CategoryTitle: 'تجهیزات شبکه',
  },
  {
    ItemID: 202,
    Code: 'SKU-SEP-002',
    Title: 'کابل فیبر نوری پچ‌کورد',
    Barcode: '6261122334455',
    UnitTitle: 'متر',
    SecondaryUnitTitle: 'کلاف',
    UnitConversionRate: 100,
    CategoryTitle: 'کابل و اتصالات',
  },
];

/**
 * Opening balance voucher items.
 * Total Debit: 50,000,000 + 120,000,000 + 80,000,000 = 250,000,000 Rials
 * Total Credit: 70,000,000 + 180,000,000 = 250,000,000 Rials
 * Variance: 0 Rials (Balanced)
 */
export const SYNTHETIC_SEPIDAR_OPENING_VOUCHER: SepidarRawVoucherItem[] = [
  {
    VoucherItemID: 1,
    AccountCode: '1010',
    Debit: 50_000_000,
    Credit: 0,
    Description: 'موجودی اولیه صندوق ریالی',
  },
  {
    VoucherItemID: 2,
    AccountCode: '102001',
    FloatingDetailCode: 'F-001',
    Debit: 120_000_000,
    Credit: 0,
    Description: 'موجودی اولیه بانک ملت',
  },
  {
    VoucherItemID: 3,
    AccountCode: '1210',
    Debit: 80_000_000,
    Credit: 0,
    Description: 'ارزش موجودی اولیه انبار کالای تجاری',
  },
  {
    VoucherItemID: 4,
    AccountCode: '2010',
    FloatingDetailCode: 'PRT-1002',
    Debit: 0,
    Credit: 70_000_000,
    Description: 'مانده اولیه بدهی به تأمین‌کننده',
  },
  {
    VoucherItemID: 5,
    AccountCode: '3010',
    Debit: 0,
    Credit: 180_000_000,
    Description: 'سرمایه اولیه ثبتی موسسان',
  },
];
