import { validateCountryPack } from './country-pack.validation';
import {
  CountryPack,
  CountryPackError,
  CountryPackNotFoundError,
  CountryPackUnsupportedError,
  EInvoiceAdapter,
  PayrollRulesAdapter,
} from './country-pack.types';

/** Freezes plain objects and arrays; class instances and functions (adapters, ports) are left alone. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === Array.prototype) {
      for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
      Object.freeze(value);
    }
  }
  return value;
}

/**
 * Holds the packs. A pack is validated and frozen when registered; a country can be registered once.
 * `defaultCountry` is what a tenant without a country resolves to (Iran, so nothing changes today).
 */
export class CountryPackRegistry {
  private readonly packs = new Map<string, CountryPack>();

  constructor(readonly defaultCountry: string) {}

  register(pack: CountryPack): void {
    validateCountryPack(pack);
    if (this.packs.has(pack.country)) {
      throw new CountryPackError(`country pack ${pack.country} is already registered`);
    }
    this.packs.set(pack.country, deepFreeze(pack));
  }

  has(country: string): boolean {
    return this.packs.has(country.toUpperCase());
  }

  get(country: string): CountryPack {
    const pack = this.packs.get(country.toUpperCase());
    if (!pack) throw new CountryPackNotFoundError(`no country pack for ${country}`);
    return pack;
  }

  /** The pack of a tenant's country; a missing country means the default. */
  resolve(country?: string | null): CountryPack {
    return this.get(country || this.defaultCountry);
  }

  list(): readonly CountryPack[] {
    return [...this.packs.values()];
  }

  /** The e-invoice adapter, or a clear error when the country has none. */
  eInvoiceOf(country: string): EInvoiceAdapter {
    const adapter = this.get(country).eInvoice;
    if (!adapter) throw new CountryPackUnsupportedError(`country ${country} has no e-invoice scheme`);
    return adapter;
  }

  payrollOf(country: string): PayrollRulesAdapter {
    const adapter = this.get(country).payroll;
    if (!adapter) throw new CountryPackUnsupportedError(`country ${country} has no payroll rules`);
    return adapter;
  }
}
