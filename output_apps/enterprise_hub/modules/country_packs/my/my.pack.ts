import {
  COUNTRY_PACK_INTERFACE_VERSION,
  ChartTemplateInfo,
  CountryPack,
  ReportPackEntry,
  StatutoryPort,
  StatutoryValueInfo,
  TaxRuleInfo,
} from '../country-pack.types';
import thresholdsData from './data/statutory-thresholds.v1.json';
import taxCodesData from './data/sst-tax-codes.v1.json';

export const MALAYSIA = 'MY';

export interface SstTaxCodeInfo {
  code: string;
  name: string;
  category: string;
  rate: string;
  effectiveFrom: string;
  sourceUrl: string;
  description: string;
}

export interface MalaysiaThresholdInfo {
  code: string;
  label: string;
  value: unknown;
  unit: string;
  effectiveFrom: string;
  sourceUrl: string;
  verified: boolean;
  description: string;
}

export const MALAYSIA_SST_TAX_CODES: readonly SstTaxCodeInfo[] = taxCodesData.taxCodes;
export const MALAYSIA_STATUTORY_THRESHOLDS: readonly MalaysiaThresholdInfo[] = thresholdsData.thresholds;

const chartTemplates: readonly ChartTemplateInfo[] = [
  {
    key: 'my-sme-standard',
    name: 'Malaysian SME Standard Chart of Accounts (MPERS)',
    description: 'Standard chart of accounts for Malaysian SMEs, trading and services businesses under MPERS',
    accounts: [
      // 10000 Current Assets
      { code: '10000', name: 'Current Assets', accountType: 'ASSET', level: 'GROUP', parentCode: null, reportLine: 'assets.current' },
      { code: '11000', name: 'Cash and Bank Balances', accountType: 'ASSET', level: 'MOEIN', parentCode: '10000', reportLine: 'assets.current.cash' },
      { code: '11100', name: 'Petty Cash', accountType: 'ASSET', level: 'TAFSILI', parentCode: '11000', reportLine: 'assets.current.cash' },
      { code: '11200', name: 'Cash at Bank - MYR', accountType: 'ASSET', level: 'TAFSILI', parentCode: '11000', reportLine: 'assets.current.cash' },
      { code: '12000', name: 'Trade and Other Receivables', accountType: 'ASSET', level: 'MOEIN', parentCode: '10000', reportLine: 'assets.current.receivables' },
      { code: '12100', name: 'Trade Debtors (Accounts Receivable)', accountType: 'ASSET', level: 'TAFSILI', parentCode: '12000', reportLine: 'assets.current.receivables' },
      { code: '12200', name: 'Other Debtors & Deposits', accountType: 'ASSET', level: 'TAFSILI', parentCode: '12000', reportLine: 'assets.current.receivables' },
      { code: '12300', name: 'SST Input Tax / Receivable', accountType: 'ASSET', level: 'TAFSILI', parentCode: '12000', reportLine: 'assets.current.receivables' },
      { code: '13000', name: 'Inventories', accountType: 'ASSET', level: 'MOEIN', parentCode: '10000', reportLine: 'assets.current.inventory' },
      { code: '13100', name: 'Merchandise Inventory', accountType: 'ASSET', level: 'TAFSILI', parentCode: '13000', reportLine: 'assets.current.inventory' },

      // 15000 Non-Current Assets
      { code: '15000', name: 'Non-Current Assets', accountType: 'ASSET', level: 'GROUP', parentCode: null, reportLine: 'assets.noncurrent' },
      { code: '16000', name: 'Property, Plant and Equipment', accountType: 'ASSET', level: 'MOEIN', parentCode: '15000', reportLine: 'assets.noncurrent.ppe' },
      { code: '16100', name: 'Office Equipment', accountType: 'ASSET', level: 'TAFSILI', parentCode: '16000', reportLine: 'assets.noncurrent.ppe' },
      { code: '16200', name: 'Accumulated Depreciation - Office Equipment', accountType: 'ASSET', level: 'TAFSILI', parentCode: '16000', reportLine: 'assets.noncurrent.ppe' },
      { code: '16300', name: 'Motor Vehicles', accountType: 'ASSET', level: 'TAFSILI', parentCode: '16000', reportLine: 'assets.noncurrent.ppe' },
      { code: '16400', name: 'Accumulated Depreciation - Motor Vehicles', accountType: 'ASSET', level: 'TAFSILI', parentCode: '16000', reportLine: 'assets.noncurrent.ppe' },

      // 20000 Current Liabilities
      { code: '20000', name: 'Current Liabilities', accountType: 'LIABILITY', level: 'GROUP', parentCode: null, reportLine: 'liabilities.current' },
      { code: '21000', name: 'Trade and Other Payables', accountType: 'LIABILITY', level: 'MOEIN', parentCode: '20000', reportLine: 'liabilities.current.payables' },
      { code: '21100', name: 'Trade Creditors (Accounts Payable)', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '21000', reportLine: 'liabilities.current.payables' },
      { code: '21200', name: 'Accrued Expenses', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '21000', reportLine: 'liabilities.current.payables' },
      { code: '21300', name: 'SST Output Tax / Payable', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '21000', reportLine: 'liabilities.current.payables' },
      { code: '22000', name: 'Payroll Liabilities', accountType: 'LIABILITY', level: 'MOEIN', parentCode: '20000', reportLine: 'liabilities.current.payroll' },
      { code: '22100', name: 'EPF Payable (Kumpulan Wang Simpanan Pekerja)', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '22000', reportLine: 'liabilities.current.payroll' },
      { code: '22200', name: 'SOCSO Payable (PERKESO)', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '22000', reportLine: 'liabilities.current.payroll' },
      { code: '22300', name: 'EIS Payable (Sistem Insurans Pekerjaan)', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '22000', reportLine: 'liabilities.current.payroll' },
      { code: '22400', name: 'PCB / MTD Withholding Payable', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '22000', reportLine: 'liabilities.current.payroll' },

      // 25000 Non-Current Liabilities
      { code: '25000', name: 'Non-Current Liabilities', accountType: 'LIABILITY', level: 'GROUP', parentCode: null, reportLine: 'liabilities.noncurrent' },
      { code: '26000', name: 'Long-Term Borrowings', accountType: 'LIABILITY', level: 'MOEIN', parentCode: '25000', reportLine: 'liabilities.noncurrent.borrowings' },
      { code: '26100', name: 'Bank Term Loans', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '26000', reportLine: 'liabilities.noncurrent.borrowings' },

      // 30000 Equity
      { code: '30000', name: 'Equity', accountType: 'EQUITY', level: 'GROUP', parentCode: null, reportLine: 'equity' },
      { code: '31000', name: 'Share Capital', accountType: 'EQUITY', level: 'MOEIN', parentCode: '30000', reportLine: 'equity.capital' },
      { code: '31100', name: 'Ordinary Share Capital', accountType: 'EQUITY', level: 'TAFSILI', parentCode: '31000', reportLine: 'equity.capital' },
      { code: '32000', name: 'Retained Earnings', accountType: 'EQUITY', level: 'MOEIN', parentCode: '30000', reportLine: 'equity.retained' },
      { code: '32100', name: 'Accumulated Retained Earnings', accountType: 'EQUITY', level: 'TAFSILI', parentCode: '32000', reportLine: 'equity.retained' },
      { code: '32200', name: 'Current Year Profit / Loss', accountType: 'EQUITY', level: 'TAFSILI', parentCode: '32000', reportLine: 'equity.retained' },

      // 40000 Revenue
      { code: '40000', name: 'Revenue', accountType: 'REVENUE', level: 'GROUP', parentCode: null, reportLine: 'revenue' },
      { code: '41000', name: 'Operating Sales', accountType: 'REVENUE', level: 'MOEIN', parentCode: '40000', reportLine: 'revenue.sales' },
      { code: '41100', name: 'Sales of Goods (Standard-rated)', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '41000', reportLine: 'revenue.sales' },
      { code: '41200', name: 'Sales of Goods (Exempt/Zero-rated)', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '41000', reportLine: 'revenue.sales' },
      { code: '41300', name: 'Service Revenue (Standard-rated 8%)', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '41000', reportLine: 'revenue.services' },
      { code: '41400', name: 'Service Revenue (F&B 6%)', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '41000', reportLine: 'revenue.services' },
      { code: '42000', name: 'Other Income', accountType: 'REVENUE', level: 'MOEIN', parentCode: '40000', reportLine: 'revenue.other' },
      { code: '42100', name: 'Interest Income', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '42000', reportLine: 'revenue.other' },
      { code: '42200', name: 'Realised Foreign Exchange Gain', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '42000', reportLine: 'revenue.other' },

      // 50000 Cost of Sales
      { code: '50000', name: 'Cost of Sales', accountType: 'EXPENSE', level: 'GROUP', parentCode: null, reportLine: 'cogs' },
      { code: '51000', name: 'Cost of Goods Sold', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '50000', reportLine: 'cogs.purchases' },
      { code: '51100', name: 'Purchases (Standard-rated)', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '51000', reportLine: 'cogs.purchases' },
      { code: '51200', name: 'Purchases (Exempt/Zero-rated)', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '51000', reportLine: 'cogs.purchases' },
      { code: '51300', name: 'Freight and Carriage Inwards', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '51000', reportLine: 'cogs.freight' },
      { code: '51400', name: 'Closing Inventory Adjustment', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '51000', reportLine: 'cogs.inventory' },

      // 60000 Operating Expenses
      { code: '60000', name: 'Operating Expenses', accountType: 'EXPENSE', level: 'GROUP', parentCode: null, reportLine: 'expenses' },
      { code: '61000', name: 'Staff Costs', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '60000', reportLine: 'expenses.staff' },
      { code: '61100', name: 'Salaries and Wages', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '61000', reportLine: 'expenses.staff' },
      { code: '61200', name: 'EPF Employer Contribution', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '61000', reportLine: 'expenses.staff' },
      { code: '61300', name: 'SOCSO Employer Contribution', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '61000', reportLine: 'expenses.staff' },
      { code: '61400', name: 'EIS Employer Contribution', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '61000', reportLine: 'expenses.staff' },
      { code: '61500', name: 'Staff Medical and Welfare', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '61000', reportLine: 'expenses.staff' },
      { code: '62000', name: 'Administrative Expenses', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '60000', reportLine: 'expenses.admin' },
      { code: '62100', name: 'Rental of Premises', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '62000', reportLine: 'expenses.admin' },
      { code: '62200', name: 'Utilities (Water and Electricity)', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '62000', reportLine: 'expenses.admin' },
      { code: '62300', name: 'Telephone and Internet', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '62000', reportLine: 'expenses.admin' },
      { code: '62400', name: 'Depreciation Expense', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '62000', reportLine: 'expenses.admin' },
      { code: '62500', name: 'Bank Charges and Commission', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '62000', reportLine: 'expenses.admin' },
      { code: '62600', name: 'Professional and Legal Fees', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '62000', reportLine: 'expenses.admin' },
      { code: '63000', name: 'Selling and Marketing Expenses', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '60000', reportLine: 'expenses.marketing' },
      { code: '63100', name: 'Advertising and Promotion', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '63000', reportLine: 'expenses.marketing' },
    ],
  },
];

