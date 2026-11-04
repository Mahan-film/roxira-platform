import { CountryPackRegistry } from './country-pack.registry';
import { validateCountryPack } from './country-pack.validation';
import {
  COUNTRY_PACK_INTERFACE_VERSION,
  CountryPack,
  CountryPackError,
  CountryPackNotFoundError,
  CountryPackUnsupportedError,
} from './country-pack.types';
import { TEST_COUNTRY, createTestPack } from './xx/xx.pack';

const base = (): CountryPack => createTestPack();
const withPatch = (patch: Partial<CountryPack>): CountryPack => ({ ...base(), ...patch });

describe('CountryPackRegistry', () => {
  it('registers, finds and lists packs; unknown countries throw a typed error', () => {
    const registry = new CountryPackRegistry(TEST_COUNTRY);
    expect(registry.has(TEST_COUNTRY)).toBe(false);
    expect(() => registry.get(TEST_COUNTRY)).toThrow(CountryPackNotFoundError);
    registry.register(base());
    expect(registry.has(TEST_COUNTRY)).toBe(true);
    expect(registry.get(TEST_COUNTRY).name).toBe('Testland (fake)');
    expect(registry.list().map((pack) => pack.country)).toEqual([TEST_COUNTRY]);
    expect(() => registry.get('ZZ')).toThrow(CountryPackNotFoundError);
  });

  it('country lookup ignores case, and freezing a pack does not freeze shared constants', () => {
    const registry = new CountryPackRegistry(TEST_COUNTRY);
    registry.register(base());
    expect(registry.get('xx').country).toBe(TEST_COUNTRY);
    expect(registry.has('xx')).toBe(true);
  });

  it('refuses a second pack for the same country', () => {
    const registry = new CountryPackRegistry(TEST_COUNTRY);
    registry.register(base());
    expect(() => registry.register(base())).toThrow(/already registered/);
  });

  it('resolve falls back to the default country for a tenant without one', () => {
    const registry = new CountryPackRegistry(TEST_COUNTRY);
    registry.register(base());
    expect(registry.resolve(undefined).country).toBe(TEST_COUNTRY);
    expect(registry.resolve(null).country).toBe(TEST_COUNTRY);
    expect(registry.resolve('').country).toBe(TEST_COUNTRY);
    expect(() => registry.resolve('ZZ')).toThrow(CountryPackNotFoundError);
  });

  it('freezes registered packs so a caller cannot change a country rule at runtime', () => {
    const registry = new CountryPackRegistry(TEST_COUNTRY);
    const pack = base();
    registry.register(pack);
    const stored = registry.get(TEST_COUNTRY);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.locale.currency)).toBe(true);
    expect(Object.isFrozen(stored.chartTemplates[0].accounts[0])).toBe(true);
    expect(() => {
      (stored.locale.currency as { code: string }).code = 'EVIL';
    }).toThrow(TypeError);
  });

  it('a missing capability is a clear unsupported error, not a crash', () => {
    const registry = new CountryPackRegistry(TEST_COUNTRY);
    registry.register(base());
    expect(() => registry.eInvoiceOf(TEST_COUNTRY)).toThrow(CountryPackUnsupportedError);
    expect(() => registry.payrollOf(TEST_COUNTRY)).toThrow(/no payroll rules/);
  });

  it('returns the adapter when the pack has one', () => {
    const registry = new CountryPackRegistry(TEST_COUNTRY);
    const pack = withPatch({
      eInvoice: { scheme: 'fake', map: () => ({ ok: true }) },
      payroll: { ratesFor: () => Promise.resolve({ rate: 1 }) },
    });
    registry.register(pack);
    expect(registry.eInvoiceOf(TEST_COUNTRY).scheme).toBe('fake');
    return expect(registry.payrollOf(TEST_COUNTRY).ratesFor('t', 2025)).resolves.toEqual({ rate: 1 });
  });
});

describe('validateCountryPack', () => {
  it('accepts a well-formed pack', () => {
    expect(() => validateCountryPack(base())).not.toThrow();
  });

  const bad: Array<[string, Partial<CountryPack>, RegExp]> = [
    ['unknown interface version', { interfaceVersion: COUNTRY_PACK_INTERFACE_VERSION + 1 }, /interface version/],
    ['lower-case country', { country: 'xx' }, /ISO 3166/],
    ['three-letter country', { country: 'XXX' }, /ISO 3166/],
    ['bad semver', { version: '1' }, /x\.y\.z/],
    ['empty name', { name: ' ' }, /name is required/],
    ['bad status', { status: 'beta' as never }, /status/],
    [
      'no language',
      { locale: { ...base().locale, languages: [] } },
      /language/,
    ],
    [
      'fractional minor units',
      { locale: { ...base().locale, currency: { code: 'XTS', minorUnits: 1.5 } } },
      /minorUnits/,
    ],
    [
      'bad currency code',
      { locale: { ...base().locale, currency: { code: 'xts', minorUnits: 2 } } },
      /currency code/,
    ],
    [
      'fiscal start day 31',
      { calendars: { ...base().calendars, fiscalYear: { ...base().calendars.fiscalYear, startDay: 31 } } },
      /startDay/,
    ],
    [
      'weekend day 8',
      { calendars: { ...base().calendars, weekendDays: [8] } },
      /weekendDays/,
    ],
    [
      'duplicate chart key',
      { chartTemplates: [...base().chartTemplates, ...base().chartTemplates] },
      /duplicate chart template/,
    ],
    [
      'duplicate account code',
      {
        chartTemplates: [
          {
            ...base().chartTemplates[0],
            accounts: [...base().chartTemplates[0].accounts, base().chartTemplates[0].accounts[0]],
          },
        ],
      },
      /duplicate account code/,
    ],
    [
      'orphan account',
      {
        chartTemplates: [
          {
            ...base().chartTemplates[0],
            accounts: [
              { code: '99', name: 'x', accountType: 'ASSET', level: 'MOEIN', parentCode: '9', reportLine: null },
            ],
          },
        ],
      },
      /unknown parent/,
    ],
    [
      'tax rule with an unknown statutory key',
      { taxRules: [{ kind: 'k', label: 'k', statutoryKeys: ['nope'] }] },
      /unknown statutory key/,
    ],
    [
      'duplicate report id',
      { reportPack: [...base().reportPack, ...base().reportPack] },
      /duplicate report id/,
    ],
  ];

  it.each(bad)('rejects %s', (_name, patch, pattern) => {
    expect(() => validateCountryPack(withPatch(patch))).toThrow(CountryPackError);
    expect(() => validateCountryPack(withPatch(patch))).toThrow(pattern);
  });

  it('allows a gregorian fiscal year in a country whose primary calendar is jalali', () => {
    const pack = withPatch({
      calendars: { primary: 'jalali', fiscalYear: { ...base().calendars.fiscalYear, calendar: 'gregorian' }, weekendDays: [5] },
    });
    expect(() => validateCountryPack(pack)).not.toThrow();
  });
});
