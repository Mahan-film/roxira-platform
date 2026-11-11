/**
 * Synthetic, non-confidential Sepidar test fixtures for Part 2 migration.
 * Contains open (uncleared) cheques with 16-digit Sayad IDs and FIFO opening layers.
 */

export interface SepidarRawCheque {
  ChequeId: number;
  ChequeNumber: string;
  SayadNumber: string;
  Direction: 'received' | 'issued';
  State: 'in_hand' | 'deposited' | 'spent' | 'delivered' | 'cleared' | 'bounced' | 'returned';
  Amount: number; // in IRR
  IssueDate: string; // YYYY-MM-DD
  DueDate: string; // YYYY-MM-DD
  PartyCode: string;
  PartyName: string;
  BankName: string;
  BranchName?: string;
  BankAccountNumber?: string;
  // Endorsement fields (برای چک‌های خرج شده / واگذار شده به غیر)
  SpentToPartyCode?: string;
  SpentToPartyName?: string;
  SpentToNationalId?: string;
  ReceiverNationalId?: string;
  Description?: string;
}

export interface SepidarRawFifoBatch {
  InventoryLayerId: number;
  ItemCode: string;
  ItemTitle: string;
  WarehouseId: number;
  WarehouseTitle: string;
  BatchNumber: string;
  Quantity: number;
  UnitPurchaseCost: number; // in IRR
  ReceivedDate: string; // ISO date string
  PrimaryUnit: string;
  SecondaryQuantity?: number;
  SecondaryUnit?: string;
  SerialNumbers?: string[];
}

/**
 * 100% synthetic open cheques dataset.
 * Zero confidential customer data.
 */
export const SYNTHETIC_SEPIDAR_CHEQUES: SepidarRawCheque[] = [
  // 1. Received open cheque: In Hand (نزد صندوق / شرکت)
  {
    ChequeId: 1001,
    ChequeNumber: 'CHQ-REC-001',
    SayadNumber: '1234567890123456',
    Direction: 'received',
    State: 'in_hand',
    Amount: 150000000, // 150,000,000 IRR
    IssueDate: '2026-09-15',
    DueDate: '2026-11-25',
    PartyCode: 'CUST-001',
    PartyName: 'شرکت تجارت الکترونیک آریا (نمونه)',
    BankName: 'بانک ملت',
    BranchName: 'شعبه مرکزی',
    ReceiverNationalId: '10103456789',
    Description: 'بابت تسویه فاکتور فروش شماره 401',
  },
  // 2. Received open cheque: Deposited to Bank (واگذار شده به بانک جهت وصول)
  {
    ChequeId: 1002,
    ChequeNumber: 'CHQ-REC-002',
    SayadNumber: '2345678901234567',
    Direction: 'received',
    State: 'deposited',
    Amount: 280000000, // 280,000,000 IRR
    IssueDate: '2026-10-01',
    DueDate: '2026-12-10',
    PartyCode: 'CUST-002',
    PartyName: 'فروشگاه برادران حسینی (نمونه)',
    BankName: 'بانک صادرات',
    BranchName: 'شعبه آزادی',
    BankAccountNumber: '0205567890001',
    ReceiverNationalId: '10103456789',
    Description: 'بابت پیش‌پرداخت قرارداد تامین مواد',
  },
  // 3. Received open cheque: Spent / Endorsed to Third Party (خرج شده / ظهرنویسی به تأمین‌کننده)
  {
    ChequeId: 1003,
    ChequeNumber: 'CHQ-REC-003',
    SayadNumber: '3456789012345678',
    Direction: 'received',
    State: 'spent',
    Amount: 95000000, // 95,000,000 IRR
    IssueDate: '2026-10-10',
    DueDate: '2026-11-30',
    PartyCode: 'CUST-003',
    PartyName: 'صنایع بسته‌بندی امید (نمونه)',
    BankName: 'بانک تجارت',
    SpentToPartyCode: 'SUPP-001',
    SpentToPartyName: 'فولاد مبارکه اصفهان (نمونه)',
    SpentToNationalId: '10260289456',
    Description: 'ظهرنویسی به تأمین‌کننده بابت خرید مواد اولیه',
  },
  // 4. Issued open cheque: In checkbook / Registered (نزد شرکت / صادر شده)
  {
    ChequeId: 1004,
    ChequeNumber: 'CHQ-ISS-001',
    SayadNumber: '4567890123456789',
    Direction: 'issued',
    State: 'in_hand',
    Amount: 320000000, // 320,000,000 IRR
    IssueDate: '2026-10-20',
    DueDate: '2026-12-25',
    PartyCode: 'SUPP-002',
    PartyName: 'پتروشیمی جم (نمونه)',
    BankName: 'بانک سامان',
    BankAccountNumber: '810-100-554433-1',
    Description: 'چک پرداختی بابت سفارش خرید پلی‌اتیلن',
  },
  // 5. Issued open cheque: Delivered to Payee (تحویل داده شده به طرف حساب)
  {
    ChequeId: 1005,
    ChequeNumber: 'CHQ-ISS-002',
    SayadNumber: '5678901234567890',
    Direction: 'issued',
    State: 'delivered',
    Amount: 110000000, // 110,000,000 IRR
    IssueDate: '2026-11-01',
    DueDate: '2026-12-05',
    PartyCode: 'SUPP-003',
    PartyName: 'پارس کارتن گستر (نمونه)',
    BankName: 'بانک ملی ایران',
    BankAccountNumber: '0105678901004',
    Description: 'تحویل چک به نماینده شرکت پارس کارتن',
  },
  // 6. Already cleared cheque (should be excluded from open cheques)
  {
    ChequeId: 1006,
    ChequeNumber: 'CHQ-REC-OLD',
    SayadNumber: '6789012345678901',
    Direction: 'received',
    State: 'cleared',
    Amount: 50000000,
    IssueDate: '2026-08-01',
    DueDate: '2026-09-01',
    PartyCode: 'CUST-001',
    PartyName: 'شرکت تجارت الکترونیک آریا (نمونه)',
    BankName: 'بانک ملت',
  },
  // 7. Returned/bounced cheque (should be excluded from open cheques)
  {
    ChequeId: 1007,
    ChequeNumber: 'CHQ-REC-BOUNCE',
    SayadNumber: '7890123456789012',
    Direction: 'received',
    State: 'bounced',
    Amount: 40000000,
    IssueDate: '2026-08-15',
    DueDate: '2026-09-15',
    PartyCode: 'CUST-002',
    PartyName: 'فروشگاه برادران حسینی (نمونه)',
    BankName: 'بانک صادرات',
  },
];