const taxRules: readonly TaxRuleInfo[] = [
  {
    kind: 'sales_tax',
    label: 'Sales Tax (Cukai Jualan)',
    statutoryKeys: [
      'my_sales_tax_rate_standard',
      'my_sales_tax_rate_reduced',
      'my_sales_tax_threshold',
    ],
  },
  {
    kind: 'service_tax',
    label: 'Service Tax (Cukai Perkhidmatan)',
    statutoryKeys: [
      'my_service_tax_rate_general',
      'my_service_tax_rate_fnb',
      'my_service_tax_threshold_general',
      'my_service_tax_threshold_fnb',
    ],
  },
  {
    kind: 'einvoice_myinvois',
    label: 'MyInvois E-Invoicing (LHDN)',
    statutoryKeys: [
      'my_einvoice_phase4_threshold',
      'my_einvoice_exemption_ceiling',
      'my_einvoice_cancellation_window_hours',
    ],
  },
];

const ACCOUNTING_REPORTS = 'enterprise-hub/accounting/reports';
const TAX_REPORTS = 'enterprise-hub/tax-compliance/reports';

const reportPack: readonly ReportPackEntry[] = [
  { id: 'trial-balance', title: 'Trial Balance', period: 'range', route: `${ACCOUNTING_REPORTS}/trial-balance` },
  { id: 'balance-sheet', title: 'Balance Sheet', period: 'point', route: `${ACCOUNTING_REPORTS}/balance-sheet` },
  { id: 'income-statement', title: 'Profit and Loss Statement', period: 'range', route: `${ACCOUNTING_REPORTS}/income-statement` },
  { id: 'cash-flow', title: 'Statement of Cash Flows', period: 'range', route: `${ACCOUNTING_REPORTS}/cash-flow` },
  { id: 'equity-changes', title: 'Statement of Changes in Equity', period: 'range', route: `${ACCOUNTING_REPORTS}/equity-changes` },
  { id: 'sst-return', title: 'SST-02 Return Statement', period: 'month', route: `${TAX_REPORTS}/sst-return` },
];

