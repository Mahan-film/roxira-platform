/**
 * PURE SYNTHETIC (MOCK) FIXTURE FOR HOLOO MIGRATION TESTS.
 * Strictly artificial test data — NO REAL CUSTOMER DATA committed (#230 / T89).
 */

import {
  HolooRawAccount,
  HolooRawItem,
  HolooRawParty,
  HolooRawVoucherItem,
} from '../migration/bak/holoo-raw-types';

export {
  HolooRawAccount,
  HolooRawItem,
  HolooRawParty,
  HolooRawVoucherItem,
};

export const SYNTHETIC_HOLOO_ACCOUNTS: HolooRawAccount[] = [
  // Level 1: Group (گروه)
  { AccountId: 1, Code: '1', Name: 'دارایی‌های جاری', Level: 1, ParentCode: null },
  { AccountId: 2, Code: '2', Name: 'بدهی‌های جاری', Level: 1, ParentCode: null },
  { AccountId: 3, Code: '3', Name: 'حقوق صاحبان سهام', Level: 1, ParentCode: null },

  // Level 2: Kol (کل)
  { AccountId: 10, Code: '10', Name: 'موجودی نقد و بانک', Level: 2, ParentCode: '1' },
  { AccountId: 11, Code: '11', Name: 'حساب‌های دریافتنی تجاری', Level: 2, ParentCode: '1' },
  { AccountId: 12, Code: '12', Name: 'موجودی مواد و کالا', Level: 2, ParentCode: '1' },
  { AccountId: 20, Code: '20', Name: 'حساب‌های پرداختنی تجاری', Level: 2, ParentCode: '2' },
  { AccountId: 30, Code: '30', Name: 'سرمایه اولیه', Level: 2, ParentCode: '3' },

  // Level 3: Moein (معین)
  { AccountId: 1010, Code: '1010', Name: 'صندوق ریالی', Level: 3, ParentCode: '10' },
  { AccountId: 1020, Code: '1020', Name: 'بانک‌های ریالی', Level: 3, ParentCode: '10' },
  { AccountId: 1110, Code: '1110', Name: 'بدهکاران تجاری داخلی', Level: 3, ParentCode: '11' },
  { AccountId: 1210, Code: '1210', Name: 'موجودی انبار کالا', Level: 3, ParentCode: '12' },
  { AccountId: 2010, Code: '2010', Name: 'بستانکاران تجاری داخلی', Level: 3, ParentCode: '20' },
  { AccountId: 3010, Code: '3010', Name: 'سرمایه ثبت‌شده موسسان', Level: 3, ParentCode: '30' },

  // Level 4: Tafsili (تفصیلی)
  { AccountId: 102001, Code: '102001', Name: 'بانک ملت شعبه مرکزی', Level: 4, ParentCode: '1020' },

  // Floating Detail (تفصیلی شناور)
  { AccountId: 9001, Code: 'F-101', Name: 'مرکز هزینه فروش و توزیع', Level: 4, ParentCode: null, IsFloatingDetail: true },
  { AccountId: 9002, Code: 'F-102', Name: 'پروژه استقرار شعب', Level: 4, ParentCode: null, IsFloatingDetail: true },
];

export const SYNTHETIC_HOLOO_PARTIES: HolooRawParty[] = [
  {
    PartyId: 101,
    Code: 'HLO-CUS-01',
    Name: 'فروشگاه الکترونیک پارس',
    IsCustomer: true,
    IsSupplier: false,
    NationalCode: '10102030405',
    EconomicCode: '4111222333',
    Phone: '02188990011',
  },
  {
    PartyId: 102,
    Code: 'HLO-SUP-01',
    Name: 'صنایع فولاد کاسپین',
    IsCustomer: false,
    IsSupplier: true,
    NationalCode: '10109988776',
    EconomicCode: '4111555666',
    Phone: '02177889900',
  },
  {
    PartyId: 103,
    Code: 'HLO-BOTH-01',
    Name: 'توزیع و بازرگانی سپهر (دوگانه)',
    IsCustomer: true,
    IsSupplier: true,
    NationalCode: '10103344556',
    EconomicCode: '4111777888',
    Phone: '02122334455',
  },
];

export const SYNTHETIC_HOLOO_ITEMS: HolooRawItem[] = [
  {
    ItemId: 201,
    Code: 'HLO-SKU-001',
    Name: 'سنسور حرارتی صنعتی',
    Barcode: '6261122334455',
    Unit: 'عدد',
    SecondaryUnit: 'بسته',
    UnitRatio: 12,
    Category: 'ابزار دقیق',
  },
  {
    ItemId: 202,
    Code: 'HLO-SKU-002',
    Name: 'سیم نسوز سیلیکونی',
    Barcode: '6269988776655',
    Unit: 'متر',
    SecondaryUnit: 'قرقره',
    UnitRatio: 50,
    Category: 'سیم و کابل',
  },
];

/**
 * Opening balance voucher items.
 * Total Debit: 30,000,000 + 70,000,000 + 50,000,000 = 150,000,000 Rials
 * Total Credit: 40,000,000 + 110,000,000 = 150,000,000 Rials
 * Variance: 0 Rials (Balanced)
 */
export const SYNTHETIC_HOLOO_OPENING_VOUCHER: HolooRawVoucherItem[] = [
  {
    SanadId: 1,
    AccountCode: '1010',
    Debit: 30_000_000,
    Credit: 0,
    Description: 'موجودی اولیه صندوق ریالی هلو',
  },
  {
    SanadId: 2,
    AccountCode: '102001',
    FloatingDetailCode: 'F-101',
    Debit: 70_000_000,
    Credit: 0,
    Description: 'مانده افتتاحیه بانک ملت',
  },
  {
    SanadId: 3,
    AccountCode: '1210',
    Debit: 50_000_000,
    Credit: 0,
    Description: 'ارزش موجودی اولیه انبار کالا',
  },
  {
    SanadId: 4,
    AccountCode: '2010',
    FloatingDetailCode: 'HLO-SUP-01',
    Debit: 0,
    Credit: 40_000_000,
    Description: 'مانده اولیه بدهی به تأمین‌کننده',
  },
  {
    SanadId: 5,
    AccountCode: '3010',
    Debit: 0,
    Credit: 110_000_000,
    Description: 'سرمایه ثبتی اولیه سهامداران',
  },
];
