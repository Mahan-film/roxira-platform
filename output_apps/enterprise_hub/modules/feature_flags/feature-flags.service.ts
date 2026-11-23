import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  Client,
  EvaluationContext,
  OpenFeature,
  Provider,
} from '@openfeature/server-sdk';
import { FLAG_FALLBACKS } from './feature-flags.defaults';
import {
  FEATURE_FLAG_PROVIDER,
  FLAG_DOMAIN,
  FlagContext,
  FlagOptions,
} from './feature-flags.types';

/**
 * Thin wrapper over the OpenFeature server SDK. It never throws: when the provider is
 * missing, flagd is down, the flag is unknown or evaluation fails, it returns the
 * per-flag fallback (closed unless the flag is listed as failOpen).
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private client: Client | null = null;

  constructor(
    @Optional()
    @Inject(FEATURE_FLAG_PROVIDER)
    private readonly provider: Provider | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.provider) {
      this.logger.warn(
        'No flag provider configured; every flag uses its fallback',
      );
      return;
    }
    try {
      await OpenFeature.setProviderAndWait(FLAG_DOMAIN, this.provider);
    } catch (err) {
      // flagd not reachable at boot: the provider keeps retrying, evaluations fall back meanwhile.
      this.logger.warn(`Flag provider not ready: ${(err as Error).message}`);
    }
    this.client = OpenFeature.getClient(FLAG_DOMAIN);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.provider) await OpenFeature.clearProviders();
  }

  /** Fallback used when the flag cannot be evaluated. */
  fallbackFor(flag: string, options?: FlagOptions): boolean {
    return options?.failOpen ?? FLAG_FALLBACKS[flag]?.failOpen ?? false;
  }

  async isEnabled(
    flag: string,
    context: FlagContext = {},
    options?: FlagOptions,
  ): Promise<boolean> {
    const fallback = this.fallbackFor(flag, options);
    if (!this.client) return fallback;
    try {
      const details = await this.client.getBooleanDetails(
        flag,
        fallback,
        this.toEvaluationContext(context),
      );
      if (details.errorCode) {
        this.logger.warn(
          `Flag ${flag} errored (${details.errorCode}); using fallback`,
        );
        return fallback;
      }
      return details.value;
    } catch (err) {
      this.logger.warn(
        `Flag ${flag} evaluation failed: ${(err as Error).message}`,
      );
      return fallback;
    }
  }

  private toEvaluationContext(context: FlagContext): EvaluationContext {
    const ctx: EvaluationContext = {};
    if (context.tenantId) {
      ctx.targetingKey = context.tenantId;
      ctx.tenantId = context.tenantId;
    }
    if (context.countryPack)
      ctx.countryPack = context.countryPack.toUpperCase();
    return ctx;
  }
}
