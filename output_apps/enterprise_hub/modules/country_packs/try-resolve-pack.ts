import type { CountryPackRegistry } from './country-pack.registry';
import { CountryPackNotFoundError, type CountryPack } from './country-pack.types';

/**
 * The active pack, or undefined when no registry is wired or the default country has no pack.
 * Callers then fall back to their built-in default statutory keys. Other errors still propagate.
 */
export function tryResolvePack(registry?: Pick<CountryPackRegistry, 'resolve'>): CountryPack | undefined {
  if (!registry) return undefined;
  try {
    return registry.resolve();
  } catch (error) {
    if (error instanceof CountryPackNotFoundError) return undefined;
    throw error;
  }
}
