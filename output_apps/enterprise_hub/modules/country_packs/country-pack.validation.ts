import { assertFiscalSpec } from '../calendar/fiscal-year';
import {
  COUNTRY_PACK_INTERFACE_VERSION,
  CountryPack,
  CountryPackError,
} from './country-pack.types';

const COUNTRY_CODE = /^[A-Z]{2}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function fail(pack: Partial<CountryPack>, message: string): never {
  throw new CountryPackError(`country pack ${String(pack.country)}: ${message}`);
}

/**
 * Structural checks that hold for every country. They catch a malformed pack when it is registered,
 * not when a customer first uses it. No country-specific rule belongs here.
 */
export function validateCountryPack(pack: CountryPack): void {
  if (pack.interfaceVersion !== COUNTRY_PACK_INTERFACE_VERSION) {
    fail(pack, `interface version ${pack.interfaceVersion} is not supported (expected ${COUNTRY_PACK_INTERFACE_VERSION})`);
  }
  if (!COUNTRY_CODE.test(pack.country)) fail(pack, 'country must be an upper-case ISO 3166-1 alpha-2 code');
  if (!SEMVER.test(pack.version)) fail(pack, 'version must be x.y.z');
  if (!pack.name.trim()) fail(pack, 'name is required');
  if (pack.status !== 'production' && pack.status !== 'test') fail(pack, 'status must be production or test');
  if (pack.locale.languages.length === 0) fail(pack, 'locale needs at least one language');
  if (!Number.isInteger(pack.locale.currency.minorUnits) || pack.locale.currency.minorUnits < 0) {
    fail(pack, 'currency minorUnits must be a non-negative integer');
  }
  if (!/^[A-Z]{3}$/.test(pack.locale.currency.code)) fail(pack, 'currency code must be 3 upper-case letters');
  try {
    assertFiscalSpec(pack.calendars.fiscalYear);
  } catch (error) {
    fail(pack, (error as Error).message);
  }
  if (pack.calendars.fiscalYear.calendar !== pack.calendars.primary && pack.calendars.fiscalYear.calendar !== 'gregorian') {
    fail(pack, 'fiscal year calendar must be the primary calendar or gregorian');
  }
  for (const day of pack.calendars.weekendDays) {
    if (!Number.isInteger(day) || day < 1 || day > 7) fail(pack, 'weekendDays must be ISO weekdays 1..7');
  }

  const keys = new Set<string>();
  for (const template of pack.chartTemplates) {
    if (keys.has(template.key)) fail(pack, `duplicate chart template key ${template.key}`);
    keys.add(template.key);
    const codes = new Set<string>();
    for (const account of template.accounts) {
      if (codes.has(account.code)) fail(pack, `chart ${template.key}: duplicate account code ${account.code}`);
      codes.add(account.code);
    }
    for (const account of template.accounts) {
      if (account.parentCode !== null && !codes.has(account.parentCode)) {
        fail(pack, `chart ${template.key}: account ${account.code} has unknown parent ${account.parentCode}`);
      }
    }
  }

  const known = new Set(pack.statutory.knownKeys());
  for (const rule of pack.taxRules) {
    for (const key of rule.statutoryKeys) {
      if (!known.has(key)) fail(pack, `tax rule ${rule.kind} uses unknown statutory key ${key}`);
    }
  }

  const reportIds = new Set<string>();
  for (const report of pack.reportPack) {
    if (reportIds.has(report.id)) fail(pack, `duplicate report id ${report.id}`);
    reportIds.add(report.id);
  }
}
