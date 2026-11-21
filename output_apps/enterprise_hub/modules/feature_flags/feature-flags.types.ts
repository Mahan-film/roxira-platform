/** Evaluation context sent to flagd. `targetingKey` is always the tenant id when known. */
export interface FlagContext {
  tenantId?: string | null;
  /** ISO alpha-2 country code of the tenant's country pack (IR, MY, DE ...). */
  countryPack?: string | null;
}

export interface FlagOptions {
  /**
   * What to return when flagd is down, the flag is unknown or evaluation errors.
   * false (default) = fail closed: use for NEW features. true = fail open: use for
   * EXISTING features behind a kill switch, so a flagd outage never removes them.
   */
  failOpen?: boolean;
}

export const FEATURE_FLAG_PROVIDER = 'FEATURE_FLAG_PROVIDER';
export const FLAG_DOMAIN = 'roxira';