/**
 * 100% synthetic Sepidar FIFO opening inventory layers.
 */
export const SYNTHETIC_SEPIDAR_FIFO_LAYERS: SepidarRawFifoBatch[] = [
  {
    InventoryLayerId: 501,
    ItemCode: 'SKU-STEEL-COIL',
    ItemTitle: 'ورق فولادی روغنی ۰.۷ میلی‌متر',
    WarehouseId: 1,
    WarehouseTitle: 'انبار مرکزی مواد اولیه',
    BatchNumber: 'BAT-2026-01',
    Quantity: 25.0,
    UnitPurchaseCost: 120000000, // 120,000,000 IRR/ton
    ReceivedDate: '2026-03-20T08:00:00.000Z',
    PrimaryUnit: 'ton',
    SecondaryQuantity: 25000,
    SecondaryUnit: 'kg',
    SerialNumbers: ['SN-STL-01', 'SN-STL-02'],
  },
  {
    InventoryLayerId: 502,
    ItemCode: 'SKU-STEEL-COIL',
    ItemTitle: 'ورق فولادی روغنی ۰.۷ میلی‌متر',
    WarehouseId: 1,
    WarehouseTitle: 'انبار مرکزی مواد اولیه',
    BatchNumber: 'BAT-2026-02',
    Quantity: 15.0,
    UnitPurchaseCost: 125000000, // 125,000,000 IRR/ton (price increased later)
    ReceivedDate: '2026-04-10T09:30:00.000Z',
    PrimaryUnit: 'ton',
    SecondaryQuantity: 15000,
    SecondaryUnit: 'kg',
  },
  {
    InventoryLayerId: 503,
    ItemCode: 'SKU-COPPER-ROD',
    ItemTitle: 'مفتول مسی ۸ میلی‌متر',
    WarehouseId: 2,
    WarehouseTitle: 'انبار محصولات نیمه‌ساخته',
    BatchNumber: 'BAT-2026-03',
    Quantity: 50.0,
    UnitPurchaseCost: 45000000, // 45,000,000 IRR/roll
    ReceivedDate: '2026-05-15T11:00:00.000Z',
    PrimaryUnit: 'roll',
    SecondaryQuantity: 500,
    SecondaryUnit: 'meter',
  },
  {
    InventoryLayerId: 504,
    ItemCode: 'SKU-ALUM-SHEET',
    ItemTitle: 'ورق آلومینیوم ۱ میلی‌متر',
    WarehouseId: 1,
    WarehouseTitle: 'انبار مرکزی مواد اولیه',
    BatchNumber: 'BAT-2026-04',
    Quantity: 100.0,
    UnitPurchaseCost: 18500000, // 18,500,000 IRR/sheet
    ReceivedDate: '2026-06-01T14:00:00.000Z',
    PrimaryUnit: 'sheet',
  },
];
