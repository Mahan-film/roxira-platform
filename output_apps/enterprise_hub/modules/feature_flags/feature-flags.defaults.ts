import { FlagOptions } from './feature-flags.types';

/**
 * Per-flag outage behaviour. Flags not listed here fail closed (new features are off
 * when flagd is unreachable). List existing, already-shipped features behind a kill
 * switch as failOpen so an outage of flagd never switches them off.
 * `@RequireFlag(name, { failOpen })` overrides this map for one route.
 */
export const FLAG_FALLBACKS: Readonly<Record<string, FlagOptions>> = {
  'country-pack.de.enabled': { failOpen: false },
  'assistant.ai-drafts': { failOpen: true },
  'invoicing.new-pdf-renderer': { failOpen: false },
};
