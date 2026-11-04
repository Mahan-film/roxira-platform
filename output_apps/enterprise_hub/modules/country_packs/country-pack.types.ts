import { CalendarId, FiscalYearSpec } from '../calendar/calendar.types';

/**
 * The country pack interface (docs/strategy/ADR_GLOBAL_CORE.md, decision 1).
 *
 * A pack is plain, immutable data plus small adapters. It holds no legal figures (those stay in the
 * statutory store, keyed by country) and does no tenant scoping itself (ports take a tenant id and
 * the wrapped repositories enforce it). Nothing in this file may name a country.
 */
export const COUNTRY_PACK_INTERFACE_VERSION = 1;

/** `production` packs describe a real country; `test` packs exist only to prove the seam. */
export type CountryPackStatus = 'production' | 'test';

export interface CurrencyInfo {
  /** ISO 4217 code of the country's book currency. */
  code: string;
  /** Digits after the decimal separator in the smallest unit the books keep (0 for the Iranian rial). */
  minorUnits: number;
}

export interface LocaleInfo {
  /** BCP 47 tags, preferred first. */
  languages: readonly string[];
  direction: 'rtl' | 'ltr';
  /** Unicode numbering system used to display digits; stored numbers are always ASCII. */
  displayDigits: string;
  currency: CurrencyInfo;
  /** IANA zone used to turn an instant into a civil date. */
  timeZone: string;
}

export interface CalendarInfo {
  primary: CalendarId;
  /** Default fiscal year of a new tenant in this country. */
  fiscalYear: FiscalYearSpec;
  /** ISO weekdays (Monday 1 .. Sunday 7) that are the weekly rest day(s). */
  weekendDays: readonly number[];
}

/** One account of a chart template, in a shape that does not depend on any persistence class. */
export interface ChartTemplateAccountInfo {
  code: string;
  name: string;
  accountType: string;
  level: string;
  parentCode: string | null;
  reportLine: string | null;
}

export interface ChartTemplateInfo {
  key: string;
  name: string;
  description: string;
  accounts: readonly ChartTemplateAccountInfo[];
}

/** A kind of tax and the statutory keys that parameterise it. Keys only; never values. */
export interface TaxRuleInfo {
  kind: string;
  label: string;
  statutoryKeys: readonly string[];
}

/** A statutory value in force, as read through the pack's port. */
export interface StatutoryValueInfo {
  key: string;
  label: string;
  value: unknown;
  /** ISO date the value took effect. */
  effectiveFrom: string;
  source: string;
  verified: boolean;
}

export interface StatutoryPort {
  /** Keys the statutory store accepts for this country. */
  knownKeys(): readonly string[];
  /**
   * Values in force for a fiscal year, on the last day of fiscal `month` (1..12, default the last).
   * The tenant's own overrides beat platform defaults; scoping is the wrapped repository's job.
   */
  valuesFor(tenantId: string, fiscalYear: number, month?: number): Promise<readonly StatutoryValueInfo[]>;
}

/** Maps an internal invoice to the country's tax-authority packet. Input and output types are the country's own. */
export interface EInvoiceAdapter<Invoice = unknown, Context = unknown, Packet = unknown> {
  /** Name of the scheme, for example the authority's system. */
  scheme: string;
  /** Maps and validates; throws the country's own error type on invalid input. */
  map(invoice: Invoice, context: Context): Packet;
}

/** Statutory payroll values for a fiscal year, in the country's own shape. */
export interface PayrollRulesAdapter<Rates = unknown> {
  ratesFor(tenantId: string, fiscalYear: number, month?: number): Promise<Rates>;
}

export interface ReportPackEntry {
  id: string;
  title: string;
  /** What the report is taken over. */
  period: 'point' | 'month' | 'quarter' | 'season' | 'year' | 'range';
  /** API route relative to the service root, so the UI can list the pack's reports. */
  route: string;
}

export interface CountryPack {
  interfaceVersion: number;
  /** Semantic version of this pack's own content. */
  version: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  name: string;
  status: CountryPackStatus;
  locale: LocaleInfo;
  calendars: CalendarInfo;
  chartTemplates: readonly ChartTemplateInfo[];
  taxRules: readonly TaxRuleInfo[];
  statutory: StatutoryPort;
  /** Absent when the country has no e-invoice scheme in the product. */
  eInvoice?: EInvoiceAdapter<never, never, unknown>;
  /** Absent when the country has no payroll rules in the product. */
  payroll?: PayrollRulesAdapter;
  reportPack: readonly ReportPackEntry[];
}

export class CountryPackError extends Error {}
export class CountryPackNotFoundError extends CountryPackError {}
export class CountryPackUnsupportedError extends CountryPackError {}
