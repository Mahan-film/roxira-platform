import type { DatevEncoding } from './cp1252';

export const DATEV_EXTF_VERSION = 700;
export const DATEV_MAX_ROWS_PER_FILE = 99_999;

export const DATEV_CATEGORIES = {
  BUCHUNGSSTAPEL: { code: 21, name: 'Buchungsstapel', formatVersion: 13, minFormatVersion: 12 },
  DEBITOREN_KREDITOREN: { code: 16, name: 'Debitoren/Kreditoren', formatVersion: 5, minFormatVersion: 5 },
  SACHKONTENBESCHRIFTUNGEN: { code: 20, name: 'Sachkontenbeschriftungen', formatVersion: 3, minFormatVersion: 3 },
} as const;

export interface DatevHeaderConfig {
  consultantNumber: string;
  clientNumber: string;
  /** YYYY-MM-DD start of the fiscal year (supports non-calendar fiscal years). */
  fiscalYearStart: string;
  /** YYYY-MM-DD end of the fiscal year (optional; defaults to fiscalYearStart + 1 year - 1 day). */
  fiscalYearEnd?: string;
  /** YYYY-MM-DD period start for Buchungsstapel. */
  periodStart?: string;
  /** YYYY-MM-DD period end for Buchungsstapel. */
  periodEnd?: string;
  /** Sachkontenlänge (4..8, default 4). */
  accountLength?: number;
  /** Base currency ISO code (default 'EUR'). */
  baseCurrency?: string;
  /** Label / Bezeichnung in header. */
  label?: string;
  /** Origin code (2 chars, default 'RX'). */
  origin?: string;
  /** Exported-by label (default 'Roxira'). */
  exportedBy?: string;
  /** Encoding ('cp1252' | 'utf8-bom'). */
  encoding?: DatevEncoding;
  /** Created timestamp (for deterministic tests). */
  createdAt?: Date;
}

export interface DatevPostingRow {
  /** Positive amount in transaction currency (minor units or decimal string). Never 0.00. */
  amount: string;
  /** 'S' = Soll (Debit), 'H' = Haben (Credit). */
  debitCredit: 'S' | 'H';
  /** Transaction currency ISO code (e.g. 'EUR', 'USD'). */
  currency?: string;
  /** Exchange rate (required when currency !== baseCurrency). */
  exchangeRate?: string;
  /** Base-currency amount (required when currency !== baseCurrency). */
  baseAmount?: string;
  /** Base-currency ISO code (defaults to header baseCurrency). */
  baseCurrency?: string;
  /** Account number (Konto). */
  account: string;
  /** Contra account number (Gegenkonto). */
  contraAccount: string;
  /** Optional BU-Schlüssel (tax key). */
  buKey?: string;
  /** Posting date YYYY-MM-DD (converted to TTMM in row; year validated against fiscal year). */
  date: string;
  /** Belegfeld 1 (sanitised to [\w$&%*+\-/]{0,36}). */
  documentRef1?: string;
  /** Belegfeld 2 (optional, max 12 chars). */
  documentRef2?: string;
  /** Posting text (max 60 chars). */
  text?: string;
  /** Cost centre 1 (KOST1). */
  costCenter1?: string;
  /** Cost centre 2 (KOST2). */
  costCenter2?: string;
}

export interface DatevPartyRow {
  /** Account number (Debitor 10000..69999 / Kreditor 70000..99999). */
  account: string;
  /** Company or person name. */
  name: string;
  /** '1' = natural person, '2' = company (default '2'). */
  addressType?: '1' | '2';
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  vatId?: string;
  iban?: string;
  bic?: string;
}

export interface DatevAccountLabelRow {
  /** Sachkonto number. */
  account: string;
  /** Account label (max 40 chars). */
  label: string;
  /** Language ID (default 'de-DE'). */
  languageId?: string;
}

export interface DatevExportFile {
  fileName: string;
  partIndex: number;
  totalParts: number;
  rowCount: number;
  encoding: DatevEncoding;
  buffer: Buffer;
}

export interface DatevExportResult {
  category: number;
  categoryName: string;
  totalRows: number;
  files: DatevExportFile[];
}
