import { IRAN_FISCAL_YEAR } from '../../calendar/fiscal-year';
import { CHART_TEMPLATES } from '../../accounting/constants/iran-chart-template';
import { STATUTORY_KEYS } from '../../hr/statutory/statutory-catalogue';
import { IRAN, StatutoryService } from '../../hr/statutory/statutory.service';
import { PayrollYearRates } from '../../hr/statutory/payroll-rates';
import { MoadianInvoicePacket, MoadianMappingContext, mapInvoiceToMoadianPacket } from '../../tax_compliance/utils/moadian-packet.mapper';
import { InvoiceResponseDto } from '../../invoicing/dto/invoice-response.dto';
import {
  COUNTRY_PACK_INTERFACE_VERSION,
  ChartTemplateInfo,
  CountryPack,
  EInvoiceAdapter,
  PayrollRulesAdapter,
  ReportPackEntry,
  StatutoryPort,
  TaxRuleInfo,
} from '../country-pack.types';

/** The only existing services the Iran pack calls. A structural type, so specs can pass fakes. */
export interface IranPackDeps {
  statutory: Pick<StatutoryService, 'list' | 'ratesFor'>;
}

export type IranEInvoiceAdapter = EInvoiceAdapter<InvoiceResponseDto, MoadianMappingContext, MoadianInvoicePacket>;
export type IranPayrollAdapter = PayrollRulesAdapter<PayrollYearRates>;

export interface IranCountryPack extends CountryPack {
  eInvoice: IranEInvoiceAdapter;
  payroll: IranPayrollAdapter;
}

const chartTemplates: readonly ChartTemplateInfo[] = CHART_TEMPLATES.map((template) => ({
  key: template.key,
  name: template.name,
  description: template.description,
  accounts: template.accounts.map((account) => ({
    code: account.code,
    name: account.name,
    accountType: String(account.accountType),
    level: String(account.level),
    parentCode: account.parentCode,
    reportLine: account.reportLine === null ? null : String(account.reportLine),
  })),
}));

/** Which statutory keys parameterise which tax. The values stay in the statutory store. */
const taxRules: readonly TaxRuleInfo[] = [
  { kind: 'vat', label: 'مالیات بر ارزش افزوده', statutoryKeys: ['vat_general_rate'] },
  {
    kind: 'corporate_income_tax',
    label: 'مالیات بر درآمد شرکت‌ها',
    statutoryKeys: ['corporate_tax_rate', 'corporate_tax_effective_floor'],
  },
  {
    kind: 'wage_tax',
    label: 'مالیات حقوق',
    statutoryKeys: [
      'wage_tax_annual_brackets',
      'wage_flat_tax_rate',
      'eidi_exempt_ceiling',
      'non_cash_exempt_annual',
    ],
  },
  {
    kind: 'social_insurance',
    label: 'بیمه تأمین اجتماعی',
    statutoryKeys: [
      'employee_insurance_rate',
      'employer_insurance_rate',
      'unemployment_insurance_rate',
      'insurable_ceiling_multiplier',
    ],
  },
];

const ACCOUNTING_REPORTS = 'enterprise-hub/accounting/reports';
const TAX_REPORTS = 'enterprise-hub/tax-compliance/reports';

const reportPack: readonly ReportPackEntry[] = [
  { id: 'trial-balance', title: 'تراز آزمایشی', period: 'range', route: `${ACCOUNTING_REPORTS}/trial-balance` },
  { id: 'balance-sheet', title: 'ترازنامه', period: 'point', route: `${ACCOUNTING_REPORTS}/balance-sheet` },
  { id: 'income-statement', title: 'صورت سود و زیان', period: 'range', route: `${ACCOUNTING_REPORTS}/income-statement` },
  { id: 'cash-flow', title: 'صورت جریان وجوه نقد', period: 'range', route: `${ACCOUNTING_REPORTS}/cash-flow` },
  { id: 'equity-changes', title: 'صورت تغییرات حقوق مالکانه', period: 'range', route: `${ACCOUNTING_REPORTS}/equity-changes` },
  { id: 'vat-seasonal', title: 'اظهارنامه ارزش افزوده فصلی', period: 'season', route: `${TAX_REPORTS}/vat-seasonal` },
  { id: 'seasonal-transactions', title: 'گزارش معاملات فصلی', period: 'season', route: `${TAX_REPORTS}/seasonal-transactions` },
  { id: 'ledger-export', title: 'خروجی دفتر کل', period: 'range', route: `${TAX_REPORTS}/ledger.csv` },
];

/**
 * The Iranian pack: adapters over what already exists. It calls the chart constants, the statutory
 * service with `country = 'IR'`, the payroll rates and the Moadian mapper unchanged, so wrapping
 * them cannot change what they do.
 */
export function createIranPack(deps: IranPackDeps): IranCountryPack {
  const statutory: StatutoryPort = {
    knownKeys: () => Object.keys(STATUTORY_KEYS),
    async valuesFor(tenantId, fiscalYear, month) {
      const rows = await deps.statutory.list(tenantId, fiscalYear, month);
      return rows.map((row) => ({
        key: row.key,
        label: row.label,
        value: row.value,
        effectiveFrom: row.effectiveFrom,
        source: row.source,
        verified: row.verified,
      }));
    },
  };

  return {
    interfaceVersion: COUNTRY_PACK_INTERFACE_VERSION,
    version: '1.0.0',
    country: IRAN,
    name: 'Iran',
    status: 'production',
    locale: {
      languages: ['fa-IR', 'en'],
      direction: 'rtl',
      displayDigits: 'arabext',
      currency: { code: 'IRR', minorUnits: 0 },
      timeZone: 'Asia/Tehran',
    },
    calendars: { primary: 'jalali', fiscalYear: { ...IRAN_FISCAL_YEAR }, weekendDays: [5] },
    chartTemplates,
    taxRules,
    statutory,
    eInvoice: { scheme: 'moadian', map: mapInvoiceToMoadianPacket },
    payroll: { ratesFor: (tenantId, fiscalYear, month) => deps.statutory.ratesFor(tenantId, fiscalYear, month) },
    reportPack,
  };
}
