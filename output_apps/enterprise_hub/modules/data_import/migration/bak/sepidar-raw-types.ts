/**
 * TypeScript types modeling raw Sepidar SQL Server tables extracted from .bak backup files.
 * Purely structural definitions with no customer or proprietary data.
 */

export interface SepidarRawAccount {
  AccountID: number;
  Code: string;
  Title: string;
  Level: number; // 1: Gorouh, 2: Kol, 3: Moein, 4: Tafsili
  ParentAccountID: number | null;
  IsFloatingDetail?: boolean;
}

export interface SepidarRawParty {
  PartyID: number;
  Code: string;
  Title: string;
  IsCustomer: boolean;
  IsVendor: boolean;
  NationalCode?: string | null;
  EconomicCode?: string | null;
  Phone?: string | null;
}

export interface SepidarRawItem {
  ItemID: number;
  Code: string;
  Title: string;
  Barcode?: string | null;
  UnitTitle: string;
  SecondaryUnitTitle?: string | null;
  UnitConversionRate?: number | string | null;
  CategoryTitle?: string | null;
}

export interface SepidarRawVoucherItem {
  VoucherItemID: number;
  AccountCode: string;
  FloatingDetailCode?: string | null;
  Debit: number | string | bigint;
  Credit: number | string | bigint;
  Description?: string | null;
}
