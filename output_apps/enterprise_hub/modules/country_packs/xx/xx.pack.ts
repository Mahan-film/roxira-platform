import {
  COUNTRY_PACK_INTERFACE_VERSION,
  CountryPack,
  StatutoryValueInfo,
} from '../country-pack.types';

/**
 * A FAKE country for tests: it proves that a second pack plugs into the registry and that nothing in
 * the interface assumes Iran. Every name, rate and rule here is invented. It is never registered by
 * the Nest module and must never be given a real country's rules (the first real foreign country is
 * an owner decision).
 */
export const TEST_COUNTRY = 'XX';

export interface TestPackValue {
  key: string;
  value: unknown;
}

export function createTestPack(values: readonly TestPackValue[] = [{ key: 'xx_sales_tax_rate', value: '0.10' }]): CountryPack {
  const rows: StatutoryValueInfo[] = values.map((item) => ({
    key: item.key,
    label: item.key,
    value: item.value,
    effectiveFrom: '2000-01-01',
    source: 'invented for tests',
    verified: false,
  }));
  return {
    interfaceVersion: COUNTRY_PACK_INTERFACE_VERSION,
    version: '0.0.1',
    country: TEST_COUNTRY,
    name: 'Testland (fake)',
    status: 'test',
    locale: {
      languages: ['en'],
      direction: 'ltr',
      displayDigits: 'latn',
      currency: { code: 'XTS', minorUnits: 2 },
      timeZone: 'UTC',
    },
    calendars: {
      primary: 'gregorian',
      fiscalYear: { calendar: 'gregorian', startMonth: 7, startDay: 1, labelBy: 'end' },
      weekendDays: [6, 7],
    },
    chartTemplates: [
      {
        key: 'xx-basic',
        name: 'Basic test chart',
        description: 'Invented three-account chart',
        accounts: [
          { code: '1', name: 'Assets', accountType: 'ASSET', level: 'GROUP', parentCode: null, reportLine: null },
          { code: '11', name: 'Cash', accountType: 'ASSET', level: 'MOEIN', parentCode: '1', reportLine: null },
          { code: '4', name: 'Income', accountType: 'REVENUE', level: 'GROUP', parentCode: null, reportLine: null },
        ],
      },
    ],
    taxRules: [{ kind: 'sales_tax', label: 'Sales tax', statutoryKeys: rows.map((row) => row.key) }],
    statutory: {
      knownKeys: () => rows.map((row) => row.key),
      valuesFor: () => Promise.resolve(rows),
    },
    reportPack: [{ id: 'xx-summary', title: 'Summary', period: 'year', route: 'xx/summary' }],
  };
}