/**
 * Malaysian Country Pack Skeleton (docs/strategy/research/R4_COUNTRY_PACKS.md).
 *
 * Implements the standard metadata, Gregorian calendar, MPERS-compliant SME chart,
 * versioned SST tax codes and statutory thresholds JSON.
 * Network adapters (MyInvois e-invoice submission, EPF/SOCSO payroll) are intentionally omitted
 * in this skeleton and will be plugged into `eInvoice` and `payroll` ports in later waves.
 */
export function createMalaysiaPack(): CountryPack {
  const statutoryRows: StatutoryValueInfo[] = MALAYSIA_STATUTORY_THRESHOLDS.map((item) => ({
    key: item.code,
    label: item.label,
    value: item.value,
    effectiveFrom: item.effectiveFrom,
    source: item.sourceUrl,
    verified: item.verified,
  }));

  const statutory: StatutoryPort = {
    knownKeys: () => statutoryRows.map((row) => row.key),
    valuesFor: async (_tenantId, _fiscalYear, _month) => statutoryRows,
  };

  return {
    interfaceVersion: COUNTRY_PACK_INTERFACE_VERSION,
    version: '1.0.0',
    country: MALAYSIA,
    name: 'Malaysia',
    status: 'production',
    locale: {
      languages: ['en-MY', 'ms-MY'],
      direction: 'ltr',
      displayDigits: 'latn',
      currency: { code: 'MYR', minorUnits: 2 },
      timeZone: 'Asia/Kuala_Lumpur',
    },
    calendars: {
      primary: 'gregorian',
      fiscalYear: { calendar: 'gregorian', startMonth: 1, startDay: 1, labelBy: 'start' },
      weekendDays: [6, 7],
    },
    chartTemplates,
    taxRules,
    statutory,
    // eInvoice and payroll adapters are undefined until network adapters land in WAVE 16+
    eInvoice: undefined,
    payroll: undefined,
    reportPack,
  };
}
