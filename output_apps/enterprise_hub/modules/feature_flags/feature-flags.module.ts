import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlagdProvider } from '@openfeature/flagd-provider';
import { CountryPacksModule } from '../country_packs/country-packs.module';
import { FeatureFlagGuard } from './feature-flag.guard';
import { FeatureFlagsService } from './feature-flags.service';
import { FEATURE_FLAG_PROVIDER } from './feature-flags.types';

/**
 * Per-tenant / per-country-pack feature flags (OpenFeature + flagd, T203).
 * Global so `@RequireFlag` works in any module without importing this one.
 * Set FLAGD_HOST (and optionally FLAGD_PORT, default 8013) to enable flagd; without it
 * every flag uses its fallback. See docs/ops/FEATURE_FLAGS.md.
 */
@Global()
@Module({
  imports: [CountryPacksModule],
  providers: [
    {
      provide: FEATURE_FLAG_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('FLAGD_HOST');
        if (!host) return null;
        return new FlagdProvider({
          host,
          port: Number(config.get<string>('FLAGD_PORT', '8013')),
          tls: false,
        });
      },
    },
    FeatureFlagsService,
    FeatureFlagGuard,
  ],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
