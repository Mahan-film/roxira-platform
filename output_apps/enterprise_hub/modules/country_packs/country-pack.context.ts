import { AsyncLocalStorage } from 'node:async_hooks';
import { CountryPack } from './country-pack.types';

/**
 * Global Continuation Local Storage (CLS) holding the active CountryPack for the current async execution chain.
 * Works seamlessly across HTTP requests, BullMQ workers, crons, and background tasks without requiring
 * request-scoped NestJS injection.
 */
const packStorage = new AsyncLocalStorage<CountryPack>();

export class CountryPackCls {
  /** Runs `fn` with `pack` bound to the current async context. */
  static run<T>(pack: CountryPack, fn: () => T | Promise<T>): T | Promise<T> {
    return packStorage.run(pack, fn);
  }

  /** The active CountryPack from the async context store, or undefined when outside a pack context. */
  static current(): CountryPack | undefined {
    return packStorage.getStore();
  }
}

/** Injection token for the active CountryPack. */
export const CURRENT_COUNTRY_PACK = 'CURRENT_COUNTRY_PACK';

/** Minimal request shape carrying an optional resolved CountryPack. */
export interface RequestWithCountryPack {
  countryPack?: CountryPack;
}

/** Extracts the active CountryPack from request or CLS, throwing if none is bound. */
export function requireCountryPack(request?: RequestWithCountryPack): CountryPack {
  const pack = request?.countryPack ?? CountryPackCls.current();
  if (!pack) {
    throw new Error('No CountryPack is bound to the current request or async context');
  }
  return pack;
}
