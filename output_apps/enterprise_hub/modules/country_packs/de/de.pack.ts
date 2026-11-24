import {
  COUNTRY_PACK_INTERFACE_VERSION,
  CountryPack,
  PaymentRailConfig,
  ReportPackEntry,
  StatutoryPort,
  StatutoryValueInfo,
  TaxRuleInfo,
} from '../country-pack.types';
import { DE_NEUTRAL_CHART_TEMPLATE } from './de-chart-template';
import {
  DE_KLEINUNTERNEHMER_CONFIG,
  DE_RETURN_FREQUENCY_CONFIG,
  DE_REVERSE_CHARGE_CODES,
  DE_VAT_RATES,
} from './de-vat';

export const GERMANY = 'DE';

const GERMANY_PAYMENT_RAILS: readonly PaymentRailConfig[] = [
  {
    id: 'sepa_credit',
    name: 'SEPA Überweisung (Credit Transfer)',
    methods: ['SEPA', 'BANK_TRANSFER', 'WIRE'],
    clearingRole: 'pos_clearing',
    defaultAccountCode: '1220',
    feeRole: 'bank_fee',
  },
  {
    id: 'sepa_debit',
    name: 'SEPA Lastschrift (Direct Debit)',
    methods: ['SEPA_DD', 'DIRECT_DEBIT', 'LASTSCHRIFT'],
    clearingRole: 'pos_clearing',
    defaultAccountCode: '1220',
    feeRole: 'bank_fee',
  },
  {
    id: 'card',
    name: 'Kartenzahlung (EC / Kreditkarte)',
    methods: ['CARD', 'POS', 'GIROCARD', 'VISA', 'MASTERCARD'],
    clearingRole: 'pos_clearing',
    defaultAccountCode: '1210',
    feeRole: 'bank_fee',
    taxRole: 'vat_input',
  },
];

const taxRules: readonly TaxRuleInfo[] = [
  {
    kind: 'vat',
    label: 'Umsatzsteuer (VAT)',
    statutoryKeys: [
      ...DE_VAT_RATES.map((item) => item.code.toLowerCase()),
      'de_kleinunternehmer_prior_year_ceiling',
      'de_kleinunternehmer_current_year_ceiling',
      'de_return_frequency_monthly_threshold',
      'de_return_frequency_annual_exemption_threshold',
      'de_special_prepayment_fraction',
      ...DE_REVERSE_CHARGE_CODES.map((rc) => `de_reverse_charge_${rc.code}`),
    ],
  },
];

const reportPack: readonly ReportPackEntry[] = [
  {
    id: 'de-ustva',
    title: 'Umsatzsteuer-Voranmeldung (UStVA)',
    period: 'month',
    route: 'country-packs/de/ustva',
  },
  {
    id: 'de-zm',
    title: 'Zusammenfassende Meldung (ZM)',
    period: 'quarter',
    route: 'country-packs/de/zm',
  },
  {
    id: 'de-ebilanz',
    title: 'E-Bilanz (Taxonomie 6.9/6.10)',
    period: 'year',
    route: 'country-packs/de/ebilanz',
  },
];

export function createGermanyPack(): CountryPack {
  const statutoryRows: StatutoryValueInfo[] = [
    ...DE_VAT_RATES.map((item) => ({
      key: item.code.toLowerCase(),
      label: item.label,
      value: item.rate,
      effectiveFrom: item.effectiveFrom,
      source: item.sourceUrl,
      verified: item.verified,
    })),
    {
      key: 'de_kleinunternehmer_prior_year_ceiling',
      label: '§ 19 UStG Kleinunternehmer Vorjahresgrenze',
      value: DE_KLEINUNTERNEHMER_CONFIG.priorYearTurnoverCeilingCents.toString(),
      effectiveFrom: '2025-01-01',
      source: '§ 19 Abs. 1 UStG',
      verified: true,
    },
    {
      key: 'de_kleinunternehmer_current_year_ceiling',
      label: '§ 19 UStG Kleinunternehmer Laufendes Kalenderjahr Grenze',
      value: DE_KLEINUNTERNEHMER_CONFIG.currentYearTurnoverCeilingCents.toString(),
      effectiveFrom: '2025-01-01',
      source: '§ 19 Abs. 1 UStG',
      verified: true,
    },
    {
      key: 'de_return_frequency_monthly_threshold',
      label: '§ 18 UStG Monatliche Voranmeldungsgrenze',
      value: DE_RETURN_FREQUENCY_CONFIG.monthlyThresholdVatCents.toString(),
      effectiveFrom: '2025-01-01',
      source: '§ 18 Abs. 2 UStG',
      verified: true,
    },
    {
      key: 'de_return_frequency_annual_exemption_threshold',
      label: '§ 18 UStG Befreiungsgrenze Voranmeldungen',
      value: DE_RETURN_FREQUENCY_CONFIG.annualExemptionThresholdVatCents.toString(),
      effectiveFrom: '2025-01-01',
      source: '§ 18 Abs. 2 Satz 3 UStG',
      verified: true,
    },
    {
      key: 'de_special_prepayment_fraction',
      label: 'Dauerfristverlängerung 1/11 Sondervorauszahlung',
      value: '1/11',
      effectiveFrom: '2000-01-01',
      source: '§§ 46-48 UStDV',
      verified: true,
    },
    ...DE_REVERSE_CHARGE_CODES.map((item) => ({
      key: `de_reverse_charge_${item.code}`,
      label: item.label,
      value: item.code,
      effectiveFrom: '2015-01-01',
      source: item.sourceUrl,
      verified: item.verified, // explicitly false until checked
    })),
  ];

  const statutory: StatutoryPort = {
    knownKeys: () => statutoryRows.map((row) => row.key),
    valuesFor: async (_tenantId, _fiscalYear, _month) => statutoryRows,
  };

  return {
    interfaceVersion: COUNTRY_PACK_INTERFACE_VERSION,
    version: '1.0.0',
    country: GERMANY,
    name: 'Germany',
    status: 'beta',
    locale: {
      languages: ['de-DE', 'en-DE'],
      direction: 'ltr',
      displayDigits: 'latn',
      currency: { code: 'EUR', minorUnits: 2 },
      timeZone: 'Europe/Berlin',
    },
    calendars: {
      primary: 'gregorian',
      fiscalYear: { calendar: 'gregorian', startMonth: 1, startDay: 1, labelBy: 'start' },
      weekendDays: [6, 7],
    },
    chartTemplates: [DE_NEUTRAL_CHART_TEMPLATE],
    taxRules,
    statutory,
    paymentRails: GERMANY_PAYMENT_RAILS,
    eInvoice: undefined,
    payroll: undefined,
    reportPack,
  };
}
