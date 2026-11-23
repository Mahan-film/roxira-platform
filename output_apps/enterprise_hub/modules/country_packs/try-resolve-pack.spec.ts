import { tryResolvePack } from './try-resolve-pack';
import { CountryPackNotFoundError } from './country-pack.types';

describe('tryResolvePack', () => {
  it('returns undefined without a registry', () => {
    expect(tryResolvePack(undefined)).toBeUndefined();
  });
  it('returns the pack when resolved', () => {
    const pack = { country: 'IR' };
    expect(tryResolvePack({ resolve: () => pack } as never)).toBe(pack);
  });
  it('returns undefined when no pack is registered for the default country', () => {
    const registry = { resolve: () => { throw new CountryPackNotFoundError('none'); } };
    expect(tryResolvePack(registry as never)).toBeUndefined();
  });
  it('rethrows other errors', () => {
    const registry = { resolve: () => { throw new Error('boom'); } };
    expect(() => tryResolvePack(registry as never)).toThrow('boom');
  });
});
