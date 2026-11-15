/**
 * Pure synthetic Holoo (هلو) fixtures for import dry-run verification (T100).
 * Strictly artificial data — zero customer data.
 */

export interface HolooDryRunRawAccount {
  AccountId: number;
  Code: string;
  Name: string;
  Level: number;
  ParentCode?: string | null;
  IsFloatingDetail?: boolean;
}

export interface HolooDryRunRawParty {
  PartyId: number;
  Code: string;
  Name: string;
  IsCustomer: boolean;
  IsSupplier: boolean;
  NationalCode?: string | null;
  EconomicCode?: string | null;
  Phone?: string | null;
  Mobile?: string | null;
}

export interface HolooDryRunRawItem {
  ItemId: number;
  Code: string;
  Name: string;
  Barcode?: string | null;
  Unit: string;
  SecondaryUnit?: string | null;
  UnitRatio?: number | string | null;
  Category?: string | null;
}

export interface HolooDryRunRawVoucherItem {
  SanadId: number;
  AccountCode: string;
  FloatingDetailCode?: string | null;
  Debit: number | string;
  Credit: number | string;
  Description?: string | null;
}

export interface HolooDryRunRawCheque {
  ChequeId: number;
  ChequeNumber: string;
  SayadNumber: string;
  Direction: 'received' | 'issued';
  State: 'in_hand' | 'deposited' | 'spent' | 'delivered' | 'cleared' | 'bounced' | 'returned';
  Amount: number | string;
  IssueDate: string;
  DueDate: string;
  PartyCode: string;
  PartyName: string;
  BankName: string;
  SpentToPartyCode?: string | null;
  SpentToPartyName?: string | null;
  SpentToNationalId?: string | null;
  ReceiverNationalId?: string | null;
  Description?: string | null;
}

export const SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS: HolooDryRunRawAccount[] = [
  { AccountId: 1, Code: '1', Name: 'دارایی‌های جاری', Level: 1, ParentCode: null },
  { AccountId: 2, Code: '2', Name: 'بدهی‌های جاری', Level: 1, ParentCode: null },
  { AccountId: 3, Code: '3', Name: 'حقوق صاحبان سهام', Level: 1, ParentCode: null },
  { AccountId: 10, Code: '10', Name: 'موجودی نقد و بانک', Level: 2, ParentCode: '1' },
  { AccountId: 12, Code: '12', Name: 'موجودی مواد و کالا', Level: 2, ParentCode: '1' },
  { AccountId: 20, Code: '20', Name: 'حساب‌های پرداختنی تجاری', Level: 2, ParentCode: '2' },
  { AccountId: 30, Code: '30', Name: 'سرمایه اولیه', Level: 2, ParentCode: '3' },
  { AccountId: 1010, Code: '1010', Name: 'صندوق ریالی', Level: 3, ParentCode: '10' },
  { AccountId: 1020, Code: '1020', Name: 'بانک‌های ریالی', Level: 3, ParentCode: '10' },
  { AccountId: 1210, Code: '1210', Name: 'موجودی انبار کالا', Level: 3, ParentCode: '12' },
  { AccountId: 2010, Code: '2010', Name: 'بستانکاران تجاری داخلی', Level: 3, ParentCode: '20' },
  { AccountId: 3010, Code: '3010', Name: 'سرمایه ثبت‌شده موسسان', Level: 3, ParentCode: '30' },
  { AccountId: 102001, Code: '102001', Name: 'بانک ملت شعبه مرکزی', Level: 4, ParentCode: '1020' },
  { AccountId: 9001, Code: 'F-101', Name: 'مرکز هزینه فروش و توزیع', Level: 4, ParentCode: null, IsFloatingDetail: true },
];

export const SYNTHETIC_HOLOO_DRY_RUN_PARTIES: HolooDryRunRawParty[] = [
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

export const SYNTHETIC_HOLOO_DRY_RUN_ITEMS: HolooDryRunRawItem[] = [
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

export const SYNTHETIC_HOLOO_DRY_RUN_OPENING_VOUCHER: HolooDryRunRawVoucherItem[] = [
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

/** 2 open cheques (received 85M + issued 45M = 130M IRR) + 1 cleared cheque (excluded). */
export const SYNTHETIC_HOLOO_DRY_RUN_CHEQUES: HolooDryRunRawCheque[] = [
  {
    ChequeId: 501,
    ChequeNumber: 'HLO-CHQ-001',
    SayadNumber: '1122334455667788',
    Direction: 'received',
    State: 'in_hand',
    Amount: 85_000_000,
    IssueDate: '2026-10-01',
    DueDate: '2026-12-01',
    PartyCode: 'HLO-CUS-01',
    PartyName: 'فروشگاه الکترونیک پارس',
    BankName: 'بانک ملت',
    ReceiverNationalId: '10102030405',
    Description: 'چک دریافتنی باز انتقالی از هلو',
  },
  {
    ChequeId: 502,
    ChequeNumber: 'HLO-CHQ-002',
    SayadNumber: '2233445566778899',
    Direction: 'issued',
    State: 'delivered',
    Amount: 45_000_000,
    IssueDate: '2026-10-12',
    DueDate: '2026-12-20',
    PartyCode: 'HLO-SUP-01',
    PartyName: 'صنایع فولاد کاسپین',
    BankName: 'بانک سامان',
    Description: 'چک پرداختنی باز انتقالی از هلو',
  },
  {
    ChequeId: 503,
    ChequeNumber: 'HLO-CHQ-OLD',
    SayadNumber: '3344556677889900',
    Direction: 'received',
    State: 'cleared',
    Amount: 20_000_000,
    IssueDate: '2026-08-01',
    DueDate: '2026-09-01',
    PartyCode: 'HLO-CUS-01',
    PartyName: 'فروشگاه الکترونیک پارس',
    BankName: 'بانک ملت',
  },
];
