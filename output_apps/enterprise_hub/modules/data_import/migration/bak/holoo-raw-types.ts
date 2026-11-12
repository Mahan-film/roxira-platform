/**
 * TypeScript types modeling raw Holoo (هلو) database structures.
 * Purely structural definitions with zero customer or proprietary data (#230 / T89).
 */

export interface HolooRawAccount {
  AccountId: number;
  Code: string;
  Name: string;
  Level: number; // 1: Group (گروه), 2: Kol (کل), 3: Moein (معین), 4: Tafsili (تفصیلی)
  ParentCode?: string | null;
  IsFloatingDetail?: boolean;
}

export interface HolooRawParty {
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

export interface HolooRawItem {
  ItemId: number;
  Code: string;
  Name: string;
  Barcode?: string | null;
  Unit: string;
  SecondaryUnit?: string | null;
  UnitRatio?: number | string | null;
  Category?: string | null;
}

export interface HolooRawVoucherItem {
  SanadId: number;
  AccountCode: string; // Moein or Kol code
  FloatingDetailCode?: string | null; // Tafsili or Party code
  /** Amount in Iranian Rials (not Toman); scaled by HolooMappingAdapter to MONEY_SCALE=2 minor units. */
  Debit: number | string | bigint;
  /** Amount in Iranian Rials (not Toman); scaled by HolooMappingAdapter to MONEY_SCALE=2 minor units. */
  Credit: number | string | bigint;
  Description?: string | null;
}
